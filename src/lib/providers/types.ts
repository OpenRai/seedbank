export interface AccountState {
  address: string;
  balanceRaw: string | null;
  receivableRaw: string | null;
  opened: boolean | null;
  stale: boolean;
  fetchedAt: number | null;
}

export interface AccountStateResponse {
  ttlMs: number;
  servedAt: number;
  degraded: boolean;
  results: AccountState[];
}

/** Every provider returns this shape; null means unknown, never zero. */
export interface AccountStateProvider {
  fetchAccountStates(addresses: string[], signal?: AbortSignal): Promise<AccountStateResponse>;
}
