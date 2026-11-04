import { test } from 'node:test';
import assert from 'node:assert/strict';
import initializeSqlite from '@sqlite.org/sqlite-wasm';
import type { AccountState } from '../src/lib/providers/types.ts';
await import('./loader.mjs');
const { initializeCache, readCachedAccounts, writeCachedAccounts } = await import('../src/lib/cache/sqliteStore.ts');
const { CACHE_TTL_MS, CACHE_RETENTION_MS, withAccountCache } = await import('../src/lib/cache/cachedProvider.ts');
const sqlite = await initializeSqlite();
const now = 1_000_000_000;
function state(address: string, fetchedAt = now): AccountState {
  return { address, fetchedAt, balanceRaw: '42', receivableRaw: '7', opened: true, stale: false };
}
function database() {
  const db = new sqlite.oo1.DB(':memory:');
  initializeCache(db);
  return db;
}

test('WASM SQLite enforces its record limit between every upsert in a batch', () => {
  const db = database();
  try {
    writeCachedAccounts(db, [state('a'), state('b')], 2, now);
    // Detect a cap violation BEFORE the next upsert, rather than only checking
    // the final batch size (which would miss cleanup delayed until batch end).
    db.exec(`CREATE TRIGGER guard_cache_size BEFORE INSERT ON account_cache BEGIN
      SELECT CASE WHEN (SELECT count(*) FROM account_cache) > 2
        THEN RAISE(ABORT, 'previous upsert did not enforce record limit') END;
    END;`);
    writeCachedAccounts(db, [state('c', now+1), state('d', now+2), state('e', now+3)], 2, now);
    assert.equal(db.selectValue('SELECT COUNT(*) FROM account_cache'), 2);
    assert.deepEqual(readCachedAccounts(db, ['a','b','c','d','e']).map((row) => row.address).sort(), ['d','e']);
  } finally { db.close(); }
});

test('upsert updates a record and its eviction priority without creating duplicates', () => {
  const db = database();
  try {
    writeCachedAccounts(db, [state('a', now-2), state('b', now-1)], 2, now);
    writeCachedAccounts(db, [{ ...state('a', now+1), balanceRaw:'99' }, state('c', now)], 2, now);
    assert.deepEqual(readCachedAccounts(db, ['a','b','c']).map((row) => row.address).sort(), ['a','c']);
    assert.equal(readCachedAccounts(db, ['a'])[0].balanceRaw, '99');
    assert.equal(db.selectValue('SELECT COUNT(*) FROM account_cache'), 2);
  } finally { db.close(); }
});

test('reads and writes retain TTL-expired records until the separate retention boundary', () => {
  const db = database();
  try {
    const expired = state('expired', now-CACHE_TTL_MS-1);
    writeCachedAccounts(db, [expired], 10, now);
    assert.deepEqual(readCachedAccounts(db, ['expired']), [expired]);
    writeCachedAccounts(db, [state('new')], 10, now);
    assert.deepEqual(readCachedAccounts(db, ['expired']), [expired]);
    const boundary = state('boundary', now-CACHE_RETENTION_MS);
    writeCachedAccounts(db, [boundary, state('too-old', now-CACHE_RETENTION_MS-1)], 10, now);
    assert.equal(readCachedAccounts(db, ['boundary']).length, 1);
    assert.equal(readCachedAccounts(db, ['too-old']).length, 0);
  } finally { db.close(); }
});

test('failed refreshes repeatedly serve stale persisted rows without deleting or re-dating them', async () => {
  const db = database();
  try {
    const expired = state('expired', now-CACHE_TTL_MS-1);
    writeCachedAccounts(db, [expired], 10, now);
    const provider = withAccountCache({ async fetchAccountStates() { throw new Error('RPC offline'); } }, {
      read: async (addresses) => readCachedAccounts(db, addresses),
      write: async (states) => { writeCachedAccounts(db, states, 10, now); },
    }, () => now);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await provider.fetchAccountStates(['expired','unknown']);
      assert.equal(response.degraded, true);
      assert.deepEqual(response.results[0], { ...expired, stale: true });
      assert.equal(response.results[1].balanceRaw, null);
      assert.deepEqual(readCachedAccounts(db, ['expired']), [expired]);
    }
  } finally { db.close(); }
});

test('unknown and stale fallback records cannot overwrite a previous successful cache entry', () => {
  const db = database();
  try {
    writeCachedAccounts(db, [state('a')], 2, now);
    writeCachedAccounts(db, [{ ...state('a'), balanceRaw:null }, { ...state('a'), balanceRaw:'0', stale:true }], 2, now);
    assert.deepEqual(readCachedAccounts(db, ['a']), [state('a')]);
  } finally { db.close(); }
});
