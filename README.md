# seedbank

A browser for the Nano keyspace. Choose a page of private keys or mnemonic seed phrases, then inspect the derived account addresses and public balances. Seed phrases support 12 or 24 words and several Nano derivation methods. Keys and passphrases stay in the browser tab. Balance lookups send account addresses only.

## Develop

Requires Node.js 26 and npm.

```sh
npm ci
```

Start the API and frontend in separate terminals:

```sh
npm run server  # API on http://localhost:8787
npm run dev     # site on http://localhost:5173
```

The local frontend uses the API proxy by default. To try direct browser lookups, add `?lookups=nano-rpc` to the URL. For `?lookups=json-rpc`, set `VITE_JSON_RPC_URL` to the full `/rpc` URL of a gateway in `.env` and restart Vite. See [.env.example](.env.example) for other settings.

## ill-nan view

`/?view=ill-nan` replays the CryptoJS 3.1.9-1 randomness bug that affected NanChat before v1.3.0. `WordArray.random(32)` is seeded by a single 32-bit `Math.random()` value and adds 15 effective sign bits, so it could produce at most about 2^47 distinct 32-byte entropies instead of 2^256. Each candidate is expanded through the real vulnerable pipeline — BIP39 24-word mnemonic → PBKDF2-SHA512 seed → SLIP-0010 Ed25519 `m/44'/165'/0'` — and shown with its private key, public key, and Nano address.

The page keeps the full 2^256 progress bar as a scale reference and marks the entire 2^47 subset in red; a zoomed bar navigates the vulnerable space. The candidate search and page controls reach any of the 140,737,488,355,328 positions.

The space is shared, not per-user: every vulnerable wallet from every user, browser, and session is a point in the same 2^47 set, and a different `Math.random()` stream only selects a different point. Each wallet therefore has at most 47 bits of entropy. This is an educational reconstruction, not a wallet recovery tool: a specific victim's `Math.random()` stream cannot be reconstructed from a position.

## Test

```sh
npm test       # derivation, page math, RPC providers, and cache rules
npm run build  # typecheck and production bundle
npm audit      # dependency advisories
```
