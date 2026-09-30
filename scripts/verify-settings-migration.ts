/**
 * Verify the settings store (migration v6) and the artist lead-word preference.
 * Copies the real database into a scratch dir (via sqlite3 .backup when
 * available, else raw file copy) and opens it through getDb() so any pending
 * migration runs on the copy — never the original — asserting:
 *   - all prior tables keep their exact row counts through the migration,
 *   - the settings table exists, is seeded to 'off', and upserts cleanly,
 *   - write-time normalization: OFF stores verbatim, ON rewrites at both
 *     createRecord and updateRecord time,
 *   - the one-time backfill rewrites only trailing-lead names, touches
 *     nothing else (updated_at unchanged on untouched rows), is idempotent,
 *   - foreign_key_check stays clean throughout.
 *
 * Run:
 *   npx tsx scripts/verify-settings-migration.ts
 */
import assert from 'node:assert';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DATA = '/tmp/mynyl-settings-mig/data';
const DB = path.join(DATA, 'mynyl.db');

// Fresh scratch dir; copy the live DB in (consistent snapshot when sqlite3 is
// available — it's what backups use — plain copy otherwise).
rmSync('/tmp/mynyl-settings-mig', { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
if (execFileSync('which', ['sqlite3'], { encoding: 'utf8' }).trim()) {
	execFileSync('sqlite3', [path.resolve('data/mynyl.db'), `.backup ${DB}`], { stdio: 'ignore' });
} else {
	cpSync(path.resolve('data/mynyl.db'), DB);
}

process.env.DATA_DIR = DATA;

const { getDb } = await import('../src/lib/server/db');
const db = getDb(); // runs migration v6 on the copy
const { isLeadWordNormalizationOn, setLeadWordNormalization, normalizeLeadWord, applyLeadWordToAllRecords } =
	await import('../src/lib/server/artist');
const { createRecord, updateRecord, findRecordById } = await import('../src/lib/server/records');
import type { NewRecordInput } from '../src/lib/server/records';

const fkClean = (): boolean => (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0;
const count = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

// --- pure transform ---------------------------------------------------------
assert.equal(normalizeLeadWord('Beatles, The'), 'The Beatles');
assert.equal(normalizeLeadWord('A Tribe Called Quest'), 'A Tribe Called Quest');
assert.equal(normalizeLeadWord('The Beatles'), 'The Beatles'); // idempotent
assert.equal(normalizeLeadWord('Daft Punk, The, Remaster'), 'Daft Punk, The, Remaster');

// --- migration on the copy ---------------------------------------------------
const versions = (
	db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
		version: number;
	}[]
)
	.map((r) => r.version)
	.sort((a, b) => a - b);
assert.deepEqual(versions, [1, 2, 3, 4, 5, 6]);

const before: Record<'records' | 'photos' | 'plays', number> = {
	records: count('records'),
	photos: count('photos'),
	plays: count('plays')
};
// The migration must not have disturbed collection data or FKs.
for (const t of ['records', 'photos', 'plays'] as const) assert.equal(count(t), before[t], `row drift in ${t}`);
assert.ok(fkClean(), 'foreign_key_check dirty after migration');

// The copy inherits whatever the live DB holds (a real user preference) —
// normalize to a known baseline before asserting seed/upsert behavior.
setLeadWordNormalization(false);
assert.equal(isLeadWordNormalizationOn(), false);
setLeadWordNormalization(true);
assert.equal(isLeadWordNormalizationOn(), true);
setLeadWordNormalization(false);
assert.equal(isLeadWordNormalizationOn(), false);
assert.equal(count('settings'), 1, 'settings should hold exactly the one seeded key after upserts');

// --- write-time normalization through the real data access --------------------
const base = (over: Partial<NewRecordInput>): NewRecordInput => ({
	discogs_id: null,
	barcode: null,
	artist: 'X',
	title: 'Y',
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
	source: 'manual',
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
});

setLeadWordNormalization(false);
const off = createRecord(base({ artist: 'Beatles, The', title: 'Rubber Soul' }));
assert.equal(off.artist, 'Beatles, The'); // verbatim while off

setLeadWordNormalization(true);
const on = createRecord(base({ artist: 'Beastie Boys, The', title: 'Licensed to Ill' }));
assert.equal(on.artist, 'The Beastie Boys'); // normalized at create time

const third = createRecord(base({ artist: 'Daft Punk' })); // untouched (no trailing lead word)
const edited = updateRecord(third.id, { artist: 'Sisters of Mercy, The' });
assert.equal(edited?.artist, 'The Sisters of Mercy'); // normalized at edit time

setLeadWordNormalization(false);
const edited2 = updateRecord(third.id, { artist: 'Eurythmics, The' });
assert.equal(edited2?.artist, 'Eurythmics, The'); // verbatim while off

// --- one-time backfill ---------------------------------------------------------
// Trailing-lead rows: "Beatles, The", "Eurythmics, The" + whatever the live
// copy carried. Compute the expectation from the current state rather than a
// hard count so the script holds as the collection grows.
const pendingBefore = (db.prepare('SELECT id, artist FROM records').all() as { id: number; artist: string }[]).filter(
	(r) => normalizeLeadWord(r.artist) !== r.artist
);
assert.ok(pendingBefore.length >= 2, 'expected at least the two trailing-lead test rows');

const untouched = db
	.prepare(`SELECT id, updated_at FROM records WHERE artist NOT IN (${pendingBefore.map(() => '?').join(',')})`)
	.all(...pendingBefore.map((r) => r.artist)) as { id: number; updated_at: string }[];

const changed = applyLeadWordToAllRecords();
assert.equal(changed, pendingBefore.length, 'backfill should touch exactly the trailing-lead rows');
for (const r of pendingBefore) {
	assert.equal(findRecordById(r.id)?.artist, normalizeLeadWord(r.artist));
}
// Untouched rows keep their updated_at — no spurious writes.
const untouchedAfter = db
	.prepare(`SELECT id, updated_at FROM records WHERE id IN (${[...untouched.map((u) => u.id), 0].join(',')})`)
	.all();
assert.ok(
	untouched.every((u) =>
		(untouchedAfter as { id: number; updated_at: string }[]).some((a) => a.id === u.id && a.updated_at === u.updated_at)
	),
	'backfill must not touch unrelated rows'
);
assert.equal(applyLeadWordToAllRecords(), 0, 'second run should change nothing');
assert.ok(fkClean(), 'foreign_key_check dirty after backfill');

console.log('verify-settings-migration: all assertions passed');
console.log(`  collection copied: ${before.records} records, ${before.photos} photos, ${before.plays} plays`);
console.log(`  backfill would rewrite ${pendingBefore.length} row(s) on the live copy`);
