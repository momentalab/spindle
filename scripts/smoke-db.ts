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
	`INSERT INTO records (discogs_id, barcode, artist, title, year, format, limited_edition, condition_media, status, copies)
	 VALUES (@discogs_id, @barcode, @artist, @title, @year, @format, @limited_edition, @condition_media, @status, @copies)`
);
const info = ins.run({
	discogs_id: 176126,
	barcode: '0123456789012',
	artist: 'Test Artist',
	title: 'Smoke Test LP',
	year: '1975',
	format: 'Vinyl, LP',
	limited_edition: 1,
	condition_media: 'VG+',
	status: 'in_collection',
	copies: 2
});
console.log('inserted id:', info.lastInsertRowid);

db.prepare('INSERT INTO record_genres (record_id, genre) VALUES (?, ?)').run(Number(info.lastInsertRowid), 'Rock');
db.prepare('INSERT INTO record_styles (record_id, style) VALUES (?, ?)').run(Number(info.lastInsertRowid), 'Funk');
db.prepare('INSERT INTO record_labels (record_id, label, catno) VALUES (?, ?, ?)').run(
	Number(info.lastInsertRowid),
	'Test Label',
	'TL-1'
);

const row = db.prepare('SELECT artist, title, limited_edition, copies, status FROM records WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
console.log('read back:', JSON.stringify(row));

const genres = (db.prepare('SELECT genre FROM record_genres WHERE record_id = ? ORDER BY id').all(Number(info.lastInsertRowid)) as { genre: string }[]).map((g) => g.genre);
console.log('genres:', JSON.stringify(genres));

const styles = (db.prepare('SELECT style FROM record_styles WHERE record_id = ? ORDER BY id').all(Number(info.lastInsertRowid)) as { style: string }[]).map((s) => s.style);
console.log('styles:', JSON.stringify(styles));

const labels = db.prepare('SELECT label, catno FROM record_labels WHERE record_id = ? ORDER BY id').all(Number(info.lastInsertRowid)) as { label: string; catno: string | null }[];
console.log('labels:', JSON.stringify(labels));

// photos FK + cascade check
const pIns = db.prepare('INSERT INTO photos (record_id, filename) VALUES (?, ?)');
pIns.run(Number(info.lastInsertRowid), 'smoke.jpg');
const photoCount = (db.prepare('SELECT COUNT(*) c FROM photos').get() as { c: number }).c;
console.log('photo rows:', photoCount);

db.prepare('DELETE FROM records WHERE id = ?').run(Number(info.lastInsertRowid));
const after = (db.prepare('SELECT COUNT(*) c FROM photos').get() as { c: number }).c;
console.log('photos after cascade delete:', after);

// record_genres / record_styles / record_labels FK cascade check
const genresAfter = (
	db.prepare('SELECT COUNT(*) c FROM record_genres WHERE record_id = ?').get(Number(info.lastInsertRowid)) as {
		c: number;
	}
).c;
console.log('genres after cascade delete:', genresAfter);
if (genresAfter !== 0) throw new Error('record_genres rows were not cascaded');
const stylesAfter = (
	db.prepare('SELECT COUNT(*) c FROM record_styles WHERE record_id = ?').get(Number(info.lastInsertRowid)) as {
		c: number;
	}
).c;
console.log('styles after cascade delete:', stylesAfter);
if (stylesAfter !== 0) throw new Error('record_styles rows were not cascaded');
const labelsAfter = (
	db.prepare('SELECT COUNT(*) c FROM record_labels WHERE record_id = ?').get(Number(info.lastInsertRowid)) as {
		c: number;
	}
).c;
console.log('labels after cascade delete:', labelsAfter);
if (labelsAfter !== 0) throw new Error('record_labels rows were not cascaded');

console.log('SMOKE OK');
