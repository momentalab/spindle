/**
 * Verify the wishlist table rebuild (records gains status 'wanted' + wanted_at,
 * copy_number, copy_total, sale_price, sold_at). Copies the real database into
 * a scratch dir and opens it via getDb() so the migration runs on the copy —
 * never the original — asserting: row counts identical for every table,
 * foreign_key_check clean, field values spot-check unchanged, the widened CHECK
 * accepts 'wanted', the four indexes survive, and the AUTOINCREMENT counter is
 * intact (next insert id = max+1). Also exercises the status invariants through
 * the app's own data access on the scratch DB.
 *
 * Self-staging: once the live database is already at v5 there is no pre-v5
 * state left to migrate, so the script rebuilds a faithful v4 replica first —
 * the same rows with only the v5 columns dropped (and any 'wanted' status
 * normalized back, which v4's CHECK would reject) — then runs the real
 * migration on it. Either way the table rebuild actually executes.
 *
 * Run:
 *   npx tsx scripts/verify-wishlist-migration.ts
 */
const DATA = '/tmp/spindle-wishlist-mig/data';

// getDb must open the scratch DB, not the live one. paths.ts reads DATA_DIR at
// IMPORT time, so pin the env var before any app module is loaded — static
// ESM imports would win that race (and the whole script would run against
// production data). Everything below is therefore dynamically imported.
process.env.DATA_DIR = DATA;
export {}; // this file is a script, not a library — but TLA needs module scope

const { copyFileSync, existsSync, mkdirSync, rmSync } = await import('node:fs');
const pathMod = await import('node:path');
const Database = (await import('better-sqlite3')).default;
const { getDb } = await import('../src/lib/server/db');
const { acquireRecord, createRecord, deleteRecord, updateRecord } = await import('../src/lib/server/records');

const DB_FILE = pathMod.join(DATA, 'spindle.db');
const SOURCE_DB = pathMod.join(process.cwd(), 'data', 'spindle.db');

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
	if (!cond) failures++;
}

// --- 1. Copy the real database into the scratch dir. ------------------------
if (!existsSync(SOURCE_DB)) {
	console.log(`SKIP — no database at ${SOURCE_DB}; nothing to verify against.`);
	process.exit(0);
}
rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
// Copy main + WAL, but NOT the -shm index file: it is a mapped in-memory
// artifact of the *live* connection and must be rebuilt fresh on open.
for (const suffix of ['', '-wal']) {
	const src = SOURCE_DB + suffix;
	if (existsSync(src)) copyFileSync(src, DB_FILE + suffix);
}

// --- 2. Pre-migration snapshot, straight off the files (no app code). -------
const raw = new Database(DB_FILE);
raw.pragma('journal_mode = WAL');
raw.pragma('foreign_keys = ON');
const appliedVersions = (
	raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]
).map((r) => r.version);

// If the live DB already ran v5, stage a faithful v4 replica so the rebuild
// still executes. v4's records table is the v5 one minus its five columns,
// minus the legacy genre/style/label that v3–v4 already dropped (they were).
if (appliedVersions.includes(5)) {
	raw.pragma('foreign_keys = OFF'); // rebuilding `records` under FK-bearing children
	raw.exec(`
		CREATE TABLE records_v4 (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			discogs_id INTEGER UNIQUE,
			barcode TEXT,
			artist TEXT NOT NULL,
			title TEXT NOT NULL,
			year TEXT,
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

		INSERT INTO records_v4 (
			id, discogs_id, barcode, artist, title, year, format, limited_edition,
			condition_media, condition_sleeve, price_paid, acquired_at, source,
			status, copies, notes, cover_filename, cover_remote_url, created_at, updated_at
		)
		SELECT
			id, discogs_id, barcode, artist, title, year, format, limited_edition,
			condition_media, condition_sleeve, price_paid, acquired_at, source,
			CASE WHEN status = 'wanted' THEN 'in_collection' ELSE status END,
			copies, notes, cover_filename, cover_remote_url, created_at, updated_at
		FROM records;

		DROP TABLE records;
		ALTER TABLE records_v4 RENAME TO records;

		CREATE INDEX idx_records_artist ON records(artist);
		CREATE INDEX idx_records_title ON records(title);
		CREATE INDEX idx_records_barcode ON records(barcode);
		CREATE INDEX idx_records_discogs_id ON records(discogs_id);

		-- The DROP dropped the AUTOINCREMENT counter; restore it, exactly as
		-- v5's rebuild must do to its own RENAME.
		UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM records) WHERE name = 'records';

		DELETE FROM schema_migrations WHERE version = 5;
	`);
	raw.pragma('foreign_keys = ON');
	console.log('staged: live DB was already v5 — rebuilt a v4 replica to migrate on the scratch copy.');
} else {
	console.log('source DB pre-dates v5 — migrating the scratch copy as-is.');
}

