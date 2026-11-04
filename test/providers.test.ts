import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('./loader.mjs');
const { createNanoRpcProvider, createJsonRpcProvider } = await import('../src/lib/providers/rpc.ts');
const { createProxyProvider } = await import('../src/lib/providers/proxy.ts');

const addresses = ['opened', 'unopened'];
const ledger = (action: string) => action === 'accounts_balances'
  ? { balances: { opened: { balance: '42', pending: '7' }, unopened: { balance: '0', receivable: '5' } } }
  : { frontiers: { opened: 'A'.repeat(64) }, errors: { unopened: 'Account not found' } };
const nodes = [{ name: 'mock', url: 'https://mock.invalid' }];

test('all three providers return the same normalized ledger records', async () => {
  const native = createNanoRpcProvider(nodes, async (_url, init) => Response.json(ledger(JSON.parse(String(init?.body)).action)));
  const gateway = createJsonRpcProvider('https://gateway.invalid/rpc', async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.jsonrpc, '2.0');
    assert.deepEqual(request.params.accounts, addresses);
    assert.equal('action' in request, false);
    return Response.json({ jsonrpc: '2.0', id: request.id, result: ledger(request.method) });
  });
  const proxy = createProxyProvider(async () => Response.json({
    results: [
      { address: 'opened', balanceRaw: '42', receivableRaw: '7', opened: true, stale: false, fetchedAt: 1 },
      { address: 'unopened', balanceRaw: '0', receivableRaw: '5', opened: false, stale: false, fetchedAt: 1 },
    ], ttlMs: 3600000, servedAt: 1, degraded: false,
  }));
  const snapshots = [];
  for (const provider of [native, gateway, proxy]) {
    const response = await provider.fetchAccountStates(addresses);
    assert.equal(response.degraded, false);
    snapshots.push(response.results.map(({ fetchedAt, ...state }) => {
      assert.equal(typeof fetchedAt, 'number');
      return state;
    }));
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[0], snapshots[2]);
});

test('errors-only Account not found frontiers mean unopened, not an RPC failure', async () => {
  const provider = createNanoRpcProvider(nodes, async (_url, init) => {
    const action = JSON.parse(String(init?.body)).action;
    return Response.json(action === 'accounts_balances'
      ? { balances: { unopened: { balance: '0', pending: '0' } } }
      : { errors: { unopened: 'Account not found' } });
  });
  assert.equal((await provider.fetchAccountStates(['unopened'])).results[0].opened, false);
});

test('unknown per-account failures and incomplete responses never become zero balances', async () => {
  for (const response of [{ errors: { unopened: 'Rate limited' } }, { errors: {} }, {}]) {
    const provider = createNanoRpcProvider(nodes, async () => Response.json(response));
    await assert.rejects(provider.fetchAccountStates(['unopened']));
  }
});

test('JSON-RPC errors stay failures and cannot be normalized as unopened', async () => {
  const provider = createJsonRpcProvider('https://gateway.invalid', async (_url, init) => Response.json({
    jsonrpc: '2.0', id: JSON.parse(String(init?.body)).id, error: { code: -32000, message: 'Unavailable' },
  }));
  await assert.rejects(provider.fetchAccountStates(addresses), /Unavailable/);
});

test('missing proxy records remain unknown while cached records retain freshness', async () => {
  const provider = createProxyProvider(async () => Response.json({
    results: [{ address: 'opened', balanceRaw: '42', receivableRaw: '7', opened: true, stale: true, fetchedAt: 1 }],
    ttlMs: 3600000, servedAt: 2, degraded: true,
  }));
  const response = await provider.fetchAccountStates(addresses);
  assert.equal(response.results[0].stale, true);
  assert.equal(response.results[1].balanceRaw, null);
  assert.equal(response.results[1].opened, null);
  assert.equal(response.results[1].fetchedAt, null);
});
