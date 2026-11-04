/**
 * Public-account cache tests plus cost-model tests for the RPC client.
 *
 * The RPC client should never issue a per-address request: a page of N
 * addresses costs two upstream calls total (balances + frontiers). These
 * tests lock that contract in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountCache } from '../server/cache.js';
import { NanoRpcClient } from '../server/rpc.js';

const ADDR = (n) =>
  `nano_${'1'.repeat(5)}${String(n).padStart(4, '0')}${'3'.repeat(51)}`.slice(0, 65);

function state(address, overrides = {}) {
  return { address, balanceRaw: '1000', receivableRaw: '0', opened: true, fetchedAt: Date.now(), ...overrides };
}

/** Minimal fetch double that records every upstream call. */
function recordingFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    const request = JSON.parse(init.body);
    calls.push({ url: String(url), request });
    return handler(request);
  };
  return { impl, calls };
}

function okResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

test('cache stores and returns fresh rows', () => {
  const cache = new AccountCache({ file: ':memory:', ttlMs: 60_000 });
  cache.setMany([state(ADDR(1)), state(ADDR(2))]);
  const rows = cache.getMany([ADDR(1), ADDR(2), ADDR(3)]);
  assert.equal(rows.size, 2);
  assert.equal(rows.get(ADDR(1)).stale, false);
  assert.equal(rows.has(ADDR(3)), false);
  cache.close();
});

test('cache marks rows stale after the TTL but keeps them for fallback', () => {
  const cache = new AccountCache({ file: ':memory:', ttlMs: 1000, staleMaxAgeMs: 60_000 });
  const now = Date.now();
  cache.setMany([state(ADDR(1), { balanceRaw: '5', opened: false, fetchedAt: now - 2000 })]);
  const rows = cache.getMany([ADDR(1)], now);
  assert.equal(rows.get(ADDR(1)).stale, true);
  cache.close();
});

test('rows older than the retention window are dropped and pruned', () => {
  const cache = new AccountCache({ file: ':memory:', ttlMs: 1000, staleMaxAgeMs: 2000 });
  const now = Date.now();
  cache.setMany([
    state(ADDR(1), { fetchedAt: now - 5000 }),
    state(ADDR(2), { fetchedAt: now - 100 }),
  ]);
  assert.equal(cache.getMany([ADDR(1)], now).size, 0);
  assert.equal(cache.prune(now), 1);
  assert.equal(cache.count(), 1);
  cache.close();
});

test('a 20-address page costs exactly two upstream calls', async () => {
  const { impl, calls } = recordingFetch((request) => {
    if (request.action === 'accounts_balances') {
      return okResponse({
        balances: Object.fromEntries(request.accounts.map((a) => [a, { balance: '42', pending: '7' }])),
      });
    }
    return okResponse({
      frontiers: Object.fromEntries(request.accounts.map((a) => [a, 'A'.repeat(64)])),
    });
  });

  const client = new NanoRpcClient({ nodes: [{ name: 'mock', url: 'http://mock' }], fetchImpl: impl });
  const addresses = Array.from({ length: 20 }, (_, i) => ADDR(i));
  const states = await client.fetchState(addresses);

  assert.equal(states.length, 20);
  assert.equal(states[0].balanceRaw, '42');
  assert.equal(states[0].receivableRaw, '7');
  assert.equal(states[0].opened, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.request.action).sort(),
    ['accounts_balances', 'accounts_frontiers'],
  );
});

test('large pages are chunked into bounded plural requests', async () => {
  const { impl, calls } = recordingFetch((request) =>
    request.action === 'accounts_balances'
      ? okResponse({ balances: Object.fromEntries(request.accounts.map((a) => [a, { balance: '0', pending: '0' }])) })
      : okResponse({ frontiers: {} }),
  );
  const client = new NanoRpcClient({
    nodes: [{ name: 'mock', url: 'http://mock' }],
    fetchImpl: impl,
    batchSize: 100,
  });
  await client.fetchState(Array.from({ length: 250 }, (_, i) => ADDR(i)));
  assert.equal(calls.length, 6); // 3 chunks x 2 plural methods
  for (const call of calls) assert.ok(call.request.accounts.length <= 100);
});

test('unopened accounts report a zero frontier as not opened', async () => {
  const { impl } = recordingFetch((request) =>
    request.action === 'accounts_balances'
      ? okResponse({ balances: { [ADDR(1)]: { balance: '0', pending: '0' } } })
      : okResponse({ frontiers: { [ADDR(1)]: '0'.repeat(64) } }),
  );
  const client = new NanoRpcClient({ nodes: [{ name: 'mock', url: 'http://mock' }], fetchImpl: impl });
  const [state1] = await client.fetchState([ADDR(1)]);
  assert.equal(state1.opened, false);
});

test('rpc client fails over to the next node', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('bad')) return { ok: false, status: 503, json: async () => ({}) };
    return okResponse({ balances: { [ADDR(1)]: { balance: '1', pending: '0' } } });
  };
  const client = new NanoRpcClient({
    nodes: [
      { name: 'bad', url: 'http://bad' },
      { name: 'good', url: 'http://good' },
    ],
    fetchImpl,
  });
  const result = await client.accountsBalances([ADDR(1)]);
  assert.equal(result.get(ADDR(1)).balanceRaw, '1');
});

test('a JSON-RPC error body is treated as a failure, not a success', async () => {
  const client = new NanoRpcClient({
    nodes: [{ name: 'mock', url: 'http://mock' }],
    fetchImpl: async () => okResponse({ error: 'Account not found' }),
  });
  await assert.rejects(() => client.accountsBalances([ADDR(1)]), /Account not found/);
});

test('malformed successful RPC responses fail over instead of returning zeros', async () => {
  for (const bad of [{}, { balances: {} }, { balances: { [ADDR(1)]: { balance: '-1', pending: '0' } } }]) {
    const client = new NanoRpcClient({
      nodes: [{ name: 'bad', url: 'http://bad' }, { name: 'good', url: 'http://good' }],
      fetchImpl: async (url) => okResponse(url === 'http://bad' ? bad : { balances: { [ADDR(1)]: { balance: '9', pending: '0' } } }),
    });
    assert.equal((await client.accountsBalances([ADDR(1)])).get(ADDR(1)).balanceRaw, '9');
  }
});

test('malformed frontiers are rejected while empty unopened results are accepted', async () => {
  for (const payload of [{}, { frontiers: { [ADDR(1)]: 'invalid' } }]) {
    const client = new NanoRpcClient({ nodes: [{ name: 'mock', url: 'http://mock' }], fetchImpl: async () => okResponse(payload) });
    await assert.rejects(() => client.accountsFrontiers([ADDR(1)]), /frontier/i);
  }
});