const TABLES = ['records', 'photos', 'plays', 'record_genres', 'record_styles', 'record_labels'];
const beforeCounts: Record<string, number> = {};
for (const t of TABLES) beforeCounts[t] = (raw.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
const beforeFkViolations = raw.prepare('PRAGMA foreign_key_check').all().length;
const beforeSeq = (
	raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'records'").get() as { seq: number } | undefined
)?.seq;
const beforeMaxId = (raw.prepare('SELECT MAX(id) AS m FROM records').get() as { m: number | null }).m ?? 0;
const beforeCols = (raw.prepare('PRAGMA table_info(records)').all() as { name: string }[]).map((c) => c.name);
const spotIds = (raw.prepare('SELECT id FROM records ORDER BY id LIMIT 3').all() as { id: number }[]).map((r) => r.id);
const beforeRows = new Map<number, Record<string, unknown>>();
for (const id of spotIds) {
	beforeRows.set(id, raw.prepare('SELECT * FROM records WHERE id = ?').get(id) as Record<string, unknown>);
}
const beforeIndexes = (
	raw
		.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_records_%' ORDER BY name")
		.all() as { name: string }[]
).map((i) => i.name);
const beforeWants = (raw.prepare("SELECT COUNT(*) AS c FROM records WHERE status = 'wanted'").get() as { c: number }).c;
raw.close();

console.log(
	`pre-state: migrations v${appliedVersions.filter((v) => v !== 5).join(',')} · ` +
		TABLES.map((t) => `${t}=${beforeCounts[t]}`).join(' ')
);

// --- 3. Open via the app: getDb() runs the migration on the scratch copy. ---
const db = getDb();
check(
	'v5 applied on the scratch copy',
	(db.prepare('SELECT version FROM schema_migrations WHERE version = 5').get() as unknown) !== undefined
);

// --- 4. Structure: widened CHECK + new columns + surviving indexes. ---------
const cols = (db.prepare('PRAGMA table_info(records)').all() as { name: string }[]).map((c) => c.name);
for (const c of ['wanted_at', 'copy_number', 'copy_total', 'sale_price', 'sold_at']) {
	check(`column ${c} present`, cols.includes(c));
}
const checkClause = (
	db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'records'").get() as { sql: string }
).sql;
check(
	"status CHECK widened to include 'wanted'",
	/check\s*\(status\s+in\s*\(\s*'in_collection'\s*,\s*'sold'\s*,\s*'traded_away'\s*,\s*'wanted'\s*\)\s*\)/i.test(
		checkClause
	)
);
const afterIndexes = (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_records_%' ORDER BY name")
		.all() as { name: string }[]
).map((i) => i.name);
check(
	'all four record indexes survive the rebuild',
	JSON.stringify(afterIndexes) === JSON.stringify(beforeIndexes),
	`${afterIndexes.join(',')} vs ${beforeIndexes.join(',')}`
);

// --- 5. Data: identical counts, unchanged field values, clean FK graph. -----
for (const t of TABLES) {
	const after = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
	check(`${t} row count unchanged`, after === beforeCounts[t], `${beforeCounts[t]} → ${after}`);
}
check(
	'foreign_key_check clean',
	db.prepare('PRAGMA foreign_key_check').all().length === 0,
	`before=${beforeFkViolations}, after=${db.prepare('PRAGMA foreign_key_check').all().length}`
);
if (spotIds.length) {
	let unchanged = true;
	const drift: string[] = [];
	for (const id of spotIds) {
		const afterRow = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as Record<string, unknown>;
		for (const col of beforeCols) {
			if (afterRow[col] !== beforeRows.get(id)?.[col]) {
				unchanged = false;
				drift.push(`record ${id} .${col}: ${String(beforeRows.get(id)?.[col])} → ${String(afterRow[col])}`);
			}
		}
	}
	check('spot-checked rows byte-identical on all pre-migration columns', unchanged, drift.slice(0, 3).join('; '));
}

// --- 6. AUTOINCREMENT survived the RENAME (next insert id = max + 1). -------
const afterSeq = (
	db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'records'").get() as { seq: number } | undefined
)?.seq;
if (beforeSeq !== undefined) {
	check('AUTOINCREMENT sequence preserved', afterSeq === beforeSeq, `${beforeSeq} → ${afterSeq}`);
}
check(
	'AUTOINCREMENT counter consistent with MAX(id)',
	afterSeq === beforeMaxId,
	`seq=${afterSeq}, max(id)=${beforeMaxId}`
);

// --- 7. Behavior through the app's own data access (scratch DB only). -------
const wanted = createRecord({
	discogs_id: null,
	barcode: '000000000001',
	artist: 'Migration Test',
	title: 'Wanted Row',
	styles: [],
	genres: [],
	year: '2026',
	labels: [],
	format: 'LP',
	limited_edition: false,
	condition_media: null,
	condition_sleeve: null,
	price_paid: 1500, // a priced want — must not touch value stats, and…
	acquired_at: null,
	source: null,
	status: 'wanted',
	wanted_at: null,
	copies: 1,
	copy_number: 828,
	copy_total: 1000,
	sale_price: null,
	sold_at: null,
	notes: null,
	cover_filename: null,
	cover_remote_url: null
});
check('create(wanted): id is max+1', wanted.id === beforeMaxId + 1, `id=${wanted.id}`);
check('create(wanted): wanted_at stamped', typeof wanted.wanted_at === 'string' && wanted.wanted_at.length > 0);
check('create(wanted): acquired_at forced null', wanted.acquired_at === null);
check('create(wanted): copy pair persisted', wanted.copy_number === 828 && wanted.copy_total === 1000);

const acquired = acquireRecord(wanted.id)!;
check('acquire: status → in_collection', acquired.status === 'in_collection');
check('acquire: wanted_at cleared', acquired.wanted_at === null);
check('acquire: acquired_at set', typeof acquired.acquired_at === 'string' && acquired.acquired_at.length > 0);
check('acquire: second call is a no-op', acquireRecord(wanted.id)!.status === 'in_collection');

const sold = updateRecord(wanted.id, { status: 'sold', sale_price: 4250 })!;
check('update → sold: sold_at auto-stamped', typeof sold.sold_at === 'string' && sold.sold_at.length > 0);
check('update → sold: sale_price kept', sold.sale_price === 4250);
const boughtBack = updateRecord(wanted.id, { status: 'in_collection' })!;
check('update → back from sold: sale_price cleared', boughtBack.sale_price === null);
check('update → back from sold: sold_at cleared', boughtBack.sold_at === null);

const rewanted = updateRecord(wanted.id, { status: 'wanted' })!;
check('re-want: wanted_at restored (not left NULL)', typeof rewanted.wanted_at === 'string');
check('re-want: acquired_at forced null again', rewanted.acquired_at === null);

const finalWants = db.prepare("SELECT COUNT(*) AS c FROM records WHERE status = 'wanted'").get() as { c: number };
check('re-want visible in the wanted count', finalWants.c === beforeWants + 1, `${beforeWants} → ${finalWants.c}`);
deleteRecord(wanted.id);
check(
	'test row deleted (scratch DB left as the migration left it)',
	(db.prepare('SELECT COUNT(*) AS c FROM records WHERE id = ?').get(wanted.id) as { c: number }).c === 0
);

db.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
