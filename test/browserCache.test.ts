import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('./loader.mjs');
const { withAccountCache, CACHE_TTL_MS, CACHE_RETENTION_MS } = await import('../src/lib/cache/cachedProvider.ts');
import type { AccountState, AccountStateProvider } from '../src/lib/providers/types.ts';

function fixture() {
  let time = 1_000_000_000;
  let calls = 0;
  let fail = false;
  const stored = new Map<string, AccountState>();
  const provider: AccountStateProvider = { async fetchAccountStates(addresses) {
    calls++;
    if (fail) throw new Error('RPC offline');
    return { results: addresses.map((address) => ({ address, balanceRaw: '42', receivableRaw: '7', opened: true, fetchedAt: time, stale: false })), servedAt: time, ttlMs: 0, degraded: false };
  } };
  const cache = {
    async read(addresses: string[]) { return addresses.flatMap((address) => stored.has(address) ? [stored.get(address)!] : []); },
    async write(states: AccountState[]) { for (const state of states) stored.set(state.address, state); },
  };
  return { cached: withAccountCache(provider, cache, () => time), stored,
    calls: () => calls, advance: (ms: number) => { time += ms; }, offline: () => { fail = true; } };
}

test('fresh browser cache hits skip RPC and are not marked Cached', async () => {
  const f = fixture();
  await f.cached.fetchAccountStates(['a']);
  const response = await f.cached.fetchAccountStates(['a']);
  assert.equal(f.calls(), 1);
  assert.equal(response.results[0].stale, false);
  assert.equal(response.degraded, false);
});

test('expired records refresh and replace balances on success', async () => {
  const f = fixture();
  await f.cached.fetchAccountStates(['a']);
  const first = f.stored.get('a')!.fetchedAt;
  f.advance(CACHE_TTL_MS);
  const response = await f.cached.fetchAccountStates(['a']);
  assert.equal(f.calls(), 2);
  assert.notEqual(response.results[0].fetchedAt, first);
  assert.equal(response.results[0].stale, false);
});

test('RPC failure returns stale data only within retention, otherwise unknown', async () => {
  const f = fixture();
  await f.cached.fetchAccountStates(['a']);
  f.advance(CACHE_TTL_MS);
  f.offline();
  const fallback = await f.cached.fetchAccountStates(['a', 'missing']);
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.results[0].stale, true);
  assert.equal(fallback.results[0].balanceRaw, '42');
  assert.equal(fallback.results[1].balanceRaw, null);
  assert.equal(fallback.results[1].opened, null);
  assert.equal(fallback.results[1].stale, false);
  f.advance(CACHE_RETENTION_MS);
  assert.equal((await f.cached.fetchAccountStates(['a'])).results[0].balanceRaw, null);
});

test('failure refreshing one address does not mark a fresh cache hit stale', async () => {
  const f = fixture();
  await f.cached.fetchAccountStates(['a']);
  f.offline();
  const response = await f.cached.fetchAccountStates(['a', 'missing']);
  assert.equal(response.results[0].stale, false);
  assert.equal(response.results[1].fetchedAt, null);
});

test('concurrent overlapping batches share in-flight account lookups', async () => {
  const f = fixture();
  await Promise.all([f.cached.fetchAccountStates(['a']), f.cached.fetchAccountStates(['a'])]);
  assert.equal(f.calls(), 1);
});

test('unknown RPC results never poison the cache', async () => {
  const f = fixture();
  const unknown: AccountStateProvider = { async fetchAccountStates(addresses) {
    return { results: addresses.map((address) => ({ address, balanceRaw: null, receivableRaw: null, opened: null, fetchedAt: null, stale: false })), servedAt: 1, ttlMs: 0, degraded: true };
  } };
  const cached = withAccountCache(unknown, { read: async () => [], write: async (states) => { assert.deepEqual(states, []); } });
  assert.equal((await cached.fetchAccountStates(['a'])).results[0].balanceRaw, null);
  assert.equal(f.stored.size, 0);
});

