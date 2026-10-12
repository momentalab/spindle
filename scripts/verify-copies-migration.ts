/**
 * Verify the specific-copies data layer (migration v9) on a scratch database
 * (never the real one):
 *   - migration v9 creates record_copies (+ index) and backfills each existing
 *     records.copies counter N into N unlabeled rows, so the counter stays
 *     exactly in sync from the first run after migration,
 *   - the upgrade path is exercised for real: a fresh DB is rolled back to a
 *     pre-v9 state (v9 row dropped from schema_migrations, table removed,
 *     legacy counters seeded), then reopened so v9 runs on it,
 *   - copy CRUD through the app's own data access: createRecord seeds the
 *     first row, addSpecificCopy trims/blank-labels and keeps counter = rows,
 *     renameCopy gives an existing copy its label (blank clears it),
 *     removeSpecificCopy deletes one specific row (not just a count), the
 *     floor (last copy) is a no-op, a missing id is a miss,
 *   - FK cascade: deleting a record takes its copy rows with it,
 *   - the label CHECK rejects blank identifiers at the SQL level.
 *
 * Run (bundled — server modules pull in SvelteKit aliases; the stub keeps them inert):
 *   node scripts/verify-bundle.mjs scripts/verify-copies-migration.ts .verify-copies-mig.mjs \
 *     && DATA_DIR=.scratch/verify-copies-mig/data node .verify-copies-mig.mjs; rm -f .verify-copies-mig.mjs
 */
import assert from 'node:assert';
import { mkdirSync, rmSync } from 'node:fs';

const SCRATCH = '.scratch/verify-copies-mig';
const DATA = `${SCRATCH}/data`;
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
// Must precede the dynamic import: paths.ts reads DATA_DIR at module init.
process.env.DATA_DIR = DATA;

const { getDb, checkpointAndClose } = await import('../src/lib/server/db');
let db = getDb(); // fresh DB — runs migrations v1..v9 on the scratch copy
// Belt and braces against a missing env var silently pointing at ./data:
assert.ok(db.name.includes('verify-copies-mig'), `opened the scratch DB (got ${db.name})`);

