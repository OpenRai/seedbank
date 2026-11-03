/**
 * SQLite-backed public-account cache.
 *
 * Uses Node's built-in `node:sqlite` module (stable in Node 24+), so there is
 * no native build step and no third-party driver.
 *
 * Only public ledger state is ever stored: Nano addresses, confirmed balance,
 * receivable balance, and an "opened" flag. Private keys, seeds, and mnemonics
 * never reach this module.
 *
 * Rows carry:
 *   address, balance_raw, receivable_raw, opened, fetched_at (unix ms)
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @typedef {object} AccountState
 * @property {string}  address
 * @property {string}  balanceRaw      Confirmed balance in raw.
 * @property {string}  receivableRaw   Receivable (pending) balance in raw.
 * @property {boolean} opened          Whether the account has a frontier.
 * @property {number}  fetchedAt       Unix ms when fetched from RPC.
 */

/**
 * @typedef {object} CachedState
 * @property {string}  address
 * @property {string}  balanceRaw
 * @property {string}  receivableRaw
 * @property {boolean} opened
 * @property {number}  fetchedAt
 * @property {number}  expiresAt
 * @property {boolean} stale           Past its TTL; served only as fallback.
 */

/**
 * @typedef {object} CacheOptions
 * @property {string} file              SQLite path, or `:memory:`.
 * @property {number} ttlMs             Time to live.
 * @property {number} [staleMaxAgeMs]   How long stale rows are retained.
 */

/** @typedef {{ address: string, balance_raw: string, receivable_raw: string, opened: number, fetched_at: number }} Row */

export class AccountCache {
  /** @type {DatabaseSync} */
  db;
  /** @type {number} */
  ttlMs;
  /** @type {number} */
  staleMaxAgeMs;

  /** @param {CacheOptions} options */
  constructor(options) {
    this.ttlMs = options.ttlMs;
    this.staleMaxAgeMs = options.staleMaxAgeMs ?? Math.max(options.ttlMs * 24, 86_400_000);
    if (options.file !== ':memory:') mkdirSync(dirname(options.file), { recursive: true });

    this.db = new DatabaseSync(options.file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_cache (
        address        TEXT PRIMARY KEY,
        balance_raw    TEXT NOT NULL,
        receivable_raw TEXT NOT NULL,
        opened         INTEGER NOT NULL,
        fetched_at     INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS account_cache_fetched_at ON account_cache (fetched_at);
    `);
  }

  /**
   * Look up many addresses in one query. Returns a map of address -> state,
   * including stale entries (flagged) so callers can decide how to use them.
   *
   * @param {string[]} addresses
   * @param {number} [now]
   * @returns {Map<string, CachedState>}
   */
  getMany(addresses, now = Date.now()) {
    /** @type {Map<string, CachedState>} */
    const result = new Map();
    if (addresses.length === 0) return result;

    const placeholders = addresses.map(() => '?').join(',');
    /** @type {Row[]} */
    const rows = this.db
      .prepare(
        `SELECT address, balance_raw, receivable_raw, opened, fetched_at FROM account_cache WHERE address IN (${placeholders})`,
      )
      .all(...addresses);

    for (const row of rows) {
      const expiresAt = row.fetched_at + this.ttlMs;
      if (now - row.fetched_at > this.staleMaxAgeMs) continue;
      result.set(row.address, {
        address: row.address,
        balanceRaw: row.balance_raw,
        receivableRaw: row.receivable_raw,
        opened: row.opened === 1,
        fetchedAt: row.fetched_at,
        expiresAt,
        stale: now >= expiresAt,
      });
    }
    return result;
  }

  /**
   * Insert or refresh many rows in a single transaction.
   * @param {AccountState[]} states
   */
  setMany(states) {
    if (states.length === 0) return;
    const statement = this.db.prepare(`
      INSERT INTO account_cache (address, balance_raw, receivable_raw, opened, fetched_at)
      VALUES (:address, :balanceRaw, :receivableRaw, :opened, :fetchedAt)
      ON CONFLICT(address) DO UPDATE SET
        balance_raw    = excluded.balance_raw,
        receivable_raw = excluded.receivable_raw,
        opened         = excluded.opened,
        fetched_at     = excluded.fetched_at
    `);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of states) {
        statement.run({
          address: row.address,
          balanceRaw: row.balanceRaw,
          receivableRaw: row.receivableRaw,
          opened: row.opened ? 1 : 0,
          fetchedAt: row.fetchedAt,
        });
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Remove rows older than the stale retention window.
   * @param {number} [now]
   * @returns {number}
   */
  prune(now = Date.now()) {
    const cutoff = now - this.staleMaxAgeMs;
    const info = this.db.prepare('DELETE FROM account_cache WHERE fetched_at < ?').run(cutoff);
    return Number(info.changes);
  }

  /** @returns {number} */
  count() {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM account_cache').get();
    return Number(row.n);
  }

  close() {
    this.db.close();
  }
}
