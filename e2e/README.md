# Browser tests

Run `npm run build`, `npx playwright install chromium`, then `npm run test:e2e`.
The same scenarios run as three Chromium projects: `proxy`, `nano-rpc`, and `json-rpc`.
Run one with `npm run test:e2e -- --project=json-rpc`.
The tests serve the production build on port 49173 and replay committed RPC recordings.
Unexpected requests and missing recordings fail; they never contact upstream services.

## Refreshing RPC recordings

Run `npm run test:e2e:record` explicitly. It queries the read-only JSON-RPC gateway at
`https://dev-rpc.nanosweeper.lol/rpc`. Override with `E2E_RECORD_RPC_URL` if needed.
Recording is forbidden when `CI` is set. Review and commit changes under `fixtures/rpc/`.

Each cassette contains the complete request, response body, HTTP status, content type,
recording timestamp and elapsed milliseconds. Account order and JSON-RPC IDs are normalized
for matching; IDs are restored for the caller. Replay applies the recorded elapsed time.
Proxy fixtures pass the recorded wire data through the real Nano RPC client to produce the
proxy response shape. Private keys, mnemonic phrases and BIP39 passphrases are never sent
to the recording endpoint.

Each project checks the actual request format so a missing URL override cannot silently
exercise another adapter. Keep a valid `VITE_JSON_RPC_URL` in the build configuration;
replay intercepts that URL without contacting it. The Pages workflow supplies the public
dev gateway as its fallback. All three projects must pass before deployment.
