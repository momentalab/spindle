/**
 * Verify migration v3 backfill + the new genre data access. Builds a legacy
 * (v1+v2) DB with the old comma-joined records.genre column in a scratch dir,
 * then opens it via getDb() and asserts: junction rows split correctly (case-
 * insensitive dedupe), legacy column + index gone, filter/search/hydrate all
 * work through the app's own data-access layer.
 * Run (DATA_DIR MUST point at the scratch dir so getDb opens that DB):
 *   ./node_modules/.bin/esbuild scripts/verify-genre-migration.ts --bundle \
 *     --platform=node --format=cjs "--alias:$lib=./src/lib" \
 *     --external:better-sqlite3 --outfile=.genre-mig.cjs \
 *   && DATA_DIR=/tmp/mynyl-genre-mig/data node .genre-mig.cjs; rm -f .genre-mig.cjs
 */
import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../src/lib/server/db';
import { findRecordById, listRecords, distinctValues, createRecord, updateRecord } from '../src/lib/server/records';
import { parseGenreList, joinGenres } from '../src/lib/types';

const DATA = '/tmp/mynyl-genre-mig/data';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
	if (!cond) failures++;
}

// --- 0. Genre parsing — the comma-bearing Discogs genre stays atomic. ---
check(
	'parseGenreList: comma genre survives the split',
	JSON.stringify(parseGenreList('Folk, World, & Country')) === JSON.stringify(['Folk, World, & Country']),
	parseGenreList('Folk, World, & Country').join(' | ')
);
check(
	'parseGenreList: comma genre alongside others',
	JSON.stringify(parseGenreList('Electronic, Folk, World, & Country, Pop')) ===
		JSON.stringify(['Electronic', 'Folk, World, & Country', 'Pop']),
	parseGenreList('Electronic, Folk, World, & Country, Pop').join(' | ')
);
check(
	'parseGenreList: shredded legacy row heals on re-parse',
	JSON.stringify(parseGenreList('Folk, World, & Country')) === JSON.stringify(['Folk, World, & Country']) &&
		JSON.stringify(parseGenreList('Rock, Folk, World, & Country')) ===
			JSON.stringify(['Rock', 'Folk, World, & Country']),
	parseGenreList('Rock, Folk, World, & Country').join(' | ')
);
check(
	'parseGenreList: fragment-only input keeps the canonical name',
	JSON.stringify(parseGenreList('& Country')) === JSON.stringify(['Folk, World, & Country']) &&
		JSON.stringify(parseGenreList('World, & Country')) === JSON.stringify(['Folk, World, & Country']),
	parseGenreList('& Country').join(' | ')
);
check(
	'parseGenreList: case-insensitive fragment merge',
	JSON.stringify(parseGenreList('folk, world, & country')) === JSON.stringify(['Folk, World, & Country'])
);
check(
	'parseGenreList: plain multi-genre still splits + dedupes',
	JSON.stringify(parseGenreList('Electronic, Pop, electronic')) === JSON.stringify(['Electronic', 'Pop']),
	parseGenreList('Electronic, Pop, electronic').join(' | ')
);
const joined = joinGenres(['Folk, World, & Country', 'Rock']);
check(
	'joinGenres/parseGenreList round-trip is lossless',
	JSON.stringify(parseGenreList(joined)) === JSON.stringify(['Folk, World, & Country', 'Rock']),
	joined
);

// --- 1. Build a legacy (v1+v2) database with the old comma-joined column. ---
rmSync(path.dirname(DATA), { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });

const legacy = new Database(path.join(DATA, 'mynyl.db'));
legacy.exec(`
	CREATE TABLE schema_migrations (
		version INTEGER PRIMARY KEY,
		description TEXT NOT NULL,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE records (
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
		status TEXT NOT NULL DEFAULT 'in_collection' CHECK (status IN ('in_collection','sold','traded_away')),
		copies INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1),
		notes TEXT,
		cover_filename TEXT,
		cover_remote_url TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS idx_records_genre ON records(genre);
	CREATE TABLE photos (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
		filename TEXT NOT NULL,
		caption TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE plays (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
		played_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
`);
const ins = legacy.prepare('INSERT INTO records (artist, title, genre) VALUES (?, ?, ?)');
ins.run('A', 'Multi-genre LP', 'Electronic, Pop, electronic'); // case-insensitive dup
ins.run('B', 'Single genre', 'Rock');
ins.run('C', 'No genre', null);
ins.run('D', 'Whitespace only', '   ,  ');
legacy.prepare("INSERT INTO schema_migrations (version, description) VALUES (1, 'legacy')").run();
legacy.prepare("INSERT INTO schema_migrations (version, description) VALUES (2, 'legacy')").run();
legacy.close();

