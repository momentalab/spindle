/** Seed a scratch DATA_DIR with two records + covers for scripts/backup-roundtrip.mjs. */
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';

const DATA = process.env.DATA_DIR ?? '/tmp/mynyl-f8/data';
const db = new Database(`${DATA}/mynyl.db`);
db.pragma('journal_mode = WAL');
const ins = db.prepare(
	'INSERT INTO records (discogs_id, barcode, artist, title, genre, year, label, status, copies, price_paid) VALUES (?,?,?,?,?,?,?,?,?,?)'
);
ins.run(176126, '0123456789012', 'Sonic Youth', 'Daydream Nation', 'Noise Rock', '1988', 'DGC', 'in_collection', 1, 4299);
ins.run(6778478, '0123456789024', 'Talk Talk', 'Spirit of Eden', 'Post-rock', '1988', 'Polydor', 'in_collection', 2, 2550);
writeFileSync(`${DATA}/media/1-cover.jpg`, Buffer.from('cover-bytes-sonic'));
writeFileSync(`${DATA}/media/2-cover.jpg`, Buffer.from('cover-bytes-talktalk'));
console.log('seeded records:', db.prepare('SELECT COUNT(*) n FROM records').get().n);
db.close();
