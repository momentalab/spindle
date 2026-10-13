# Development notes

The day-to-day loop for building and testing spindle — what's not covered by the README.

## Layout

```
src/
  lib/
    types.ts                 # shared row/draft types + enums (conditions, statuses)
    draft.ts                 # client↔server form-state helpers
    components/TrendChart.svelte   # hand-rolled SVG line/area chart with tooltips (no chart lib)
    server/
      db.ts                  # better-sqlite3 singleton (auto-creates schema on first open)
      paths.ts               # data-dir resolution (DATA_DIR)
      discogs.ts             # Discogs API client (search by barcode, release detail, marketplace)
      importer.ts            # importRecord(): local cover download + insert
      reidentify.ts          # re-fetch a wrongly-picked release and overwrite the record
      enrichment.ts          # fold a fetched release into local data (tracklist, snapshot)
      records.ts             # all record SQL: list/search/sort/filter, CRUD, photos, plays
      value.ts               # market-value layer: portfolio stats/history, per-record quote log
      stats.ts               # /stats aggregates (pure reads)
      catalogue.ts           # printable-catalogue page model (shared by HTML + PDF surfaces)
      catalogue-pdf.ts       # PDF rendering of the catalogue
      artist.ts              # artist-name normalization (leading-word-first)
      tracks.ts              # tracklist data access
      covers.ts              # missing-cover detection + repair/override
      settings.ts            # /settings summary: credentials, storage, preferences
      export.ts              # collection export: CSV + JSON renderers
      backup.ts              # backup zip (archiver) + validated restore (.pre-restore snapshot)
  routes/
    +page.*                  # collection home: cards/table/list, search & filters
    scan/+page.svelte        # barcode scanner (camera) + manual entry fallback
    import/barcode/[barcode]/  # Discogs lookup + candidate picker + save
    import/manual/+page.*    # no-barcode entry
    records/[id]/+page.*     # detail: edit form, photos, market value, tracklist, plays
    value/+page.*            # portfolio value: history chart (tooltips) + snapshot controls
    stats/+page.*            # collection stats
    print/+page.*            # printable catalogue
    covers/+page.*           # missing-cover repair
    settings/+page.*         # preferences + Discogs connection status
    api/import/+server.ts    # JSON lookup endpoint (candidate expansion)
    api/search/+server.ts    # name-based search (Discogs candidates + local matches)
    api/list/+server.ts      # full collection dump for client-side filtering
    api/export/+server.ts    # GET collection export (csv|json, table=records|photos)
    api/backup/+server.ts    # POST whole-collection zip download (db checkpointed + media/)
    api/restore/+server.ts   # POST backup zip restore (validated, .pre-restore snapshot)
    api/discogs-check/+server.ts  # connection probe for the settings page
    api/settings/+server.ts  # data-backed preferences
    api/value/snapshot/+server.ts # POST market-price snapshot (append-only log)
    api/value/history/+server.ts  # DELETE price history (whole log or one record)
    api/records/[id]/photos/+server.ts  # photo upload/delete (multipart)
    media/[...file]/+server.ts           # local media serving (traversal-guarded)
```

## The usual checks

```sh
npm run check    # svelte-check: types + Svelte diagnostics across the project
npm test         # verification scripts (current-logic subset; same suite CI runs)
npm run build    # production build (adapter-node → build/)
npm run dev      # dev server at http://localhost:5173
```

Run `check`, `test`, and `build` before calling a change done. svelte-check catches Svelte 5 gotchas that tsc alone misses — e.g. `$derived(() => …)` silently creates a derived _whose value is the function_; multi-line derivations need `$derived.by(() => { … })`.

## Testing server logic: verification scripts

The data layer (`src/lib/server/*.ts`) has no test framework. Instead there are **verification scripts** in `scripts/` — plain Node programs that seed a scratch database, exercise the functions under test, and assert with `node:assert`. **CI runs a subset**: `npm test` (via `scripts/ci-verify.mjs`, wired into GitHub Actions) bundles and runs the scripts that cover _current_ logic — `smoke-db`, `verify-catalogue`, `verify-portfolio`, `verify-value-snapshot`, `verify-value`. The `*-migration.ts` scripts pin one-off historical migrations and are run on demand, not on every PR; the backup pair and `verify-stats-s1.ts` stay manual (running production build / real DB).

