# Agent Instructions

## Development

- Use Node.js 26 and npm.
- Run the API and Vite frontend in separate terminals for local development:
  - `npm run server` starts the Express API on `http://localhost:8787`.
  - `npm run dev` starts Vite on `http://localhost:5173`.
- Vite proxies `/api` requests to `http://localhost:8787`; start both processes when testing the local app.

## Commands

| Task | Command |
| --- | --- |
| Tests | `npm test` |
| Type check | `npm run typecheck` |
| Production build | `npm run build` |
