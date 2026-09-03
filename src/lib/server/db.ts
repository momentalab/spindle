/**
 * SQLite database layer (server-only) — better-sqlite3, WAL mode.
 * Versioned schema migrations; raw prepared statements (no ORM).
 */
import Database from 'better-sqlite3';
import { DB_PATH, ensureDataDirs } from '$lib/server/paths';
import { parseLabelList, parseStyleList } from '$lib/types';

let _db: Database.Database | null = null;

/** Lazily open the database (and run migrations) on first use. */
export function getDb(): Database.Database {
	if (_db) return _db;
	ensureDataDirs();
	const db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db);
	_db = db;
	return db;
}

/**
 * Checkpoint the WAL (flushing it into mynyl.db) and close the connection,
 * releasing every file handle on the DB. Call this only right before
 * replacing the DB files on disk (restore, F8) — until the next getDb()
 * call the app has no live connection, which is acceptable for a
 * single-user local tool.
 */
export function checkpointAndClose(): void {
	if (!_db) return;
	const db = _db;
	_db = null; // no new statement can land on a closing connection
	try {
		db.pragma('wal_checkpoint(TRUNCATE)');
	} catch {
		// A failed checkpoint must not leak the handle: close either way.
	}
	db.close();
}

interface Migration {
	version: number;
	description: string;
	up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
	{
		version: 1,
		description: 'initial schema: records + photos',
		up(db) {
			db.exec(`
				CREATE TABLE IF NOT EXISTS records (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					discogs_id INTEGER UNIQUE,
					barcode TEXT,
					artist TEXT NOT NULL,
					title TEXT NOT NULL,
					style TEXT,
					genre TEXT,
					year TEXT,
					label TEXT,
					format TEXT,
					limited_edition INTEGER NOT NULL DEFAULT 0 CHECK (limited_edition IN (0,1)),
					condition_media TEXT,
					condition_sleeve TEXT,
					price_paid INTEGER,
					acquired_at TEXT,
					source TEXT,
					status TEXT NOT NULL DEFAULT 'in_collection'
						CHECK (status IN ('in_collection','sold','traded_away')),
					copies INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1),
					notes TEXT,
					cover_filename TEXT,
					cover_remote_url TEXT,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at TEXT NOT NULL DEFAULT (datetime('now'))
				);

				CREATE INDEX IF NOT EXISTS idx_records_artist ON records(artist);
				CREATE INDEX IF NOT EXISTS idx_records_title ON records(title);
				CREATE INDEX IF NOT EXISTS idx_records_barcode ON records(barcode);
				CREATE INDEX IF NOT EXISTS idx_records_discogs_id ON records(discogs_id);
				CREATE INDEX IF NOT EXISTS idx_records_genre ON records(genre);
				CREATE INDEX IF NOT EXISTS idx_records_label ON records(label);

				CREATE TABLE IF NOT EXISTS photos (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
					filename TEXT NOT NULL,
					caption TEXT,
					created_at TEXT NOT NULL DEFAULT (datetime('now'))
				);

				CREATE INDEX IF NOT EXISTS idx_photos_record_id ON photos(record_id);
			`);
		}
	},
	{
		version: 2,
		description: 'plays log: one row per spin (record_id FK + played_at)',
		up(db) {
			db.exec(`
				CREATE TABLE IF NOT EXISTS plays (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
					played_at TEXT NOT NULL DEFAULT (datetime('now'))
				);

				CREATE INDEX IF NOT EXISTS idx_plays_record_id ON plays(record_id);
			`);
		}
	},
	{
		version: 3,
		description:
			'genres as a set: record_genres junction (backfilled from the legacy comma-joined column, which is then dropped)',
		up(db) {
			// SQLite ≥ 3.25 (bundled node-sqlite / better-sqlite3 are well past this).
			db.exec(`
				CREATE TABLE IF NOT EXISTS record_genres (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
					genre TEXT NOT NULL CHECK (TRIM(genre) != ''),
					UNIQUE (record_id, genre)
				);

				CREATE INDEX IF NOT EXISTS idx_record_genres_genre ON record_genres(genre);
			`);

			// Backfill: split legacy "Electronic, Pop" values into one row per genre.
			// Case-insensitive dedupe so "Pop" and "pop" collapse to one entry.
			const rows = db.prepare(`SELECT id, genre FROM records`).all() as {
				id: number;
				genre: string | null;
			}[];
			const insert = db.prepare(
				'INSERT OR IGNORE INTO record_genres (record_id, genre) VALUES (?, ?)'
			);
			const backfill = db.transaction(() => {
				for (const row of rows) {
					if (!row.genre) continue;
					const seen = new Set<string>();
					for (const part of row.genre.split(',')) {
						const g = part.trim();
						if (!g) continue;
						const key = g.toLowerCase();
						if (seen.has(key)) continue;
						seen.add(key);
						insert.run(row.id, g);
					}
				}
			});
			backfill();

			// Drop the legacy index first — DROP COLUMN revalidates surviving indexes
			// against the remaining schema and refuses to drop a column an index still
			// references. Safe even for a DB restored from an old backup that never ran v3.
			db.exec(`DROP INDEX IF EXISTS idx_records_genre`);
			db.exec(`ALTER TABLE records DROP COLUMN genre`);
		}
	},
	{
		version: 4,
		description:
			'styles + labels as sets: record_styles and record_labels junctions (backfilled from the legacy comma-joined columns, which are then dropped)',
		up(db) {
			db.exec(`
				CREATE TABLE IF NOT EXISTS record_styles (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
					style TEXT NOT NULL CHECK (TRIM(style) != ''),
					UNIQUE (record_id, style)
				);

				CREATE INDEX IF NOT EXISTS idx_record_styles_style ON record_styles(style);

				CREATE TABLE IF NOT EXISTS record_labels (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
					label TEXT NOT NULL CHECK (TRIM(label) != ''),
					catno TEXT,
					UNIQUE (record_id, label)
				);

				CREATE INDEX IF NOT EXISTS idx_record_labels_label ON record_labels(label);
			`);

			// Backfill with the same parsers the save path uses, so legacy rows are
			// cleaned identically to a fresh save: styles split + case-insensitive
			// dedupe; labels split, paren chunks stripped (first = catno), deduped.
			const rows = db.prepare(`SELECT id, style, label FROM records`).all() as {
				id: number;
				style: string | null;
				label: string | null;
			}[];
			const insStyle = db.prepare(
				'INSERT OR IGNORE INTO record_styles (record_id, style) VALUES (?, ?)'
			);
			const insLabel = db.prepare(
				'INSERT OR IGNORE INTO record_labels (record_id, label, catno) VALUES (?, ?, ?)'
			);
			const backfill = db.transaction(() => {
				for (const row of rows) {
					for (const s of parseStyleList(row.style)) insStyle.run(row.id, s);
					for (const l of parseLabelList(row.label)) insLabel.run(row.id, l.name, l.catno);
				}
			});
			backfill();

			// Drop the legacy index first (same reason as v3), then both columns.
			db.exec(`DROP INDEX IF EXISTS idx_records_label`);
			db.exec(`ALTER TABLE records DROP COLUMN style`);
			db.exec(`ALTER TABLE records DROP COLUMN label`);
		}
	}
];

function migrate(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			description TEXT NOT NULL,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);
	const applied = db.prepare('SELECT version FROM schema_migrations').all() as {
		version: number;
	}[];
	const done = new Set(applied.map((r) => r.version));

	const insert = db.prepare(
		'INSERT INTO schema_migrations (version, description) VALUES (?, ?)'
	);
	for (const m of migrations) {
		if (done.has(m.version)) continue;
		const run = db.transaction(() => {
			m.up(db);
			insert.run(m.version, m.description);
		});
		run();
	}
}
