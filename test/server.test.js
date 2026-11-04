import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('API preserves fresh cache state and ignores spoofed forwarding headers', async () => {
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    calls++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(request.action === 'accounts_balances'
      ? { balances: Object.fromEntries(request.accounts.map(a => [a, { balance: '7', pending: '0' }])) }
      : { frontiers: {} }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env,
    HOST: '127.0.0.1', PORT: '0', CACHE_DB: ':memory:', RATE_LIMIT_PER_MINUTE: '2', TRUST_PROXY: '',
    RPC_NODES: `http://127.0.0.1:${upstream.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const output = await new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => { if (String(chunk).includes('listening')) resolve(String(chunk)); });
      child.once('exit', code => reject(new Error(`Server exited: ${code}`)));
    });
    const port = output.match(/:(\d+)\s/)[1];
    const request = ip => fetch(`http://127.0.0.1:${port}/api/account-state`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ addresses: [`nano_${'1'.repeat(60)}`] }) });
    assert.equal((await (await request('1.1.1.1')).json()).results[0].stale, false);
    const cached = await (await request('2.2.2.2')).json();
    assert.equal(cached.results[0].stale, false);
    assert.equal(cached.degraded, false);
    assert.equal(calls, 2);
    assert.equal((await request('3.3.3.3')).status, 429);
  } finally {
    child.kill();
    upstream.closeAllConnections();
    upstream.close();
  }
});
