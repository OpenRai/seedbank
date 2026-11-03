/**
 * Read-only client for the NanoSeeds balance proxy.
 *
 * Only public addresses are ever sent. The server batches upstream RPC calls
 * and caches the results in SQLite.
 */

export interface AccountState {
  address: string;
  balanceRaw: string;
  receivableRaw: string;
  opened: boolean;
  stale: boolean;
  fetchedAt: number | null;
}

export interface AccountStateResponse {
  ttlMs: number;
  servedAt: number;
  degraded: boolean;
  results: AccountState[];
}

export async function fetchAccountStates(addresses: string[], signal?: AbortSignal): Promise<AccountStateResponse> {
  const response = await fetch('/api/account-state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ addresses }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(detail.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as AccountStateResponse;
}
