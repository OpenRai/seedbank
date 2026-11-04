# seedbank

**seedbank.openrai.org** — a browser over the Nano keyspace.

Browse any pageful of Nano private keys or mnemonic seeds. Every value is
derived at view-time from its position in the 2^256 keyspace; nothing is
pregenerated, indexed, or stored. Balances are the only thing fetched from the
network, proxied through this server and cached in SQLite for an hour.

## What it does

Two views, both with First / Previous / Random / Next / Last and a page jump:

- **Private keys** — page `p` covers 256-bit integers `(p-1)*20 .. (p-1)*20+19`.
  Each is turned into an ED25519 account and a `nano_` address.
- **Mnemonic seeds** — the same idea over BIP39 entropy pools, with a word
  count (12/24), a derivation method, and an account index.

Nothing else. There is no key converter, no seed scanner, and no wallet.

Every page is shareable: `?view=mnemonics&page=42&words=24&method=legacy`
reproduces the same twenty accounts when no passphrase is used. Passphrases stay in the tab, are excluded from links, and must be re-entered after reload.

## Derivation methods

| Method | How a phrase becomes a key | Subaccounts | Used by |
| --- | --- | --- | --- |
| **BIP39 → SLIP-0010** | `mnemonicToSeed` → `m/44'/165'/i'` | 2³¹ | Ledger, Magnum, Trust, Cake, Ian Coleman |
| **BIP39 → SLIP-0010 (account)** | `mnemonicToSeed` → `m/44'/165'/i'/0'` | 2³¹ | Wallets that mirror the BIP44 account/change level |
| **Legacy Nano seed** | The 256-bit entropy *is* the seed; `BLAKE2b-256(seed ‖ uint32BE(i))` | 2³² | Natrium, Kalium, Exodus, Cannon |
| **BIP39 seed → Nano seed** | `mnemonicToSeed` → take the first 32 bytes as a Nano seed → `BLAKE2b-256(seed ‖ uint32BE(i))` | 2³² | The "BIP39 seed as Nano seed" pattern |

The passphrase (the BIP39 "25th word") changes the result for every
BIP39-based method. It has no effect on the legacy Nano method, which does not
run through BIP39 at all.

Account index bounds follow the protocol: hardened SLIP-0010 path segments
reserve the top bit, so the two SLIP-0010 methods cap at 2³¹−1. The two
BLAKE2b methods take a full uint32, so they reach 2³²−1.

Protocol primitives implemented in `src/lib/nano.ts`:

- **Public key**: ED25519 with BLAKE2b-512 (not SHA-512), scalar clamped then
  reduced modulo the curve order.
- **Address**: 4 zero bits + 256-bit public key encoded as 52 base32 symbols,
  plus a reversed BLAKE2b-40 checksum. Both `nano_` and legacy `xrb_` supported.
- **Nano seed**: `privateKey[i] = BLAKE2b-256(seed ‖ uint32BE(i))`.

The BIP39 word list is bundled locally (`src/lib/wordlist.ts`) and the seed uses
WebCrypto's native PBKDF2 (`src/lib/seed.ts`), which is roughly fifty times
faster than the JavaScript implementation in the reference `bip39` package.

## Running it

Node 26 is required (the cache uses the built-in `node:sqlite` module, so there
is no native build step and no third-party driver).

```bash
nvm use            # reads .nvmrc
npm install
npm run build      # typecheck + Vite production build
npm run server     # serves dist/ and /api on :8787
```

For development, run the API and the Vite dev server side by side; Vite proxies
`/api` to port 8787:

```bash
npm run server   # terminal 1
npm run dev      # terminal 2
```

Run the tests:

```bash
npm test         # 27 tests: derivation vectors + cache/RPC behaviour
```

## Server API

### `POST /api/account-state`

```jsonc
// request — public addresses only
{ "addresses": ["nano_1e5aqegc1jb7qe964u4adzmcezyo6o146zb8hm6dft8tkp79za3sxwjym5rx"] }
```

