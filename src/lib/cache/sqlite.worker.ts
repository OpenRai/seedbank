/// <reference lib="webworker" />
import sqlite3InitModule, { type SAHPoolUtil } from '@sqlite.org/sqlite-wasm';
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import { initializeCache, readCachedAccounts, writeCachedAccounts } from './sqliteStore';
import type { AccountState } from '../providers/types';
import type { CacheRequest, CacheResponse } from './protocol';

const port = self as unknown as DedicatedWorkerGlobalScope;
let sqlite: ReturnType<typeof sqlite3InitModule> | undefined;
let pool: SAHPoolUtil | undefined;

async function execute(request: CacheRequest): Promise<AccountState[]> {
  if (!navigator.locks || !navigator.storage?.getDirectory) throw new Error('Persistent cache unavailable');
  // Installation also acquires file handles, so it must be inside the lock.
  return navigator.locks.request('seedbank-account-cache', async () => {
    // The package types omit Emscripten's supported initialization options.
    const initialize = sqlite3InitModule as (options: { locateFile: () => string }) => ReturnType<typeof sqlite3InitModule>;
    sqlite ??= initialize({ locateFile: () => sqliteWasmUrl });
    const module = await sqlite;
    if (!pool) {
      pool = await module.installOpfsSAHPoolVfs({ name: 'seedbank-account-cache', initialCapacity: 3 });
    } else {
      await pool.unpauseVfs();
    }
    try {
      const db = new pool.OpfsSAHPoolDb('/accounts.sqlite3');
      try {
        initializeCache(db);
        if (request.command === 'read') return readCachedAccounts(db, request.addresses);
        writeCachedAccounts(db, request.states);
        return [];
      } finally {
        db.close();
      }
    } finally {
      // Release OPFS handles before another tab acquires the Web Lock.
      pool.pauseVfs();
    }
  });
}

port.onmessage = (event: MessageEvent<CacheRequest>) => {
  const request = event.data;
  execute(request).then(
    (results) => port.postMessage({ id: request.id, results } satisfies CacheResponse),
    (error: unknown) => port.postMessage({ id: request.id, error: String(error) } satisfies CacheResponse),
  );
};