// --- 2. Open via the app: getDb() runs migrate() → v3 backfill. ---
const db = getDb();
check('v3 applied', db.prepare('SELECT version FROM schema_migrations WHERE version = 3').get() !== undefined);

const rows = db.prepare('SELECT record_id, genre FROM record_genres ORDER BY id').all() as {
	record_id: number;
	genre: string;
}[];
console.log('junction rows:', JSON.stringify(rows));
check(
	'backfilled 3 genres (case-insensitive dup + whitespace dropped)',
	rows.length === 3 &&
		JSON.stringify(rows.map((r) => [r.record_id, r.genre])) ===
			JSON.stringify([
				[1, 'Electronic'],
				[1, 'Pop'],
				[2, 'Rock']
			])
);

const cols = (db.prepare('PRAGMA table_info(records)').all() as { name: string }[]).map((c) => c.name);
check('legacy genre column dropped', !cols.includes('genre'), cols.join(','));
const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[])
	.map((i) => i.name);
check('legacy genre index dropped', !idx.includes('idx_records_genre'));

// --- 3. Round-trip through the app's own data access. ---
const r1 = findRecordById(1)!;
check('hydrateGenres on read', JSON.stringify(r1.genres) === JSON.stringify(['Electronic', 'Pop']));
check(
	'distinctValues(genre) individual',
	JSON.stringify(distinctValues('genre')) === JSON.stringify(['Electronic', 'Pop', 'Rock']),
	distinctValues('genre').join(' | ')
);

// Filter: ?genre=Rock matches only record 2; ?genre=Pop finds the multi-genre record.
const rockOnly = listRecords({ sort: 'artist', dir: 'asc', genre: 'Rock' });
check('filter by individual genre', rockOnly.length === 1 && rockOnly[0].id === 2);
const popInMulti = listRecords({ sort: 'artist', dir: 'asc', genre: 'Pop' });
check('genre filter matches a record carrying multiple genres', popInMulti.length === 1 && popInMulti[0].id === 1);

// Search across the junction.
const hit = listRecords({ sort: 'artist', dir: 'asc', search: 'electronic' });
check('text search finds individual genres', hit.length === 1 && hit[0].id === 1);

// Sort by genre uses the first (lowest-id) junction entry.
const sorted = listRecords({ sort: 'genre', dir: 'asc' });
check('sort by genre', JSON.stringify(sorted.map((r) => r.id)) === JSON.stringify([1, 2, 3, 4]),
	sorted.map((r) => r.id).join(','));

// Create with genres → junction rows; update → replaced atomically.
const created = createRecord({
	discogs_id: null,
	barcode: null,
	artist: 'Z',
	title: 'New',
	style: null,
	genres: ['Jazz', 'Fusion'],
	year: null,
	label: null,
	format: null,
	limited_edition: false,
	condition_media: null,
	condition_sleeve: null,
	price_paid: null,
	acquired_at: null,
	source: null,
	status: 'in_collection',
	copies: 1,
	notes: null,
	cover_filename: null,
	cover_remote_url: null
});
check('createRecord writes junction rows', JSON.stringify(created.genres) === JSON.stringify(['Jazz', 'Fusion']));
const updated = updateRecord(created.id, { genres: ['Soul'] })!;
check('updateRecord replaces junction rows', JSON.stringify(updated.genres) === JSON.stringify(['Soul']));

// A comma-bearing Discogs genre survives as one junction row end-to-end.
const folk = createRecord({
	discogs_id: null,
	barcode: null,
	artist: 'F',
	title: 'Country LP',
	style: null,
	genres: ['Folk, World, & Country'],
	year: null,
	label: null,
	format: null,
	limited_edition: false,
	condition_media: null,
	condition_sleeve: null,
	price_paid: null,
	acquired_at: null,
	source: 'discogs',
	status: 'in_collection',
	copies: 1,
	notes: null,
	cover_filename: null,
	cover_remote_url: null
});
check(
	'comma genre stored as a single junction row',
	JSON.stringify(folk.genres) === JSON.stringify(['Folk, World, & Country']),
	folk.genres.join(' | ')
);
const folkFilter = listRecords({ sort: 'artist', dir: 'asc', genre: 'Folk, World, & Country' });
check(
	'genre filter matches the comma genre verbatim',
	folkFilter.length === 1 && folkFilter[0].id === folk.id
);
check(
	'distinctValues includes the comma genre intact',
	distinctValues('genre').includes('Folk, World, & Country')
);

db.prepare('DELETE FROM records WHERE artist IN (?, ?)').run('Z', 'F'); // cascades record_genres
db.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
