/** Seed a scratch DATA_DIR with two records + covers for scripts/backup-roundtrip.mjs. */
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';

const DATA = process.env.DATA_DIR ?? '/tmp/spindle-f8/data';
const db = new Database(`${DATA}/spindle.db`);
db.pragma('journal_mode = WAL');
const ins = db.prepare(
	'INSERT INTO records (discogs_id, barcode, artist, title, year, label, status, copies, price_paid) VALUES (?,?,?,?,?,?,?,?,?)'
);
const id1 = Number(
	ins.run(176126, '0123456789012', 'Sonic Youth', 'Daydream Nation', '1988', 'DGC', 'in_collection', 1, 4299)
		.lastInsertRowid
);
const id2 = Number(
	ins.run(6778478, '0123456789024', 'Talk Talk', 'Spirit of Eden', '1988', 'Polydor', 'in_collection', 2, 2550)
		.lastInsertRowid
);

// Genres are individual entries in the record_genres junction table (v3+).
const genIns = db.prepare('INSERT INTO record_genres (record_id, genre) VALUES (?, ?)');
genIns.run(id1, 'Noise Rock');
genIns.run(id1, 'Alternative');
genIns.run(id2, 'Post-rock');
genIns.run(id2, 'Ambient');
writeFileSync(`${DATA}/media/1-cover.jpg`, Buffer.from('cover-bytes-sonic'));
writeFileSync(`${DATA}/media/2-cover.jpg`, Buffer.from('cover-bytes-talktalk'));
console.log('seeded records:', db.prepare('SELECT COUNT(*) n FROM records').get().n);
db.close();
