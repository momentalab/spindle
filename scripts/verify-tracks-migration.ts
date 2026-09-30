/**
 * Verify the tracklist + release-snapshot data layer on a scratch database
 * (never the real one):
 *   - migration v8 created record_tracks (+ index) and release_snapshots on a
 *     fresh DB, FK cascade intact (delete a record → its tracks + snapshot go),
 *     foreign_key_check clean. (The upgrade path is the same plain DDL — every
 *     statement is CREATE TABLE/INDEX IF NOT EXISTS, so an existing v7 schema
 *     gains both tables untouched.)
 *   - track CRUD: addTrack requires a title, updateTrack is a partial patch
 *     (favorite toggle rides the same write path), deleteTrack, insertion-order
 *     display, favoriteCounts single GROUP BY,
 *   - seedTracklist: display order preserved, blank titles dropped, an empty
 *     fetched list never wipes user rows, favorites carried over by
 *     normalized position+title across a re-seed,
 *   - toSnapshot: trim/round normalization, credits from companies +
 *     extraartists, videos kept only when title+uri present,
 *   - collectionStats: favorite totals + the top-tracks ledger ordering,
 *   - export: CSV tracks table (favorite as yes/no) and JSON all-tables dump.
 *
 * Run (bundled — enrichment pulls in discogs.ts, which needs SvelteKit's env
 * alias; the stub keeps it inert):
 *   ./node_modules/.bin/esbuild scripts/verify-tracks-migration.ts --bundle --platform=node --format=cjs \
 *     "--alias:$lib=./src/lib" "--alias:$env/dynamic/private=./scripts/env-stub.ts" \
 *     --external:better-sqlite3 --outfile=.verify-tracks.cjs && node .verify-tracks.cjs; rm -f .verify-tracks.cjs
 */
import assert from 'node:assert';
import { mkdirSync, rmSync } from 'node:fs';

