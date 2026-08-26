/** Temporary smoke test for the DB layer. Run via esbuild bundle (see README task 3 notes). */
import { getDb } from '$lib/server/db';

const db = getDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
	name: string;
}[];
console.log('tables:', tables.map((t) => t.name).join(', '));
console.log(
	'migrations:',
	(db.prepare('SELECT version, description FROM schema_migrations').all() as { version: number; description: string }[])
		.map((m) => `v${m.version} ${m.description}`)
		.join(' | ')
);

const ins = db.prepare(
	`INSERT INTO records (discogs_id, barcode, artist, title, style, genre, year, label, format, limited_edition, condition_media, status, copies)
	 VALUES (@discogs_id, @barcode, @artist, @title, @style, @genre, @year, @label, @format, @limited_edition, @condition_media, @status, @copies)`
);
const info = ins.run({
	discogs_id: 176126,
	barcode: '0123456789012',
	artist: 'Test Artist',
	title: 'Smoke Test LP',
	style: null,
	genre: 'Rock',
	year: '1975',
	label: 'Test Label',
	format: 'Vinyl, LP',
	limited_edition: 1,
	condition_media: 'VG+',
	status: 'in_collection',
	copies: 2
});
console.log('inserted id:', info.lastInsertRowid);

const row = db.prepare('SELECT artist, title, limited_edition, copies, status FROM records WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
console.log('read back:', JSON.stringify(row));

// photos FK + cascade check
const pIns = db.prepare('INSERT INTO photos (record_id, filename) VALUES (?, ?)');
pIns.run(Number(info.lastInsertRowid), 'smoke.jpg');
const photoCount = (db.prepare('SELECT COUNT(*) c FROM photos').get() as { c: number }).c;
console.log('photo rows:', photoCount);

db.prepare('DELETE FROM records WHERE id = ?').run(Number(info.lastInsertRowid));
const after = (db.prepare('SELECT COUNT(*) c FROM photos').get() as { c: number }).c;
console.log('photos after cascade delete:', after);
console.log('SMOKE OK');
