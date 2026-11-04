import type { AccountState } from '../providers/types';

export type CacheOperation = { command: 'read'; addresses: string[] } | { command: 'write'; states: AccountState[] };
export type CacheRequest = CacheOperation & { id: number };
export type CacheResponse = { id: number; results: AccountState[] } | { id: number; error: string };
