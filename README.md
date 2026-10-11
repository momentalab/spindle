# spindle 🎵

A **local-first** vinyl record collection tracker. Scan a barcode, pull metadata from Discogs, and keep it — the data lives in a local SQLite database, not on Discogs.

## Features

- **Barcode scanning** — camera-based EAN-13/UPC-A scan (native `BarcodeDetector` where available, ZXing JS fallback) plus manual entry
- **Discogs import** — search by barcode, review candidates, and save the release; cover art is **downloaded locally** at import time so the collection browses offline
- **Local-first storage** — SQLite (`data/spindle.db`) + media files (`data/media/`). Discogs is a one-time source of truth; every field is editable afterwards and never overwritten by Discogs
- **Extended schema** — beyond Discogs: condition (media/sleeve), price paid, acquired date, source, copies, limited-edition flag, status, and free-form notes
- **Three views** — cards, table (sortable columns), and list, with search + genre/label/status filters
- **Photos** — upload images of your actual records (client-side downscale to ~1600px JPEG before storage)
- **Export** — take the whole collection out as CSV or JSON, from the home page or `GET /api/export`
- **Backup & restore** — download the entire collection (SQLite DB + every cover and photo) as a single zip, and restore it from that zip on any machine; restores validate before touching anything and keep the previous generation in `data/.pre-restore`

## Requirements

- Node.js 24+ (`@zxing/library` requires it; the Docker image uses Node 24 LTS)
- Camera access over **localhost or HTTPS** (browsers require a secure context for `getUserMedia`). For on-lan testing, Vite serves on your network IP / Tailscale address.

## Development

```sh
npm install
npm run dev
```

Open http://localhost:5173 — scan a barcode or add records manually at `/import/manual`.

## Production (direct Node)

```sh
npm run build     # type-check + build (adapter-node → build/)
PORT=3000 node build/index.js
```

The data directory defaults to `./data` and can be relocated with `DATA_DIR=/path/to/data`.

## Deployment (Docker)

One container runs the whole app. From a fresh clone:

```sh
docker compose up --build -d
```

- **Port** — listens on `127.0.0.1:3737` on the host (override with `SPINDLE_PORT`). Bound to localhost by design; put your existing reverse proxy in front.
- **Behind Caddy / any TLS proxy** — point it at the port, nothing else:

  ```
  reverse_proxy 127.0.0.1:3737
  ```

  The app derives its origin from the forwarded `Host` header (scheme `https`), so links, redirects and the CSRF check work behind your proxy with no extra config — verified with a simulated `Host: spindle.example.com` request. Optional: set `ADDRESS_HEADER=x-forwarded-for` + `XFF_DEPTH=1` to log real client IPs.

- **Data** — `./data` → `/data`, so DB + media survive rebuilds. On Linux, chown the folder once before first run (`mkdir -p data && chown 1000:1000 data`) since the container runs as uid 1000.
- **Linux x64 target** — build for the target platform, not your laptop's arch:

  ```sh
  docker buildx build --platform linux/amd64 -t spindle .
  ```

  The image is `node:24-slim` and reinstalls runtime deps per platform, so `better-sqlite3` gets the correct prebuilt binary with no compile toolchain (the package ships prebuilds; the build uses `npm ci --ignore-scripts`).

- **Stop** — `docker compose down` (data stays in `./data`).

## Exporting your data

The whole database can be exported at any time — from the home page ("Export" under the record count) or straight from a terminal:

```sh
curl -OJ "http://localhost:3737/api/export?format=csv"        # records → CSV
curl -OJ "http://localhost:3737/api/export?format=csv&table=photos"
curl -OJ "http://localhost:3737/api/export?format=json"       # full fidelity (records + photos)
```

- **CSV** is strictly RFC 4180 (header + rows, CRLF, UTF-8 BOM for Excel), prices in dollars — it opens cleanly in Excel/LibreOffice/pandas.
- **JSON** carries every raw column plus `exported_at`/counts, for backups and tooling.

## Backup & restore

CSV/JSON exports are a snapshot of the _data_; a backup is the whole _thing_ — the SQLite database plus every cover and photo file, in one zip you can drop anywhere.

