import { NanoRpcClient, DEFAULT_NODES } from '../../../shared/nanoRpc.js';
import type { AccountStateProvider } from './types';

interface RpcNode { name: string; url: string }

// Both wire adapters feed the same batch parser, validation, and failover.
function rpcProvider(nodes: RpcNode[], fetchImpl: typeof fetch): AccountStateProvider {
  return {
    async fetchAccountStates(addresses, signal) {
      const client = new NanoRpcClient({ nodes, fetchImpl: (url, init) => fetchImpl(url, {
        ...init, signal: signal && init?.signal ? AbortSignal.any([signal, init.signal]) : signal ?? init?.signal,
      }) });
      const results = await client.fetchState(addresses);
      const now = Date.now();
      return { results: results.map((state) => ({ ...state, stale: false, fetchedAt: now })), servedAt: now, ttlMs: 0, degraded: false };
    },
  };
}

export function createNanoRpcProvider(nodes: RpcNode[] = DEFAULT_NODES, fetchImpl: typeof fetch = fetch): AccountStateProvider {
  return rpcProvider(nodes, fetchImpl);
}

export function createJsonRpcProvider(url: string, fetchImpl: typeof fetch = fetch): AccountStateProvider {
  let nextId = 0;
  return rpcProvider([{ name: 'gateway', url: url || 'https://unconfigured.invalid' }], async (endpoint, init) => {
    if (!url) throw new Error('VITE_JSON_RPC_URL is required for json-rpc lookups.');
    const { action: method, ...params } = JSON.parse(String(init?.body));
    const id = ++nextId;
    const response = await fetchImpl(endpoint, { ...init, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    if (!response.ok) return response;
    const envelope = await response.json();
    if (!envelope || envelope.jsonrpc !== '2.0' || envelope.id !== id) throw new Error('Invalid JSON-RPC response');
    if (envelope.error) throw new Error(envelope.error.message || 'JSON-RPC error');
    if (!('result' in envelope)) throw new Error('Missing JSON-RPC result');
    return Response.json(envelope.result);
  });
}
