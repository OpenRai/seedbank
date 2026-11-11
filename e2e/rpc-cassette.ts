import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const recording = process.env.E2E_RECORD_RPC === '1';
if (recording && process.env.CI) throw new Error('RPC recording is forbidden in CI');
const endpoint = process.env.E2E_RECORD_RPC_URL ?? 'https://dev-rpc.nanosweeper.lol/rpc';
interface Cassette {
  recordedAt: string;
  endpoint: string;
  request: { jsonrpc: '2.0'; id: number; method: string; params: Record<string, unknown> };
  response: { status: number; contentType: string; body: string };
  elapsedMs: number;
}
const inFlight = new Map<string, Promise<Cassette>>();

/** Full wire recordings; only account order and JSON-RPC correlation IDs are canonicalized. */
export async function rpcReplay(method: string, params: Record<string, unknown>) {
  if (!['accounts_balances', 'accounts_frontiers'].includes(method)) throw new Error(`Unrecordable RPC method: ${method}`);
  const canonical = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
  if (Array.isArray(canonical.accounts)) canonical.accounts = [...canonical.accounts].sort();
  const key = createHash('sha256').update(JSON.stringify({ method, params: canonical })).digest('hex');
  const file = new URL(`./fixtures/rpc/${key}.json`, import.meta.url);
  const load = async (): Promise<Cassette> => {
    if (!recording) {
      try { return JSON.parse(await readFile(file, 'utf8')); }
      catch { throw new Error(`Missing RPC cassette for ${method} (${key}). Run npm run test:e2e:record explicitly.`); }
    }
    const request = { jsonrpc: '2.0' as const, id: 1, method, params: canonical };
    const started = performance.now();
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    const envelope = JSON.parse(body);
    if (!response.ok || envelope.error || !('result' in envelope)) throw new Error(`Cannot record successful ${method}: ${body}`);
    const cassette: Cassette = { recordedAt: new Date().toISOString(), endpoint, request, response: { status: response.status, contentType: response.headers.get('content-type') ?? 'application/json', body }, elapsedMs: Math.round(performance.now() - started) };
    await writeFile(file, JSON.stringify(cassette, null, 2) + '\n');
    return cassette;
  };
  let pending = inFlight.get(key);
  if (!pending) { pending = load(); inFlight.set(key, pending); }
  const cassette = await pending;
  if (!recording) await delay(cassette.elapsedMs);
  return { cassette, envelope: JSON.parse(cassette.response.body) };
}
