import type { AccountState, AccountStateProvider } from './types';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function raw(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) < (1n << 128n);
}

export function createProxyProvider(fetchImpl: typeof fetch = fetch): AccountStateProvider {
  return {
    async fetchAccountStates(addresses, signal) {
      const response = await fetchImpl('/api/account-state', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ addresses }), signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(record(payload) && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
      if (!record(payload) || !Array.isArray(payload.results) || typeof payload.degraded !== 'boolean' ||
          typeof payload.ttlMs !== 'number' || typeof payload.servedAt !== 'number') throw new Error('Invalid proxy response');
      const entries = new Map<string, AccountState>();
      for (const entry of payload.results) {
        if (!record(entry) || typeof entry.address !== 'string' || typeof entry.stale !== 'boolean') throw new Error('Invalid proxy account');
        const { balanceRaw, receivableRaw, opened, fetchedAt } = entry;
        const known = raw(balanceRaw) && raw(receivableRaw) && typeof opened === 'boolean' &&
          typeof fetchedAt === 'number' && Number.isFinite(fetchedAt);
        if (!known && !(entry.balanceRaw === null && entry.receivableRaw === null && entry.opened === null && entry.fetchedAt === null)) {
          throw new Error('Invalid proxy account state');
        }
        if (known) {
          entries.set(entry.address, { address: entry.address, balanceRaw, receivableRaw, opened, fetchedAt, stale: entry.stale });
        } else {
          entries.set(entry.address, { address: entry.address, balanceRaw: null, receivableRaw: null, opened: null, fetchedAt: null, stale: false });
        }
      }
      const results = [...new Set(addresses)].map((address): AccountState => entries.get(address) ?? {
        address, balanceRaw: null, receivableRaw: null, opened: null, fetchedAt: null, stale: false,
      });
      return {
        results, ttlMs: payload.ttlMs, servedAt: payload.servedAt,
        degraded: payload.degraded || results.some((state) => state.fetchedAt === null),
      };
    },
  };
}
