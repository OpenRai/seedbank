import { withAccountCache } from './cache/cachedProvider';
import { createBrowserAccountCache } from './cache/browserCache';
import { lookups } from './lookups';
import { createProxyProvider } from './providers/proxy';
import { createNanoRpcProvider, createJsonRpcProvider } from './providers/rpc';
import type { AccountStateProvider } from './providers/types';

export type { AccountState, AccountStateResponse } from './providers/types';

const urls = (import.meta.env.VITE_NANO_RPC_URLS || '').split(',').map((url: string) => url.trim()).filter(Boolean);
const providers: Record<typeof lookups, () => AccountStateProvider> = {
  proxy: () => createProxyProvider(),
  'nano-rpc': () => createNanoRpcProvider(urls.length ? urls.map((url: string, i: number) => ({ name: `node-${i + 1}`, url })) : undefined),
  'json-rpc': () => createJsonRpcProvider(import.meta.env.VITE_JSON_RPC_URL || ''),
};
const source = providers[lookups]();
const provider = lookups === 'proxy' ? source : withAccountCache(source, createBrowserAccountCache());

export function fetchAccountStates(addresses: string[], signal?: AbortSignal) {
  return provider.fetchAccountStates(addresses, signal);
}
