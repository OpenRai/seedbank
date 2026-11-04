import type { AccountState, AccountStateProvider } from '../providers/types';

export const CACHE_TTL_MS = 3_600_000;
export const CACHE_RETENTION_MS = 86_400_000;

export interface AccountStateCache {
  read(addresses: string[]): Promise<AccountState[]>;
  write(states: AccountState[]): Promise<void>;
}

export function knownState(state: AccountState): boolean {
  return state.fetchedAt !== null && state.balanceRaw !== null && state.receivableRaw !== null && state.opened !== null;
}

/** Cache policy is shared by both direct RPC adapters; storage is replaceable. */
export function withAccountCache(provider: AccountStateProvider, cache: AccountStateCache, now = Date.now): AccountStateProvider {
  const inFlight = new Map<string, Promise<AccountState>>();

  function fetchMissing(addresses: string[]) {
    const mine = addresses.filter((address) => !inFlight.has(address));
    if (!mine.length) return;
    // A cancelled view must not abort a batch shared by another view.
    const batch = provider.fetchAccountStates(mine).then(async (response) => {
      const states = response.results.filter((state) => knownState(state) && !state.stale);
      await cache.write(states);
      return new Map(states.map((state) => [state.address, state]));
    });
    for (const address of mine) {
      const pending = batch.then((states) => {
        const state = states.get(address);
        if (!state) throw new Error('Account state unavailable');
        return state;
      }).finally(() => inFlight.delete(address));
      inFlight.set(address, pending);
    }
  }

  return {
    async fetchAccountStates(addresses, signal) {
      signal?.throwIfAborted();
      const unique = [...new Set(addresses)];
      if (!unique.length) return { results: [], ttlMs: CACHE_TTL_MS, servedAt: now(), degraded: false };
      const readAt = now();
      const cached = new Map((await cache.read(unique))
        .filter((state) => knownState(state) && readAt - state.fetchedAt! <= CACHE_RETENTION_MS)
        .map((state) => [state.address, state]));
      signal?.throwIfAborted();
      const missing = unique.filter((address) => {
        const row = cached.get(address);
        return !row || readAt - row.fetchedAt! >= CACHE_TTL_MS;
      });
      fetchMissing(missing);
      const pending = missing.map((address) => inFlight.get(address)!);
      const refreshed = await Promise.allSettled(pending);
      signal?.throwIfAborted();
      let degraded = false;
      const resolved = new Map<string, AccountState>();
      for (const [index, outcome] of refreshed.entries()) {
        const address = missing[index];
        if (outcome.status === 'fulfilled') {
          resolved.set(address, { ...outcome.value, stale: false });
        } else {
          degraded = true;
          const previous = cached.get(address);
          resolved.set(address, previous && now() - previous.fetchedAt! <= CACHE_RETENTION_MS
            ? { ...previous, stale: true }
            : { address, balanceRaw: null, receivableRaw: null, opened: null, fetchedAt: null, stale: false });
        }
      }
      return {
        results: unique.map((address) => resolved.get(address) ?? { ...cached.get(address)!, stale: false }),
        degraded, ttlMs: CACHE_TTL_MS, servedAt: now(),
      };
    },
  };
}
