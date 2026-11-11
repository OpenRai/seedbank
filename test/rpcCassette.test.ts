import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { rpcReplay } from '../e2e/rpc-cassette.ts';

test('recorded RPC replay preserves the full response and measured delay without live fetch', async () => {
  const directory = new URL('../e2e/fixtures/rpc/', import.meta.url);
  const [name] = (await readdir(directory)).filter(name => name.endsWith('.json'));
  assert.ok(name, 'Real RPC recordings must be present');
  const recording = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
  const fetch = mock.method(globalThis, 'fetch', () => { throw new Error('Live network forbidden'); });
  try {
    const started = performance.now();
    const result = await rpcReplay(recording.request.method, recording.request.params);
    assert.deepEqual(result.envelope, JSON.parse(recording.response.body));
    assert.ok(performance.now() - started >= recording.elapsedMs - 10);
    assert.equal(fetch.mock.callCount(), 0);
  } finally { fetch.mock.restore(); }
});

test('a missing RPC cassette fails instead of falling back to the network', async () => {
  const fetch = mock.method(globalThis, 'fetch', () => { throw new Error('Live network forbidden'); });
  try {
    await assert.rejects(rpcReplay('accounts_balances', {accounts:['missing-recording']}), /Missing RPC cassette/);
    assert.equal(fetch.mock.callCount(), 0);
  } finally { fetch.mock.restore(); }
});
