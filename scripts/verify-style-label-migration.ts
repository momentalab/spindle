/**
 * Verify migration v4 backfill + style/label data access. Builds a post-v3
 * DB (genre already in its junction; legacy records.style / records.label
 * comma-joined columns still present) with dirty values in a scratch dir,
 * then opens it via getDb() and asserts: both junctions backfilled correctly
 * (case-insensitive dedupe, paren → catno extraction), legacy columns +
 * index gone, filter/search/sort/hydrate all work through the app's own
 * data-access layer.
 * Run (DATA_DIR MUST point at the scratch dir so getDb opens that DB):
 *   ./node_modules/.bin/esbuild scripts/verify-style-label-migration.ts --bundle \
 *     --platform=node --format=cjs "--alias:$lib=./src/lib" \
 *     --external:better-sqlite3 --outfile=.style-label-mig.cjs \
 *   && DATA_DIR=/tmp/mynyl-style-label-mig/data node .style-label-mig.cjs; rm -f .style-label-mig.cjs
 */
import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../src/lib/server/db';
import { createRecord, distinctValues, findRecordById, listRecords, updateRecord } from '../src/lib/server/records';
import { parseLabelList, parseStyleList, joinLabels, joinStyles } from '../src/lib/types';

const DATA = '/tmp/mynyl-style-label-mig/data';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
	if (!cond) failures++;
}

// --- 0. Parser units — the same code the backfill and save path share. ---
check(
	'parseStyleList: split + case-insensitive dedupe',
	JSON.stringify(parseStyleList('Jazz, Free Jazz, jazz')) === JSON.stringify(['Jazz', 'Free Jazz']),
	parseStyleList('Jazz, Free Jazz, jazz').join(' | ')
);
check('parseStyleList: blanks dropped', JSON.stringify(parseStyleList(' ,  Soul ,')) === JSON.stringify(['Soul']));
check('parseStyleList: null → []', parseStyleList(null).length === 0);

check(
	'parseLabelList: paren chunk becomes catno, extra chunks dropped',
	JSON.stringify(parseLabelList('Warner Records (BS 2744) (NOISE-1)')) ===
		JSON.stringify([{ name: 'Warner Records', catno: 'BS 2744' }]),
	parseLabelList('Warner Records (BS 2744) (NOISE-1)')
		.map((l) => l.name)
		.join(' | ')
);
check(
	'parseLabelList: multi-label with catnos + case-insensitive name dedupe',
	JSON.stringify(parseLabelList('Warner Records (BS 2744), Warner records, Atlantic (SD 201)')) ===
		JSON.stringify([
			{ name: 'Warner Records', catno: 'BS 2744' },
			{ name: 'Atlantic', catno: 'SD 201' }
		]),
	parseLabelList('Warner Records (BS 2744), Warner records, Atlantic (SD 201)')
		.map((l) => l.name)
		.join(' | ')
);
check(
	'parseLabelList: label without catno stays null',
	JSON.stringify(parseLabelList('Rough Trade')) === JSON.stringify([{ name: 'Rough Trade', catno: null }])
);
check('parseLabelList: whitespace-only parts dropped', parseLabelList('   ,  ').length === 0);
check(
	'parseLabelList: empty paren chunk → no catno',
	JSON.stringify(parseLabelList('Warner Records ()')) === JSON.stringify([{ name: 'Warner Records', catno: null }])
);
const roundTrip = joinLabels([
	{ name: 'Warner Records', catno: 'BS 2744' },
	{ name: 'Atlantic', catno: null }
]);
check(
	'joinLabels/parseLabelList round-trip is lossless',
	JSON.stringify(parseLabelList(roundTrip)) ===
		JSON.stringify([
			{ name: 'Warner Records', catno: 'BS 2744' },
			{ name: 'Atlantic', catno: null }
		]),
	roundTrip
);

// --- 1. Build a post-v3 database: record_genres already exists, but the
//       legacy records.style / records.label columns are still present. ---
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
	CREATE INDEX IF NOT EXISTS idx_records_label ON records(label);
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
	CREATE TABLE record_genres (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
		genre TEXT NOT NULL CHECK (TRIM(genre) != ''),
		UNIQUE (record_id, genre)
	);
	CREATE INDEX IF NOT EXISTS idx_record_genres_genre ON record_genres(genre);
