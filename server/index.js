/**
 * NanoSeeds production server.
 *
 * Serves the built SPA and a small JSON API:
 *
 *   GET  /api/health                  process + cache + RPC node summary
 *   POST /api/account-state           { addresses: string[] } -> public state
 *
 * Public account state is cached in SQLite for `CACHE_TTL_MS` (default 1h)
 * and refreshed through the plural RPC methods on a random public node.
 * Private keys, seeds, and mnemonics never reach this process.
 */

import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { AccountCache } from './cache.js';
import { NanoRpcClient } from './rpc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const CACHE_FILE = process.env.CACHE_DB ?? join(ROOT, 'data', 'cache.sqlite');
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 60 * 60 * 1000);
const ADDRESS_LIMIT = Number(process.env.ADDRESS_LIMIT ?? 100);
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120);
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS ?? 10_000);
const RPC_NODES = (process.env.RPC_NODES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((url, i) => ({ name: `node-${i + 1}`, url }));

const ALPHABET = '13456789abcdefghijkmnopqrstuwxyz';
const ADDRESS_RE = new RegExp(`^(nano_|xrb_)[${ALPHABET}]{60}$`);

const cache = new AccountCache({ file: CACHE_FILE, ttlMs: CACHE_TTL_MS });
const rpc = new NanoRpcClient({ nodes: RPC_NODES, timeoutMs: RPC_TIMEOUT_MS });

/** Missing/expired rows per address, so concurrent callers share one fetch. */
const inFlight = new Map();

const UNKNOWN_STATE = {
  balanceRaw: '0',
  receivableRaw: '0',
  opened: false,
};

/**
 * Resolve addresses to public state, refreshing only cache misses in a single
 * batched RPC round-trip and reusing stale rows as a last-resort fallback.
 */
async function resolveAddresses(addresses) {
  const unique = [...new Set(addresses)];
  const now = Date.now();
  const cached = cache.getMany(unique, now);

  const toFetch = unique.filter((a) => !cached.get(a) || cached.get(a).stale);
  let rpcError = null;

  if (toFetch.length > 0) {
    try {
      const fresh = await fetchWithDedup(toFetch);
      const before = cache.getMany(unique, now);
      return {
        results: unique.map((address) => {
          const row = fresh.get(address) ?? before.get(address);
          if (!row) return { address, ...UNKNOWN_STATE, stale: true, fetchedAt: null };
          return { ...row, stale: false };
        }),
        rpcError,
      };
    } catch (error) {
      rpcError = error.message ?? String(error);
    }
  }

  return {
    results: unique.map((address) => {
      const row = cached.get(address);
      if (!row) return { address, ...UNKNOWN_STATE, stale: true, fetchedAt: null };
      return { ...row, stale: true };
    }),
    rpcError,
  };
}

/** Collapse concurrent RPC fetches for the same addresses into one request. */
async function fetchWithDedup(addresses) {
  const mine = addresses.filter((a) => !inFlight.has(a));
  const others = addresses.filter((a) => inFlight.has(a)).map((a) => inFlight.get(a));

  let started = Promise.resolve();
  if (mine.length > 0) {
    started = (async () => {
      const states = await rpc.fetchState(mine);
      const fetchedAt = Date.now();
      cache.setMany(states.map((s) => ({ ...s, fetchedAt })));
    })().finally(() => {
      for (const address of mine) inFlight.delete(address);
    });
    for (const address of mine) inFlight.set(address, started);
  }

  await Promise.all([started, ...others]);
  return cache.getMany(addresses, Date.now());
}

/* ------------------------------------------------------------------ */
/* Rate limiting (per IP, fixed window)                                */
/* ------------------------------------------------------------------ */

const rateBuckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (now - bucket.start > 60_000) rateBuckets.delete(key);
}, 60_000).unref();

function rateLimit(req, res, next) {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > 60_000) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT) {
    res.status(429).json({ error: 'Too many requests, slow down a little.' });
    return;
  }
  next();
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    cacheTtlMs: CACHE_TTL_MS,
    cachedAccounts: cache.count(),
    rpcNodes: rpc.nodeNames,
  });
});

app.post('/api/account-state', rateLimit, async (req, res) => {
  const addresses = req.body?.addresses;
  if (!Array.isArray(addresses) || addresses.length === 0) {
    res.status(400).json({ error: 'Provide a non-empty "addresses" array.' });
    return;
  }
  if (addresses.length > ADDRESS_LIMIT) {
    res.status(400).json({ error: `At most ${ADDRESS_LIMIT} addresses per request.` });
    return;
  }
  const invalid = addresses.filter((a) => typeof a !== 'string' || !ADDRESS_RE.test(a));
  if (invalid.length > 0) {
    res.status(400).json({ error: 'One or more addresses are not valid Nano addresses.' });
    return;
  }

  try {
    const { results, rpcError } = await resolveAddresses(addresses);
    res.setHeader('cache-control', 'no-store');
    res.json({
      ttlMs: CACHE_TTL_MS,
      servedAt: Date.now(),
      degraded: Boolean(rpcError),
      results: results.map((r) => ({
        address: r.address,
        balanceRaw: r.balanceRaw,
        receivableRaw: r.receivableRaw,
        opened: r.opened,
        stale: Boolean(r.stale),
        fetchedAt: r.fetchedAt ?? null,
      })),
    });
  } catch (error) {
    res.status(502).json({ error: error.message ?? 'Upstream failure' });
  }
});

const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', extensions: ['html'] }));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const server = app.listen(PORT, HOST, () => {
  console.log(`NanoSeeds listening on http://${HOST}:${PORT}`);
  console.log(`Cache: ${CACHE_FILE} (ttl ${CACHE_TTL_MS} ms) · RPC: ${rpc.nodeNames.join(', ')}`);
});

const pruneTimer = setInterval(() => cache.prune(), 15 * 60_000);
pruneTimer.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(pruneTimer);
    server.close(() => {
      cache.close();
      process.exit(0);
    });
  });
}