```jsonc
// response
{
  "ttlMs": 3600000,
  "servedAt": 1793690900829,
  "degraded": false,
  "results": [
    {
      "address": "nano_1…",
      "balanceRaw": "0",          // exact raw integer, never a float
      "receivableRaw": "0",
      "opened": true,
      "stale": false,
      "fetchedAt": 1793690900828
    }
  ]
}
```

The server resolves cache misses with **two** upstream calls per batch —
`accounts_balances` and `accounts_frontiers` — regardless of how many addresses
were requested. It never issues a per-address RPC call.

### `GET /api/health`

Cache TTL, cached account count, and the configured RPC node names.

## Caching

`server/cache.js` keeps public ledger state in SQLite (`data/cache.sqlite`)
through Node's built-in `node:sqlite` module:

```sql
CREATE TABLE account_cache (
  address        TEXT PRIMARY KEY,
  balance_raw    TEXT NOT NULL,
  receivable_raw TEXT NOT NULL,
  opened         INTEGER NOT NULL,
  fetched_at     INTEGER NOT NULL
) WITHOUT ROWID;
```

- WAL journal mode, 5 s busy timeout, one transaction per refresh batch.
- Rows expire after `CACHE_TTL_MS` (default 1 hour) and are then refetched.
- Expired rows survive up to 24 h so they can be served, clearly flagged
  `stale: true` and `degraded: true`, when every RPC node is unreachable.
- A pruning timer deletes rows past the retention window every 15 minutes.
- Concurrent requests for the same address share one in-flight fetch.

Only public addresses and balances are ever written. Private keys, seeds, and
mnemonics never leave the browser tab.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `TRUST_PROXY` | unset (disabled) | Comma-separated trusted proxy IPs or CIDRs; configure only for your deployment proxy |
| `HOST` | `0.0.0.0` | Listen address |
| `CACHE_DB` | `./data/cache.sqlite` | SQLite file path |
| `CACHE_TTL_MS` | `3600000` | Cache lifetime (1 hour) |
| `ADDRESS_LIMIT` | `100` | Max addresses per API request |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per-IP request budget |
| `RPC_TIMEOUT_MS` | `10000` | Per-node RPC timeout |
| `RPC_NODES` | rainstorm.city, nanoslo.0x.no, rpc.nano.to | Comma-separated node URLs |

## Layout

```
src/lib/nano.ts         protocol primitives (keys, addresses, seeds, SLIP-0010)
src/lib/mnemonic.ts     entropy -> BIP39 phrase (bundled word list)
src/lib/seed.ts         BIP39 seed via WebCrypto PBKDF2
src/lib/wordlist.ts     the 2048-word BIP39 English word list
src/lib/keyspace.ts     page maths: totals, coverage, formatting
src/lib/derivePage.ts   page index -> 20 derived rows
src/lib/urlState.ts     shareable ?view=&page=&words=&method=&account= links
src/hooks/              page derivation and balance-fetch state
src/components/         table, rows, copy/reveal controls, icons
server/index.js         Express app, rate limiting, SPA fallback
server/cache.js         SQLite TTL cache
server/rpc.js           plural-method RPC client with failover
test/                   derivation vectors, cache and RPC cost tests
```

## A note on keys

Seeing a private key on this site does not give anyone access to funds that are
not already theirs; every 256-bit value exists whether or not this page renders
it. The real advice is the opposite one: never paste a seed you actually use
into a website, including this one.

## GitHub Pages

The static frontend is published from `main` by `.github/workflows/pages.yml`.
GitHub Pages serves the site at `https://seedbank.openrai.org`; the repository
contains the matching `public/CNAME` file. DNS for `seedbank.openrai.org` must
point to GitHub Pages.

GitHub Pages only hosts the static frontend. Balance lookups require the
Express API in `server/`, which must be hosted separately and made available at
`/api` on the site origin (or the client API URL must be configured for the
chosen backend host).