test('cancelled view cannot abort a shared lookup used by another caller', async () => {
  const f = fixture();
  const controller = new AbortController();
  const cancelled = f.cached.fetchAccountStates(['a'], controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal((await f.cached.fetchAccountStates(['a'])).results[0].balanceRaw, '42');
});

test('a fully cached 20-account page performs no RPC and no cache writes', async () => {
  const time = 1_000_000_000;
  const addresses = Array.from({ length: 20 }, (_, index) => `account-${index}`);
  const events: string[] = [];
  const provider = withAccountCache({
    async fetchAccountStates() { assert.fail('RPC must never be called for a cached page'); },
  }, {
    async read(requested) {
      events.push('cache-read');
      assert.deepEqual(requested, addresses);
      return requested.map((address) => ({ address, balanceRaw:'0', receivableRaw:'0', opened:false, fetchedAt:time-1, stale:false }));
    },
    async write() { assert.fail('Cache hits must not be rewritten or re-dated'); },
  }, () => time);
  const result = await provider.fetchAccountStates(addresses);
  assert.equal(result.results.length, 20);
  assert.equal(result.degraded, false);
  assert.deepEqual(events, ['cache-read']);
});

test('cache read precedes RPC, then successful data is written before returning', async () => {
  const events: string[] = [];
  let finishRpc!: (response: import('../src/lib/providers/types.ts').AccountStateResponse) => void;
  let finishWrite!: () => void;
  let returned = false;
  const provider = withAccountCache({
    async fetchAccountStates(addresses) {
      events.push('rpc-start');
      assert.deepEqual(addresses, ['missing']);
      return new Promise((resolve) => { finishRpc = resolve; });
    },
  }, {
    async read() { events.push('cache-read'); return []; },
    async write(rows) {
      events.push('cache-write');
      assert.equal(rows[0].balanceRaw, '42');
      await new Promise<void>((resolve) => { finishWrite = resolve; });
    },
  });
  const pending = provider.fetchAccountStates(['missing']).then((result) => { returned=true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['cache-read', 'rpc-start']);
  assert.equal(returned, false);
  finishRpc({ results:[{ address:'missing', balanceRaw:'42', receivableRaw:'0', opened:true, fetchedAt:Date.now(), stale:false }], servedAt:Date.now(), ttlMs:0, degraded:false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['cache-read', 'rpc-start', 'cache-write']);
  assert.equal(returned, false);
  finishWrite();
  assert.equal((await pending).results[0].balanceRaw, '42');
});

test('a partially cached page fetches only missing or TTL-expired accounts', async () => {
  const time=1_000_000_000;
  const requested: string[][]=[];
  const written: AccountState[][]=[];
  const row=(address:string, fetchedAt:number):AccountState=>({address,fetchedAt,balanceRaw:'0',receivableRaw:'0',opened:false,stale:false});
  const provider=withAccountCache({ async fetchAccountStates(addresses) {
    requested.push(addresses);
    return { results:addresses.map(address=>row(address,time)),servedAt:time,ttlMs:0,degraded:false };
  } }, {
    read:async()=>[row('fresh',time-CACHE_TTL_MS+1),row('expired',time-CACHE_TTL_MS)],
    write:async(rows)=>{written.push(rows);},
  },()=>time);
  const result=await provider.fetchAccountStates(['fresh','expired','missing','fresh']);
  assert.deepEqual(requested,[['expired','missing']]);
  assert.deepEqual(written[0].map(row=>row.address),['expired','missing']);
  assert.deepEqual(result.results.map(row=>row.address),['fresh','expired','missing']);
});

test('RPC errors never invoke cache writes, so stale data keeps its original age', async () => {
  const provider=withAccountCache({ async fetchAccountStates(){throw new Error('offline');} },{
    read:async()=>[{address:'a',balanceRaw:'42',receivableRaw:'7',opened:true,fetchedAt:1,stale:false}],
    write:async()=>assert.fail('Failed RPC calls must not update the cache'),
  },()=>CACHE_TTL_MS+1);
  const result=await provider.fetchAccountStates(['a']);
  assert.equal(result.results[0].fetchedAt,1);
  assert.equal(result.results[0].stale,true);
});

test('empty pages perform no storage or network operations',async()=>{
  const provider=withAccountCache({fetchAccountStates:async()=>assert.fail('No RPC for empty pages')},{
    read:async()=>assert.fail('No storage read for empty pages'),
    write:async()=>assert.fail('No storage write for empty pages'),
  });
  assert.deepEqual((await provider.fetchAccountStates([])).results,[]);
});