const fkClean = (): boolean => (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0;
const count = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
/** The invariant under test: the denormalized counter equals the row count, per record. */
function assertInSync(): void {
	const rows = db
		.prepare(
			`SELECT r.id, r.copies AS c, (SELECT COUNT(*) FROM record_copies rc WHERE rc.record_id = r.id) AS n
			 FROM records r ORDER BY r.id`
		)
		.all() as { id: number; c: number; n: number }[];
	for (const r of rows) assert.strictEqual(r.n, r.c, `record ${r.id}: counter (${r.c}) = copy rows (${r.n})`);
}

// --- migration v9 on a fresh DB ----------------------------------------------
const versions = (
	db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]
).map((v) => v.version);
assert.ok(versions.includes(9), `migration v9 present (got ${versions})`);
for (const t of ['record_copies']) {
	assert.ok(
		db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`).get() !== undefined,
		`${t} table present`
	);
}
assert.ok(
	db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_record_copies_record_id'").get() !==
		undefined,
	'record_copies index present'
);

// --- roll back to a pre-v9 state, then let the real migration run on it -------
db.prepare('DELETE FROM schema_migrations WHERE version = 9').run();
db.exec('DROP TABLE record_copies');
db.prepare(
	`INSERT INTO records (artist, title, status, copies) VALUES ('Legacy Two', 'Counter of Two', 'in_collection', 2)`
).run();
db.prepare(
	`INSERT INTO records (artist, title, status, copies) VALUES ('Legacy Three', 'Counter of Three', 'in_collection', 3)`
).run();
db.prepare(
	`INSERT INTO records (artist, title, status, copies) VALUES ('Wanted One', 'Still a Want', 'wanted', 1)`
).run();
checkpointAndClose(); // release the connection so the next getDb() re-runs migrate()

db = getDb(); // v9 now runs on the "legacy" DB — the real upgrade path
assert.ok(db.name.includes('verify-copies-mig'), 'reopened the scratch DB');
assert.strictEqual(count('record_copies'), 6, 'backfill: 2 + 3 + 1 = 6 copy rows');
const labels = db.prepare('SELECT COUNT(*) AS n FROM record_copies WHERE label IS NOT NULL').get() as {
	n: number;
};
assert.strictEqual(labels.n, 0, 'backfilled copies are unlabeled');
assertInSync();
assert.ok(fkClean(), 'foreign_key_check clean after backfill');

// --- CRUD through the app's data layer ----------------------------------------
const { createRecord, addSpecificCopy, removeSpecificCopy, renameCopy, listCopies, deleteRecord } =
	await import('../src/lib/server/records');
import type { NewRecordInput } from '../src/lib/server/records';

function makeInput(over: Partial<NewRecordInput> = {}): NewRecordInput {
	return {
		discogs_id: null,
		barcode: null,
		artist: 'Fresh Artist',
		title: 'Fresh Album',
		styles: [],
		genres: [],
		year: null,
		labels: [],
		format: null,
		limited_edition: false,
		condition_media: null,
		condition_sleeve: null,
		price_paid: null,
		acquired_at: null,
		source: null,
		status: 'in_collection',
		wanted_at: null,
		copies: 1,
		copy_number: null,
		copy_total: null,
		sale_price: null,
		sold_at: null,
		notes: null,
		cover_filename: null,
		cover_remote_url: null,
		...over
	};
}

// createRecord seeds the counter AND its row in one transaction
const rec = createRecord(makeInput());
assert.strictEqual(rec.copies, 1, 'new record starts at one copy');
assert.strictEqual(listCopies(rec.id).length, 1, 'new record has exactly one copy row');
assertInSync();

// add: labeled, whitespace-trimmed
let updated = addSpecificCopy(rec.id, '  Second pressing · #13/500  ')!;
assert.strictEqual(updated.copies, 2, 'add increments the counter');
let copies = listCopies(rec.id);
assert.strictEqual(copies.length, 2, 'add inserts a row');
assert.strictEqual(copies[1].label, 'Second pressing · #13/500', 'label trimmed on write');
assertInSync();

// add: blank label → stored NULL (the UI shows "Copy N" by position)
updated = addSpecificCopy(rec.id, '   ')!;
assert.strictEqual(updated.copies, 3, 'blank-label add still increments');
copies = listCopies(rec.id);
assert.strictEqual(copies[2].label, null, 'blank label stored as NULL');
assertInSync();

// remove: a SPECIFIC row goes — the labeled one — and the rest keep their order
const labeledId = copies[1].id;
updated = removeSpecificCopy(labeledId)!;
assert.strictEqual(updated.copies, 2, 'remove decrements the counter');
copies = listCopies(rec.id);
assert.deepStrictEqual(
	copies.map((c) => c.label),
	[null, null],
	'the specific labeled row was removed, others survive'
);
assertInSync();

// floor: the last copy of a record can't be removed (no-op, no drift)
const loneId = listCopies(rec.id)[0].id;
updated = removeSpecificCopy(loneId)!;
assert.strictEqual(updated.copies, 1, 'floor: counter stays at 1');
assert.strictEqual(listCopies(rec.id).length, 1, 'floor: the last row survives');
assertInSync();

// missing copy id is a miss, not an error
assert.strictEqual(removeSpecificCopy(999999), undefined, 'removing a missing copy id is a miss');

// rename: give an existing (unlabeled) copy its identity; blank clears it again
const renameMeId = listCopies(rec.id)[0].id;
updated = renameCopy(renameMeId, '  The one with the cracked spine  ')!;
assert.strictEqual(listCopies(rec.id)[0].label, 'The one with the cracked spine', 'rename trims and writes the label');
assertInSync();
updated = renameCopy(renameMeId, '   ')!;
assert.strictEqual(listCopies(rec.id)[0].label, null, 'blank rename clears back to unlabeled');
assertInSync();
assert.strictEqual(renameCopy(999999, 'Ghost'), undefined, 'renaming a missing copy id is a miss');

// FK cascade: deleting the record takes its copy rows with it
assert.ok(deleteRecord(rec.id), 'deleteRecord reports success');
assertInSync();
assert.ok(fkClean(), 'foreign_key_check clean after cascades');

// the label CHECK: blank identifiers are rejected at the SQL level
assert.throws(
	() =>
		db.prepare("INSERT INTO record_copies (record_id, label) VALUES ((SELECT id FROM records LIMIT 1), '  ')").run(),
	/check/i,
	'blank label rejected by the CHECK constraint'
);

console.log('✓ copies migration + data layer: all assertions passed');