- **Download** — from the "Backup" section at the bottom of the home page (or `curl -X POST`), producing e.g. `spindle-backup-2026-08-30T23-00-00.zip`. The WAL is checkpointed first, so the db file inside is a consistent, self-contained snapshot.
- **Restore** — upload that zip from the same section (the browser confirms before it's sent). The server parses and path-checks the archive, opens the candidate database out-of-band and runs `PRAGMA integrity_check` — and only once that passes does it shut the live connection down, preserve the current DB + media in `data/.pre-restore/`, and swap the new generation in. A bad or partial archive aborts with the existing collection byte-for-byte untouched.
- **Safety net** — `.pre-restore/` keeps exactly one previous generation (the files from before the last restore), so a mistaken restore can be put back by restoring _that_ set of files.

```sh
curl -X POST -OJ "http://localhost:3737/api/backup"                  # download the zip
# Production builds assume https for origin checks (behind-TLS deployment), so a
# terminal form-POST needs a matching Origin header, like photo uploads:
curl -X POST -H "Origin: https://localhost:3737" \
     -F "file=@spindle-backup-….zip" "http://localhost:3737/api/restore"
# (Under `npm run dev` the origin check is disabled — plain curl works.)
```

`BODY_SIZE_LIMIT` is 512M by default so media-heavy backup zips can be restored in-app (individual photo uploads are still capped at 8MB per file server-side). The UI needs no special handling — the browser sends a same-origin `Origin` automatically.

## Environment

| Variable                  | Default                                                    | Purpose                                                                                |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `DISCOGS_CONSUMER_KEY`    | _(empty → unauthenticated tier, manual entry still works)_ | Discogs API consumer key                                                               |
| `DISCOGS_CONSUMER_SECRET` | _(empty)_                                                  | Discogs API secret                                                                     |
| `DATA_DIR`                | `./data`                                                   | Where the SQLite DB and media files live                                               |
| `BODY_SIZE_LIMIT`         | `512M` (compose)                                           | Max request body for adapter-node (restore uploads; photos are capped per-file at 8MB) |
| `SPINDLE_PORT`            | `3737` (compose)                                           | Host port for the Docker deployment                                                    |

Create a (free) key/secret pair at https://www.discogs.com/settings/developers — one per project, no OAuth dance needed for local use.

## Project layout

```
src/
  lib/
    types.ts                 # shared row/draft types + enums (conditions, statuses)
    draft.ts                 # client↔server form-state helpers
    server/
      db.ts                  # better-sqlite3 singleton (auto-creates schema on first open)
      paths.ts               # data-dir resolution (DATA_DIR)
      export.ts              # collection export: CSV + JSON renderers
      discogs.ts             # Discogs API client (search by barcode, release detail)
      records.ts             # all record SQL: list/search/sort/filter, CRUD, photos
      importer.ts            # importRecord(): local cover download + insert
      backup.ts              # backup zip (archiver) + validated restore (.pre-restore snapshot)
  routes/
    +page.*                  # collection home: cards/table/list, search & filters
    scan/+page.svelte        # barcode scanner (camera) + manual entry fallback
    import/barcode/[barcode]/  # Discogs lookup + candidate picker + save
    import/manual/+page.*    # no-barcode entry
    records/[id]/+page.*     # detail: edit form, photos, add copy, delete
    api/import/+server.ts    # JSON lookup endpoint (candidate expansion)
    api/export/+server.ts    # GET collection export (csv|json, table=records|photos)
    api/backup/+server.ts    # POST whole-collection zip download (db checkpointed + media/)
    api/restore/+server.ts   # POST backup zip restore (validated, .pre-restore snapshot)
    api/records/[id]/photos/+server.ts  # photo upload/delete (multipart)
    media/[...file]/+server.ts           # local media serving (traversal-guarded)
plans/spindle-plan.md        # the full architecture plan
```

## Design notes

- **Price** is stored as integer cents to avoid float drift.
- **Covers** reference a local filename once downloaded; `cover_remote_url` is kept as a fallback only.
- **Deleting** a record removes its media files from disk (cover + photos) and cascades the photo rows.
- **Dedupe**: saving an existing barcode/Discogs ID offers "add another copy" instead of duplicating, with a create-anyway escape hatch for distinct pressings.
- The DB file and media directory are gitignored (`/data`) — this app is designed to be _your_ data, in _your_ folder.
