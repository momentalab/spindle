# mynyl 🎵

A **local-first** vinyl record collection tracker. Scan a barcode, pull metadata from Discogs, and keep it — the data lives in a local SQLite database, not on Discogs.

## Features

- **Barcode scanning** — camera-based EAN-13/UPC-A scan (native `BarcodeDetector` where available, ZXing JS fallback) plus manual entry
- **Discogs import** — search by barcode, review candidates, and save the release; cover art is **downloaded locally** at import time so the collection browses offline
- **Local-first storage** — SQLite (`data/mynyl.db`) + media files (`data/media/`). Discogs is a one-time source of truth; every field is editable afterwards and never overwritten by Discogs
- **Extended schema** — beyond Discogs: condition (media/sleeve), price paid, acquired date, source, copies, limited-edition flag, status, and free-form notes
- **Three views** — cards, table (sortable columns), and list, with search + genre/label/status filters
- **Photos** — upload images of your actual records (client-side downscale to ~1600px JPEG before storage)
- **Export** — take the whole collection out as CSV or JSON, from the home page or `GET /api/export`

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

- **Port** — listens on `127.0.0.1:3737` on the host (override with `MYNYL_PORT`). Bound to localhost by design; put your existing reverse proxy in front.
- **Behind Caddy / any TLS proxy** — point it at the port, nothing else:

  ```
  reverse_proxy 127.0.0.1:3737
  ```

  The app derives its origin from the forwarded `Host` header (scheme `https`), so links, redirects and the CSRF check work behind your proxy with no extra config — verified with a simulated `Host: mynyl.example.com` request. Optional: set `ADDRESS_HEADER=x-forwarded-for` + `XFF_DEPTH=1` to log real client IPs.
- **Data** — `./data` → `/data`, so DB + media survive rebuilds. On Linux, chown the folder once before first run (`mkdir -p data && chown 1000:1000 data`) since the container runs as uid 1000.
- **Linux x64 target** — build for the target platform, not your laptop's arch:

  ```sh
  docker buildx build --platform linux/amd64 -t mynyl .
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

## Environment

| Variable                  | Default                                                    | Purpose                                           |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| `DISCOGS_CONSUMER_KEY`    | *(empty → unauthenticated tier, manual entry still works)* | Discogs API consumer key                          |
| `DISCOGS_CONSUMER_SECRET` | *(empty)*                                                  | Discogs API secret                                |
| `DATA_DIR`                | `./data`                                                   | Where the SQLite DB and media files live          |
| `BODY_SIZE_LIMIT`         | `10M` (compose)                                            | Max request body for adapter-node (photo uploads) |
| `MYNYL_PORT`              | `3737` (compose)                                           | Host port for the Docker deployment               |

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
  routes/
    +page.*                  # collection home: cards/table/list, search & filters
    scan/+page.svelte        # barcode scanner (camera) + manual entry fallback
    import/barcode/[barcode]/  # Discogs lookup + candidate picker + save
    import/manual/+page.*    # no-barcode entry
    records/[id]/+page.*     # detail: edit form, photos, add copy, delete
    api/import/+server.ts    # JSON lookup endpoint (candidate expansion)
    api/export/+server.ts    # GET collection export (csv|json, table=records|photos)
    api/records/[id]/photos/+server.ts  # photo upload/delete (multipart)
    media/[...file]/+server.ts           # local media serving (traversal-guarded)
plans/mynyl-plan.md          # the full architecture plan
```

## Design notes

- **Price** is stored as integer cents to avoid float drift.
- **Covers** reference a local filename once downloaded; `cover_remote_url` is kept as a fallback only.
- **Deleting** a record removes its media files from disk (cover + photos) and cascades the photo rows.
- **Dedupe**: saving an existing barcode/Discogs ID offers "add another copy" instead of duplicating, with a create-anyway escape hatch for distinct pressings.
- The DB file and media directory are gitignored (`/data`) — this app is designed to be *your* data, in *your* folder.