const DATA = '/tmp/mynyl-tracks-mig/data';
rmSync('/tmp/mynyl-tracks-mig', { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
process.env.DATA_DIR = DATA; // must precede the dynamic import (paths read env at init)

const { getDb } = await import('../src/lib/server/db');
const db = getDb(); // fresh DB — runs migrations v1..v8 on the scratch copy
const { listTracks, addTrack, updateTrack, deleteTrack, favoriteCounts, replaceTracklist } =
	await import('../src/lib/server/tracks');
const { seedTracklist, storeSnapshot, snapshotForRecord } = await import('../src/lib/server/enrichment');
const { toSnapshot } = await import('../src/lib/server/discogs');
const { collectionStats } = await import('../src/lib/server/stats');
const { exportAsCsv, exportAsJson } = await import('../src/lib/server/export');
import type { RawRelease } from '../src/lib/server/discogs';
import type { ReleaseSnapshot } from '../src/lib/types';

const fkClean = (): boolean => (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0;
const count = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

// --- migration ----------------------------------------------------------------
const versions = (
	db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]
).map((v) => v.version);
assert.ok(versions.includes(8), `migration v8 present (got ${versions})`);
for (const t of ['record_tracks', 'release_snapshots']) {
	assert.ok(
		db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`).get() !== undefined,
		`${t} table present`
	);
}
assert.ok(
	db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_record_tracks_record_id'").get() !==
		undefined,
	'record_tracks index present'
);

// --- seed ---------------------------------------------------------------------
const ins = db.prepare(
	`INSERT INTO records (artist, title, status, discogs_id) VALUES (@artist, @title, @status, @discogs_id)`
);
function seed(name: string, artist: string, title: string, discogsId?: number): number {
	const id = Number(ins.run({ artist, title, status: 'in_collection', discogs_id: discogsId ?? null }).lastInsertRowid);
	return id;
}

const a = seed('a', 'Alpha Artist', 'First Album', 1001);
const b = seed('b', 'Beta Artist', 'Second Album');

// --- CRUD ---------------------------------------------------------------------
assert.throws(() => addTrack(a, { position: null, title: '   ', duration: null }), /title is required/i);

addTrack(a, { position: 'A1', title: 'Opener', duration: '3:05' });
addTrack(a, { position: 'A2', title: 'Bridge, (live)', duration: null }); // comma + parens: quoting safety
addTrack(a, { position: 'B1', title: 'Closer', duration: '4:11', favorite: 1 });

let tracks = listTracks(a);
assert.strictEqual(tracks.length, 3, 'listTracks returns all rows');
assert.deepStrictEqual(
	tracks.map((t) => t.title),
	['Opener', 'Bridge, (live)', 'Closer'],
	'insertion order preserved'
);
const bridgeId = tracks[1].id;
const closerId = tracks[2].id;
assert.strictEqual(
	closerId === undefined ? 0 : tracks.find((t) => t.title === 'Closer')!.favorite,
	1,
	'favorite flag set'
);

// partial patch: position only — title/duration/favorite untouched
const afterPatch = updateTrack(tracks[0].id, { position: 'A1 ' })!; // trims
assert.strictEqual(afterPatch.position, 'A1', 'position trimmed on write');
assert.strictEqual(afterPatch.title, 'Opener', 'untouched fields survive the patch');

// favorite toggle is the same write path
const unfav = updateTrack(closerId, { favorite: 0 })!;
assert.strictEqual(unfav.favorite, 0, 'favorite toggled off');
const refav = updateTrack(closerId, { favorite: 1 })!;
assert.strictEqual(refav.favorite, 1, 'favorite toggled on');

// blank title rejected on edit too
assert.throws(() => updateTrack(bridgeId, { title: '  ' }), /title is required/i);

let counts = favoriteCounts([a, b]);
assert.deepStrictEqual(counts.get(a), { total: 3, fav: 1 }, 'favoriteCounts per-record');
assert.strictEqual(counts.has(b), false, 'records with no tracks are absent from the map');
counts = favoriteCounts([]);
assert.strictEqual(counts.size, 0, 'empty id list is a no-op');

assert.ok(deleteTrack(bridgeId), 'deleteTrack reports success');
assert.strictEqual(listTracks(a).length, 2, 'row removed');
assert.ok(!deleteTrack(999999), 'deleting a missing id is a miss');

// --- FK cascade ----------------------------------------------------------------
const temp = seed('temp', 'Temp Artist', 'Gone Album', 1002);
addTrack(temp, { position: null, title: 'Will Cascade' });
storeSnapshot(temp, {
	discogs_id: 1002,
	country: 'US',
	series: [],
	notes: null,
	released_formatted: null,
	community: { want: null, have: null, rating_avg: null, rating_count: null },
	credits: [],
	videos: [],
	fetched_at: new Date().toISOString()
});
assert.strictEqual(count('record_tracks'), 3, 'temp track present before delete');
assert.strictEqual(count('release_snapshots'), 1, 'temp snapshot present before delete');
db.prepare('DELETE FROM records WHERE id = ?').run(temp);
assert.strictEqual(count('record_tracks'), 2, 'track cascaded on record delete');
assert.strictEqual(count('release_snapshots'), 0, 'snapshot cascaded on record delete');
assert.ok(fkClean(), 'foreign_key_check clean after cascades');

// --- seedTracklist (no network — feed a raw release) ---------------------------
const rawRelease: RawRelease = {
	id: 1001,
	title: 'First Album',
	tracklist: [
		{ position: 'A1', title: '  Opener  ', duration: '3:05' },
		{ position: 'A2', title: '   ', duration: 'x' }, // blank — dropped
		{ position: 'A3', title: 'New Mid', duration: '2:59' },
		{ position: 'B1', title: 'Closer', duration: '4:11' }
	]
};
const seeded = seedTracklist(a, rawRelease);
assert.strictEqual(seeded, 3, 'blank-title row dropped from the seed');
tracks = listTracks(a);
assert.deepStrictEqual(
	tracks.map((t) => t.title),
	['Opener', 'New Mid', 'Closer'],
	'seed order = release order'
);
assert.strictEqual(tracks[0].title, 'Opener');
assert.strictEqual(tracks.find((t) => t.title === 'Opener')!.title, 'Opener');
// the existing favorite was on (B1, Closer) — carry-over matches position+title:
assert.strictEqual(tracks.find((t) => t.title === 'Closer')!.favorite, 1, 'favorite carried over by position+title');
assert.strictEqual(tracks.find((t) => t.title === 'Opener')!.favorite, 0, 'unmatched row loses no favorite (had none)');

// case-insensitive carry-over: same positions, only the title case differs
seedTracklist(a, {
	id: 1001,
	title: 'First Album',
	tracklist: [
		{ position: 'A1', title: 'opener' },
		{ position: 'A3', title: 'New Mid' },
		{ position: 'B1', title: 'Closer' }
	]
});
tracks = listTracks(a);
assert.strictEqual(
	tracks.find((t) => t.title.toLowerCase() === 'closer')!.favorite,
	1,
	'carry-over is case-insensitive on the title'
);

// the guard: an empty fetched list must never wipe user rows
const before = listTracks(a).length;
assert.strictEqual(seedTracklist(a, { id: 1001, title: 'First Album', tracklist: [] }), 0, 'empty seed reports 0');
assert.strictEqual(listTracks(a).length, before, 'user rows survive an empty Discogs tracklist');

// replaceTracklist primitive: full replacement resets favorites for new titles
replaceTracklist(b, [
	{ position: '1', title: 'Solo A' },
	{ position: '2', title: 'Solo B' }
]);
assert.deepStrictEqual(
	listTracks(b).map((t) => t.title),
	['Solo A', 'Solo B']
);
replaceTracklist(b, [
	{ position: '1', title: 'Solo A' },
	{ position: '2', title: 'Solo B (re-titled)' } // "Solo B" no longer matches
]);
assert.strictEqual(
	listTracks(b).find((t) => t.title === 'Solo B (re-titled)')!.favorite,
	0,
	'renamed rows do not inherit old favorites'
);

// --- snapshot store/load -------------------------------------------------------
const snap: ReleaseSnapshot = toSnapshot(
	{
		id: 1001,
		title: 'First Album',
		country: '  US  ',
		series: [' Series One ', '', 'Series Two'],
		notes: '  A reissue.  ',
		released_formatted: '23 May 1974, US',
		community: { want: 120, have: 340, rating: { average: 4.3456, count: 87 } },
		companies: [{ name: 'Mastering Co', entity_type_name: 'Mastered At' }, { name: '' }],
		extraartists: [{ name: 'Guest Voc', role: 'Vocals' }, { name: '' }],
		videos: [
			{ title: ' "Opener" (Official)', duration: 185, uri: 'https://youtube.com/watch?v=x' },
			{ title: '', duration: 10, uri: 'https://youtube.com/watch?v=y' }, // no title — dropped
			{ title: 'NoUri', duration: null } // no uri — dropped
		]
	} as RawRelease,
	1001
);
assert.strictEqual(snap.country, 'US', 'country trimmed');
assert.deepStrictEqual(snap.series, ['Series One', 'Series Two'], 'series trimmed + empties dropped');
assert.strictEqual(snap.notes, 'A reissue.', 'notes trimmed');
assert.strictEqual(snap.community.rating_avg, 4.35, 'rating rounded to 2dp');
assert.strictEqual(snap.community.rating_count, 87);
assert.deepStrictEqual(
	snap.credits.map((c) => [c.kind, c.name, c.role]),
	[
		['company', 'Mastering Co', 'Mastered At'],
		['artist', 'Guest Voc', 'Vocals']
	],
	'credits from companies + extraartists, empties dropped'
);
assert.strictEqual(snap.videos.length, 1, 'videos kept only with title + uri');
assert.strictEqual(snap.videos[0].duration, 185);

storeSnapshot(a, snap);
const loaded = snapshotForRecord(a)!;
assert.deepStrictEqual(loaded, snap, 'snapshot round-trips through JSON');
// latest-wins: a second store overwrites
const later = { ...snap, notes: 'Updated.', fetched_at: 'later' };
storeSnapshot(a, later);
assert.strictEqual(snapshotForRecord(a)!.notes, 'Updated.', 'latest-wins upsert');
assert.strictEqual(snapshotForRecord(b), undefined, 'no snapshot → undefined');

// --- stats --------------------------------------------------------------------
const stats = collectionStats('all');
// a: 2 rows (Opener, New Mid? — after the two re-seeds: closer+Opener) + b: 2 rows.
// Favorites: a's "Closer"/"closer" row = 1; b none. Totals:
assert.strictEqual(stats.favorite_tracks_total, 1, 'one starred track across the scratch DB');
assert.strictEqual(stats.favorite_track_albums, 1, 'on one album');
assert.ok(
	stats.favorite_tracks_top.some((t) => t.record_id === a && t.title.toLowerCase() === 'closer'),
	'ledger includes the starred track'
);
assert.ok(
	stats.favorite_tracks_top.every((t) => Number.isInteger(t.track_id)),
	'ledger carries track ids'
);

// --- export -------------------------------------------------------------------
const csv = exportAsCsv('tracks');
assert.ok(csv.startsWith('id,record_id,position,title,duration,favorite (yes/no)'), 'tracks CSV header');
assert.ok(
	csv.split('\r\n').some((line) => line.includes(',yes')),
	'favorite rendered as yes/no'
);

const json = JSON.parse(exportAsJson('all')) as {
	record_count: number;
	track_count: number;
	tracks: { title: string; favorite: number }[];
};
assert.strictEqual(json.track_count, json.tracks.length, 'track_count matches the array');
assert.ok(
	json.tracks.some((t) => t.title.toLowerCase() === 'closer'),
	'starred track in JSON dump'
);

console.log('✓ tracks migration + data layer: all assertions passed');
// scratch cleanup happens by re-running (rmSync at top); leave no server-side residue.