- `scripts/verify-bundle.mjs` — the bundler every other script goes through (house pattern)
- `scripts/verify-value.ts` — the `/value` data layer: `portfolioStats()`, quote log, P&L, cascades
- `scripts/verify-portfolio.ts` — `portfolioHistory()` + `recordMarket()` (the `/value` portfolio chart and per-record trendline)
- `scripts/verify-catalogue.ts` — printable-catalogue page model: pagination, column placement, detail geometry, empty case
- `scripts/verify-genre-migration.ts`, `verify-style-label-migration.ts`, `verify-tracks-migration.ts`, `verify-wishlist-migration.ts`, `verify-settings-migration.ts` — schema migrations: backfills, junction splits, row-count preservation, FK cascades
- `scripts/smoke-db.ts` — DB-layer smoke test (`npm run smoke:db`): migrations, insert/read-back, FK cascades
- `scripts/backup-seed.mjs` + `scripts/backup-roundtrip.mjs` — end-to-end backup/restore against a **running production build** (manual)
- `scripts/verify-stats-s1.ts` — read-only aggregate dump for the stats suite; the one script that deliberately reads the real DB (read-only)

### Running one

Server modules pull in SvelteKit aliases (`$lib`, `$env/dynamic/private`) that Node can't resolve on its own, so the script must be **bundled first**. The house bundler is `scripts/verify-bundle.mjs` (rolldown — Vite 8 ships rolldown, not esbuild, so there is no `node_modules/.bin/esbuild` in this repo):

```sh
node scripts/verify-bundle.mjs scripts/verify-portfolio.ts .verify-portfolio.mjs \
  && DATA_DIR=.scratch/verify-portfolio/data node .verify-portfolio.mjs; rm -f .verify-portfolio.mjs
```

Each script's header comment carries its own copy of this command (swap in the script name).

### Why the bundler exists

- **`DATA_DIR` on the command line** — `paths.ts` reads `process.env.DATA_DIR` at _module init_, and in an ESM bundle every module's init runs before the entry's own statements. Setting the env var inside the script is too late; the shell must set it, matching the script's scratch path.
- **Aliases** — a `resolveId` plugin maps `$lib/*` → `src/lib/*.ts` (rolldown won't probe for the `.ts` extension itself) and `$env/dynamic/private` → `scripts/env-stub.ts`, which keeps any env-touching module inert under bare Node.
- **ESM output + `codeSplitting: false`** — the scripts use top-level `await import()`, which rolldown can't wrap in CJS and which would otherwise split the bundle into chunks; a single self-contained file keeps the run command simple.
- **Externals** — native/heavy CJS deps (`better-sqlite3`, `sharp`, `archiver`, `pdfkit`) and `node:*` builtins stay out of the bundle; Node loads them directly.

### Scratch-DB conventions

Verification scripts must **never touch the real database**:

- Use a dedicated scratch path — `.scratch/<name>/data` inside the project (gitignored via `/.scratch`). The repo convention is in-project so scripts also work in restricted environments; `/tmp` is fine from an ordinary shell.
- Open the DB and **assert the opened path** before doing anything (`db.name.includes(…)` guard) — belt and braces against a missing env var silently pointing at `./data`.
- Migrations are idempotent, so just **truncate the tables** the script seeds (`DELETE FROM …`) instead of deleting the DB file — unlinking may not be permitted.
- Seed deterministic data (explicit dates computed relative to "now"), call the function under test, and assert exact numbers. The expectations _are_ the spec: when an assertion fails, work out whether the code or the expectation is wrong before touching either — in this repo, both have been the culprit.

### Adding a verification script for new logic

1. Write the server function (in `src/lib/server/`, pure read or explicit mutation).
2. Copy the header + setup block from `verify-portfolio.ts` (scratch dir, env, guard, truncate).
3. Seed the minimal data that separates the behaviours you care about — e.g. one unquoted record, one sold mid-history, one wanted row; each forces a different branch.
4. Assert exact values, with messages that state the convention being tested.
5. Run it, then `npm run check` and `npm run build`.

## Conventions worth knowing before editing

- **Money is integer cents everywhere.** Display with `(c / 100).toFixed(2)`; never store floats.
- **`market_prices` is append-only.** Latest quote = last row `ORDER BY id`; `price_cents IS NULL` means "no live listings that day" — a data point, not missing data. The trendline filters nulls out; the portfolio mark keeps the last _priced_ quote.
- **Portfolio worth is point-in-time** (`portfolioHistory()`): month M is marked at each record's last priced quote on/before M, else cost. A quote from March must never leak into February. The current month therefore equals `portfolioStats().market_value_cents`.
- **Wanted rows are off the books** — they never enter history, P&L, or shelf counts.
- **User dates are local-calendar `YYYY-MM-DD` strings.** Month math goes through local `new Date(y, m, d)`, not UTC — UTC month-ends render as the _next_ month for users east of UTC.
- **No chart libraries.** Charts are hand-rolled SVG (`src/lib/components/TrendChart.svelte`), themed with the CSS variables in `src/routes/layout.css` (`--accent`, `--chart-slate`, `--forest`/`--rust` for +/−, hairlines). TrendChart assumes all series share x positions.
- **Svelte 5 runes**: `$derived.by(() => {…})` for multi-line derivations; `$props()` for component props.
