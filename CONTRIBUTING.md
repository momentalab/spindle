# Contributing to spindle

Thanks for your interest in improving spindle! This guide is the front door —
the in-depth conventions and the verification-script pattern live in
[DEVELOPMENT.md](./DEVELOPMENT.md).

## Prerequisites

- **Node.js 24+** — enforced via `engines` + `engine-strict` (`@zxing/library` requires it)
- npm — the lockfile is committed, so use `npm install` (not yarn/pnpm)

No environment variables are required to develop: the Discogs credentials
(`DISCOGS_CONSUMER_KEY` / `DISCOGS_CONSUMER_SECRET`, see `.env.example`) are
optional — the app runs fully without them, at Discogs' unauthenticated rate
limit (25 req/min instead of 60).

## The loop

After cloning and `npm install`:

```sh
npm run dev      # dev server at http://localhost:5173
npm run check    # type-check + Svelte diagnostics — must be clean before a change is done
npm run build    # production build (adapter-node → build/) — must succeed
```

## Conventions that matter

The full list is in [DEVELOPMENT.md](./DEVELOPMENT.md); the short version:

- **Local-first** — nothing may depend on the network at render time. Discogs is
  an import-time source of truth only; local data stays fully usable offline.
- **Money is integer cents** everywhere — never store or compute float dollars.
- **Server-only data access** lives in `src/lib/server/*`; route handlers stay thin.
- **New server logic gets a verification script** in `scripts/` (house pattern:
  seed a scratch database, assert exact values) — DEVELOPMENT.md has the template.

## Pull requests

- Keep changes minimal and focused; match the existing style (Prettier is
  configured — `npm run format`).
- No new runtime dependencies without a clear reason: the app ships as one
  container, so every dependency is a supply-chain and image-size cost.
- CI runs `check` + `build` on Node 24 / Linux x64 and must be green.
