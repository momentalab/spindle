# mynyl 🎵

A **local-first** vinyl record collection tracker. Scan a barcode, pull metadata from Discogs, and keep it — the data lives in a local SQLite database, not on Discogs.

## Features

- **Barcode scanning** — camera-based EAN-13/UPC-A scan (native `BarcodeDetector` where available, ZXing JS fallback) plus manual entry
- **Discogs import** — search by barcode, review candidates, and save the release; cover art is **downloaded locally** at import time so the collection browses offline
- **Local-first storage** — SQLite (`data/mynyl.db`) + media files (`data/media/`). Discogs is a one-time source of truth; every field is editable afterwards and never overwritten by Discogs
- **Extended schema** — beyond Discogs: condition (media/sleeve), price paid, acquired date, source, copies, limited-edition flag, status, and free-form notes
- **Three views** — cards, table (sortable columns), and list, with search + genre/label/status filters
- **Photos** — upload images of your actual records (client-side downscale to ~1600px JPEG before storage)

## Requirements

- Node.js 20+
- Camera access over **localhost or HTTPS** (browsers require a secure context for `getUserMedia`). For on-lan testing, Vite serves on your network IP / Tailscale address.

## Development

```sh
npm install
npm run dev
```

Open http://localhost:5173 — scan a barcode or add records manually at `/import/manual`.

## Production

```sh
npm run build     # type-check + build (adapter-node → build/)
PORT=3000 node build/index.js
```

The data directory defaults to `./data` and can be relocated with `MYNYL_DATA_DIR=/path/to/data`.

## Environment

| Variable                | Default                                                | Purpose                                  |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------- |
| `DISCOGS_CLIENT_ID`     | *(empty → lookups disabled, manual entry still works)* | Discogs API consumer key                 |
| `DISCOGS_CLIENT_SECRET` | *(empty)*                                              | Discogs API secret                       |
| `MYNYL_DATA_DIR`        | `./data`                                               | Where the SQLite DB and media files live |

Create a (free) token pair at https://www.discogs.com/settings/developers — one per project, no OAuth dance needed for local use.

## Project layout

```
src/
  lib/
    types.ts                 # shared row/draft types + enums (conditions, statuses)
    draft.ts                 # client↔server form-state helpers
    server/
      db.ts                  # better-sqlite3 singleton (auto-creates schema on first open)
      paths.ts               # data-dir resolution (MYNYL_DATA_DIR)
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
