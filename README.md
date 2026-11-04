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

## Test

```sh
npm test       # derivation, page math, RPC providers, and cache rules
npm run build  # typecheck and production bundle
npm audit      # dependency advisories
```
