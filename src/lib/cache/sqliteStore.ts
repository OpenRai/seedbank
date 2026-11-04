import type { Database } from '@sqlite.org/sqlite-wasm';
import type { AccountState } from '../providers/types';
import { CACHE_RETENTION_MS, knownState } from './cachedProvider';

export function initializeCache(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS account_cache (
    address TEXT PRIMARY KEY, balance_raw TEXT NOT NULL, receivable_raw TEXT NOT NULL,
    opened INTEGER NOT NULL, fetched_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS account_cache_fetched_at ON account_cache(fetched_at);`);
}

/** Reading must preserve expired rows for a subsequent failed-refresh fallback. */
export function readCachedAccounts(db: Database, addresses: string[]): AccountState[] {
  if (!addresses.length) return [];
  return db.selectObjects(
    `SELECT * FROM account_cache WHERE address IN (${addresses.map(() => '?').join(',')})`, addresses,
  ).map((row) => ({
    address: String(row.address), balanceRaw: String(row.balance_raw), receivableRaw: String(row.receivable_raw),
    opened: row.opened === 1, fetchedAt: Number(row.fetched_at), stale: false,
  }));
}

export function writeCachedAccounts(db: Database, states: AccountState[], maxRecords = 10000, now = Date.now()): void {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new Error('Cache record limit must be a positive integer');
  db.exec('BEGIN');
  try {
    for (const state of states) {
      if (!knownState(state) || state.stale) continue;
      db.exec(`INSERT INTO account_cache VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(address) DO UPDATE SET balance_raw=excluded.balance_raw,
        receivable_raw=excluded.receivable_raw, opened=excluded.opened, fetched_at=excluded.fetched_at`, {
        bind: [state.address, state.balanceRaw, state.receivableRaw, state.opened ? 1 : 0, state.fetchedAt],
      });
      // Enforce the cap after EACH upsert, including updates to existing rows.
      db.exec(`DELETE FROM account_cache WHERE address IN (
        SELECT address FROM account_cache ORDER BY fetched_at DESC, address LIMIT -1 OFFSET ?
      )`, { bind: [maxRecords] });
    }
    // Retention is deliberately separate from the one-hour freshness TTL.
    db.exec('DELETE FROM account_cache WHERE fetched_at < ?', { bind: [now - CACHE_RETENTION_MS] });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
