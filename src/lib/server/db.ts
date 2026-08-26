/**
 * SQLite database layer (server-only) — better-sqlite3, WAL mode.
 * Versioned schema migrations; raw prepared statements (no ORM).
 */
import Database from 'better-sqlite3';
import { DB_PATH, ensureDataDirs } from '$lib/server/paths';

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