`);
const ins = legacy.prepare('INSERT INTO records (artist, title, style, label) VALUES (?, ?, ?, ?)');
ins.run(
	'A',
	'Dirty LP',
	'Jazz, Free Jazz, jazz',
	'Warner Records (BS 2744) (NOISE-1), Warner records, Atlantic (SD 201)'
);
ins.run('B', 'Simple LP', 'Soul', null);
ins.run('C', 'Empty LP', null, '   ,  ');
ins.run('D', 'Dup LP', 'Fusion, Fusion', '');
legacy.prepare('INSERT INTO record_genres (record_id, genre) VALUES (?, ?)').run(1, 'Jazz');
for (const v of [1, 2, 3]) {
	legacy.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)').run(v, 'legacy');
}
legacy.close();

// --- 2. Open via the app: getDb() runs migrate() → v4 backfill. ---
const db = getDb();
check('v4 applied', db.prepare('SELECT version FROM schema_migrations WHERE version = 4').get() !== undefined);

const styleRows = db.prepare('SELECT record_id, style FROM record_styles ORDER BY id').all() as {
	record_id: number;
	style: string;
}[];
console.log('style rows:', JSON.stringify(styleRows));
check(
	'styles backfilled (case-insensitive dedupe, blanks dropped)',
	JSON.stringify(styleRows.map((r) => [r.record_id, r.style])) ===
		JSON.stringify([
			[1, 'Jazz'],
			[1, 'Free Jazz'],
			[2, 'Soul'],
			[4, 'Fusion']
		])
);

const labelRows = db.prepare('SELECT record_id, label, catno FROM record_labels ORDER BY id').all() as {
	record_id: number;
	label: string;
	catno: string | null;
}[];
console.log('label rows:', JSON.stringify(labelRows));
check(
	'labels backfilled (catno extracted, duplicate label name collapsed)',
	JSON.stringify(labelRows.map((r) => [r.record_id, r.label, r.catno])) ===
		JSON.stringify([
			[1, 'Warner Records', 'BS 2744'],
			[1, 'Atlantic', 'SD 201']
		])
);

const cols = (db.prepare('PRAGMA table_info(records)').all() as { name: string }[]).map((c) => c.name);
check('legacy style column dropped', !cols.includes('style'), cols.join(','));
check('legacy label column dropped', !cols.includes('label'));
const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
	(i) => i.name
);
check('legacy label index dropped', !idx.includes('idx_records_label'));

// --- 3. Round-trip through the app's own data access. ---
const r1 = findRecordById(1)!;
check('hydrateStyles on read', JSON.stringify(r1.styles) === JSON.stringify(['Jazz', 'Free Jazz']));
check(
	'hydrateLabels on read (catno preserved)',
	JSON.stringify(r1.labels) ===
		JSON.stringify([
			{ name: 'Warner Records', catno: 'BS 2744' },
			{ name: 'Atlantic', catno: 'SD 201' }
		])
);

check(
	'distinctValues(label) individual clean names',
	JSON.stringify(distinctValues('label')) === JSON.stringify(['Atlantic', 'Warner Records']),
	distinctValues('label').join(' | ')
);

// Filter: ?label=Atlantic matches only record 1 (one of its two labels).
const atlanticOnly = listRecords({ sort: 'artist', dir: 'asc', label: 'Atlantic' });
check(
	'filter by individual label',
	atlanticOnly.length === 1 && atlanticOnly[0].id === 1,
	`matched ids: ${atlanticOnly.map((r) => r.id).join(',')}`
);

// Search across the junction.
const hit = listRecords({ sort: 'artist', dir: 'asc', search: 'warner' });
check(
	'text search finds individual labels',
	hit.length === 1 && hit[0].id === 1,
	`matched ids: ${hit.map((r) => r.id).join(',')}`
);

// Sort by label orders by the first (lowest-id) junction entry; records with no
// label at all carry a NULL and sort after the labelled ones (NULLs-last),
// tie-broken by artist: record 1 has labels; 2/3/4 have none → B, C, D.
const sorted = listRecords({ sort: 'label', dir: 'asc' });
check(
	'sort by label works through the junction (labelled first, then artist tie-break)',
	JSON.stringify(sorted.map((r) => r.id)) === JSON.stringify([1, 2, 3, 4]),
	sorted.map((r) => r.id).join(',')
);

// Create with styles + labels → junction rows; update → replaced atomically.
const created = createRecord({
	discogs_id: null,
	barcode: null,
	artist: 'Z',
	title: 'New',
	styles: ['Jazz', 'Fusion'],
	genres: ['Soul'],
	year: null,
	labels: [{ name: 'Blue Note', catno: 'BLP 1564' }],
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
check('createRecord writes style + label rows', JSON.stringify(created.styles) === JSON.stringify(['Jazz', 'Fusion']));
check(
	'createRecord writes label with catno',
	JSON.stringify(created.labels) === JSON.stringify([{ name: 'Blue Note', catno: 'BLP 1564' }]),
	JSON.stringify(created.labels)
);
const updated = updateRecord(created.id, {
	styles: ['Fusion'],
	labels: [{ name: 'Palo Alto', catno: null }]
})!;
check('updateRecord replaces style rows', JSON.stringify(updated.styles) === JSON.stringify(['Fusion']));
check(
	'updateRecord replaces label rows (catno cleared)',
	JSON.stringify(updated.labels) === JSON.stringify([{ name: 'Palo Alto', catno: null }]),
	JSON.stringify(updated.labels)
);

db.prepare('DELETE FROM records WHERE artist = ?').run('Z'); // cascades record_styles + record_labels
db.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
