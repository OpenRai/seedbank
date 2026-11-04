import { CACHE_RETENTION_MS, knownState, type AccountStateCache } from './cachedProvider';
import type { AccountState } from '../providers/types';
import type { CacheOperation, CacheResponse } from './protocol';

/** Persistent cache when available; storage failure never breaks RPC lookups. */
export function createBrowserAccountCache(): AccountStateCache {
  const memory = new Map<string, AccountState>();
  const pending = new Map<number, { resolve: (rows: AccountState[]) => void; reject: (error: Error) => void }>();
  let worker: Worker | undefined;
  let disabled = false;
  let nextId = 0;

  function disable(error: Error) {
    if (!disabled) console.warn('Persistent account cache unavailable; using memory.', error);
    disabled = true;
    worker?.terminate();
    worker = undefined;
    for (const task of pending.values()) task.reject(error);
    pending.clear();
  }

  function request(operation: CacheOperation): Promise<AccountState[]> {
    if (disabled) return Promise.resolve([]);
    try {
      if (!worker) {
        worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<CacheResponse>) => {
          const task = pending.get(data.id);
          if (!task) return;
          pending.delete(data.id);
          if ('error' in data) {
            task.reject(new Error(data.error));
            disable(new Error(data.error));
          } else task.resolve(data.results);
        };
        worker.onerror = () => disable(new Error('Cache worker failed'));
        worker.onmessageerror = () => disable(new Error('Invalid cache worker message'));
      }
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => disable(new Error('Cache worker timed out')), 10000);
        pending.set(id, {
          resolve: (rows) => { clearTimeout(timer); resolve(rows); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        worker!.postMessage({ ...operation, id });
      });
    } catch (error) {
      disable(error instanceof Error ? error : new Error(String(error)));
      return Promise.resolve([]);
    }
  }

  function remember(rows: AccountState[]) {
    for (const state of rows) {
      if (knownState(state) && !state.stale) {
        const previous = memory.get(state.address);
        if (!previous || previous.fetchedAt! <= state.fetchedAt!) {
          memory.delete(state.address);
          memory.set(state.address, state);
          while (memory.size > 10000) memory.delete(memory.keys().next().value!);
        }
      }
    }
    const cutoff = Date.now() - CACHE_RETENTION_MS;
    for (const [address, state] of memory) if (state.fetchedAt! < cutoff) memory.delete(address);
  }

  return {
    async read(addresses) {
      const rows = await request({ command: 'read', addresses }).catch(() => []);
      remember(rows);
      return addresses.flatMap((address) => memory.has(address) ? [memory.get(address)!] : []);
    },
    async write(states) {
      remember(states);
      await request({ command: 'write', states }).catch(() => []);
    },
  };
}
