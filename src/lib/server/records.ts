/**
 * Records data access (server-only). Thin prepared-statement wrapper over the
 * SQLite layer; all business logic for create/update/list/delete lives here so
 * route handlers stay small.
 */
import type Database from 'better-sqlite3';
import { getDb } from '$lib/server/db';
import { MEDIA_DIR, ensureDataDirs } from '$lib/server/paths';
import type { ListOptions, PlayRow, PhotoRow, RecordRow, RecordStatus } from '$lib/types';
import { parseGenreList } from '$lib/types';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Genres live in the record_genres junction table (one row per genre), so raw
 * records rows never carry a `genres` field — every record read hydrates it
 * from the junction before returning.
 */
function hydrateGenres(row: Omit<RecordRow, 'genres'>): RecordRow {
	const genres = (
		getDb()
			.prepare('SELECT genre FROM record_genres WHERE record_id = ? ORDER BY id')
			.all(row.id) as { genre: string }[]
	).map((g) => g.genre);
	return { ...row, genres };
}

/** For modules that read raw record rows directly (e.g. the exporter). */
export function withGenres(row: Omit<RecordRow, 'genres'>): RecordRow {
	return hydrateGenres(row);
}

export function findRecordById(id: number): RecordRow | undefined {
	const row = getDb().prepare('SELECT * FROM records WHERE id = ?').get(id) as
		| Omit<RecordRow, 'genres'>
		| undefined;
	return row ? hydrateGenres(row) : undefined;
}

export function findByBarcode(barcode: string): RecordRow | undefined {
	const digits = barcode.replace(/\D+/g, '');
	if (!digits) return undefined;
	const row = getDb()
		.prepare('SELECT * FROM records WHERE barcode = ? LIMIT 1')
		.get(digits) as Omit<RecordRow, 'genres'> | undefined;
	return row ? hydrateGenres(row) : undefined;
}

export function findByDiscogsId(discogsId: number): RecordRow | undefined {
	const row = getDb()
		.prepare('SELECT * FROM records WHERE discogs_id = ? LIMIT 1')
		.get(discogsId) as Omit<RecordRow, 'genres'> | undefined;
	return row ? hydrateGenres(row) : undefined;
}

/** One record's genre rows for batch writes (create / update). */
function upsertRecordGenres(db: Database.Database, recordId: number, genres: string[]): void {
	const deleteAll = db.prepare('DELETE FROM record_genres WHERE record_id = ?');
	const insert = db.prepare('INSERT OR IGNORE INTO record_genres (record_id, genre) VALUES (?, ?)');
	deleteAll.run(recordId);
	for (const g of genres) insert.run(recordId, g);
}

/* ------------------------------------------------------------------ */
/* List / search / sort / filter                                       */
/* ------------------------------------------------------------------ */

const SORTABLE: Record<ListOptions['sort'], string> = {
	artist: 'artist',
	title: 'title',
	year: 'year',
	// Genres live in the junction table — sorting by genre orders by the first
	// (lowest-id) genre entry, exposed as rg0.genre below.
	genre: 'rg0.genre',
	label: 'label',
	acquired_at: 'acquired_at',
	updated_at: 'updated_at'
};

export function listRecords(opts: ListOptions): RecordRow[] {
	const db = getDb();
	const where: string[] = [];
	const params: Record<string, unknown> = {};

	if (opts.search && opts.search.trim()) {
		where.push(
			`(r.artist LIKE @q OR r.title LIKE @q OR r.label LIKE @q OR EXISTS (SELECT 1 FROM record_genres g WHERE g.record_id = r.id AND g.genre LIKE @q))`
		);
		params.q = `%${opts.search.trim()}%`;
	}
	if (opts.genre) {
		where.push(`EXISTS (SELECT 1 FROM record_genres g WHERE g.record_id = r.id AND g.genre = @genre)`);
		params.genre = opts.genre;
	}
	if (opts.label) {
		where.push('r.label = @label');
		params.label = opts.label;
	}
	if (opts.status) {
		where.push('r.status = @status');
		params.status = opts.status;
	}

	const sortCol = SORTABLE[opts.sort] ?? 'r.artist';
	const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
	const sql = `SELECT r.* FROM records r
		LEFT JOIN record_genres rg0 ON rg0.record_id = r.id AND rg0.id = (
			SELECT MIN(id) FROM record_genres WHERE record_id = r.id
		)
		${where.length ? `WHERE ${where.join(' AND ')}` : ''}
		ORDER BY ${sortCol} IS NULL, ${sortCol} ${dir}, r.artist ASC, r.title ASC`;

	return (db.prepare(sql).all(params) as Omit<RecordRow, 'genres'>[]).map(hydrateGenres);
}

/** Distinct values for filter dropdowns. */
export function distinctValues(column: 'genre' | 'label' | 'source'): string[] {
	const db = getDb();
	if (column === 'genre') {
		// Genres are individual entries now — a record with "Electronic, Pop"
		// contributes to both dropdown values.
		const rows = db
			.prepare('SELECT DISTINCT genre AS v FROM record_genres ORDER BY v')
			.all() as { v: string }[];
		return rows.map((r) => r.v);
	}
	const rows = db
		.prepare(
			`SELECT DISTINCT ${column} AS v FROM records WHERE ${column} IS NOT NULL AND ${column} != '' ORDER BY v`
		)
		.all() as { v: string }[];
	return rows.map((r) => r.v);
}

export function countRecords(): number {
	return (getDb().prepare('SELECT COUNT(*) AS c FROM records').get() as { c: number }).c;
}

/* ------------------------------------------------------------------ */
/* Create / update / delete                                            */
/* ------------------------------------------------------------------ */

export interface NewRecordInput {
	discogs_id: number | null;
	barcode: string | null;
	artist: string;
	title: string;
	style: string | null;
	/** Individual genres (one record_genres row each). */
	genres: string[];
	year: string | null;
	label: string | null;
	format: string | null;
	limited_edition: boolean;
	condition_media: string | null;
	condition_sleeve: string | null;
	price_paid: number | null; // cents
	acquired_at: string | null;
	source: string | null;
	status: RecordStatus;
	copies: number;
	notes: string | null;
	cover_filename: string | null;
	cover_remote_url: string | null;
}

export function createRecord(input: NewRecordInput): RecordRow {
	const db = getDb();
	const now = new Date().toISOString();
	const genres = input.genres.map((g) => g.trim()).filter(Boolean);
	const insertRecord = db.prepare(
		`INSERT INTO records (
			discogs_id, barcode, artist, title, style, year, label, format,
			limited_edition, condition_media, condition_sleeve, price_paid, acquired_at,
			source, status, copies, notes, cover_filename, cover_remote_url, created_at, updated_at
		) VALUES (
			@discogs_id, @barcode, @artist, @title, @style, @year, @label, @format,
			@limited_edition, @condition_media, @condition_sleeve, @price_paid, @acquired_at,
			@source, @status, @copies, @notes, @cover_filename, @cover_remote_url, @now, @now
		)`
	);
	const { genres: _genres, ...rest } = input;
	const newId = db.transaction((): number => {
		const info = insertRecord.run({
			...rest,
			limited_edition: input.limited_edition ? 1 : 0,
			now
		});
		const recordId = Number(info.lastInsertRowid);
		upsertRecordGenres(db, recordId, genres);
		return recordId;
	})();
	return findRecordById(newId)!;
}

/** Parse the shared record form (import preview + manual entry) into a NewRecordInput. */
export function parseRecordForm(data: FormData): NewRecordInput | null {
	const str = (k: string): string | null => {
		const v = data.get(k);
		return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
	};

	const artist = str('artist');
	const title = str('title');
	if (!artist || !title) return null;

	const priceRaw = str('price_paid');
	let price_paid: number | null = null;
	if (priceRaw) {
		const parsed = Math.round(parseFloat(priceRaw) * 100);
		price_paid = Number.isFinite(parsed) ? parsed : null;
	}

	const statusRaw = str('status') ?? '';
	const status: RecordStatus = (['in_collection', 'sold', 'traded_away'] as const).includes(
		statusRaw as RecordStatus
	)
		? (statusRaw as RecordStatus)
		: 'in_collection';

	return {
		discogs_id: str('discogs_id') ? Number.parseInt(str('discogs_id')!, 10) || null : null,
		barcode: str('barcode'),
		artist,
		title,
		style: str('style'),
		genres: parseGenreList(str('genre')),
		year: str('year'),
		label: str('label'),
		format: str('format'),
		limited_edition: data.get('limited_edition') === 'on',
		condition_media: str('condition_media'),
		condition_sleeve: str('condition_sleeve'),
		price_paid,
		acquired_at: str('acquired_at'),
		source: str('source'),
		status,
		copies: 1,
		notes: str('notes'),
		cover_filename: null,
		cover_remote_url: str('cover_url')
	};
}

export type UpdateRecordInput = Partial<NewRecordInput> & { copies?: number };

/** Columns that may be updated (everything except id / created_at / genres — genres are synced in the junction). */
const UPDATABLE: (keyof NewRecordInput)[] = [
	'discogs_id',
	'barcode',
	'artist',
	'title',
	'style',
	'year',
	'label',
	'format',
	'limited_edition',
	'condition_media',
	'condition_sleeve',
	'price_paid',
	'acquired_at',
	'source',
	'status',
	'notes',
	'cover_filename',
	'cover_remote_url'
];

export function updateRecord(id: number, patch: UpdateRecordInput): RecordRow | undefined {
	const db = getDb();
	const existing = findRecordById(id);
	if (!existing) return undefined;

	const fields: string[] = [];
	const params: Record<string, unknown> = { id };

	for (const key of UPDATABLE) {
		const value = patch[key];
		if (value === undefined) continue;
		fields.push(`${key} = @${key}`);
		params[key] = key === 'limited_edition' ? (value ? 1 : 0) : value;
	}
	if (patch.copies !== undefined) {
		fields.push('copies = @copies');
		params.copies = patch.copies;
	}
	if (fields.length === 0 && patch.genres === undefined) return existing;

	params.now = new Date().toISOString();
	fields.push('updated_at = @now');

	const run = db.transaction(() => {
		if (fields.length > 0) {
			db.prepare(`UPDATE records SET ${fields.join(', ')} WHERE id = @id`).run(params);
		}
		if (patch.genres !== undefined) {
			upsertRecordGenres(db, id, patch.genres.map((g) => g.trim()).filter(Boolean));
		}
	});
	run();
	return findRecordById(id);
}

export function addCopy(id: number): RecordRow | undefined {
	getDb()
		.prepare("UPDATE records SET copies = copies + 1, updated_at = datetime('now') WHERE id = ?")
		.run(id);
	return findRecordById(id);
}

/** Delete a record and any media files it owns (covers + photos). */
export function deleteRecord(id: number): boolean {
	const db = getDb();
	const rec = findRecordById(id);
	if (!rec) return false;

	// Collect photo filenames before the FK cascades remove the rows (photos + record_genres).
	const photos = db.prepare('SELECT filename FROM photos WHERE record_id = ?').all(id) as {
		filename: string;
	}[];
	db.prepare('DELETE FROM records WHERE id = ?').run(id); // cascades to photos

	// Remove media from disk (best effort).
	for (const f of [rec.cover_filename, ...photos.map((p) => p.filename)].filter(Boolean) as string[]) {
		rmMediaFile(f);
	}
	return true;
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

export function listPhotos(recordId: number): PhotoRow[] {
	return getDb()
		.prepare('SELECT * FROM photos WHERE record_id = ? ORDER BY id ASC')
		.all(recordId) as PhotoRow[];
}

export function addPhoto(recordId: number, filename: string, caption?: string | null): PhotoRow {
	const db = getDb();
	const now = new Date().toISOString();
	const info = db
		.prepare(
			'INSERT INTO photos (record_id, filename, caption, created_at) VALUES (?, ?, ?, ?)'
		)
		.run(recordId, filename, caption ?? null, now);
	return db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(info.lastInsertRowid)) as PhotoRow;
}

export function deletePhoto(id: number): boolean {
	const db = getDb();
	const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as PhotoRow | undefined;
	if (!row) return false;
	db.prepare('DELETE FROM photos WHERE id = ?').run(id);
	rmMediaFile(row.filename);
	return true;
}

/* ------------------------------------------------------------------ */
/* Plays — one row per logged spin (undo = delete the latest row)      */
/* ------------------------------------------------------------------ */

/** Log a play. Returns the new play row. Throws if the record does not exist. */
export function logPlay(recordId: number): PlayRow {
	const db = getDb();
	if (!findRecordById(recordId)) throw new Error('Record not found');
	const now = new Date().toISOString();
	const info = db
		.prepare('INSERT INTO plays (record_id, played_at) VALUES (?, ?)')
		.run(recordId, now);
	return db.prepare('SELECT * FROM plays WHERE id = ?').get(Number(info.lastInsertRowid)) as PlayRow;
}

/** Undo the most recent play for a record. Returns true if a row was removed. */
export function undoLatestPlay(recordId: number): boolean {
	const info = getDb()
		.prepare('DELETE FROM plays WHERE id = (SELECT id FROM plays WHERE record_id = ? ORDER BY id DESC LIMIT 1)')
		.run(recordId);
	return info.changes > 0;
}

/** Total plays for one record. */
export function playCount(recordId: number): number {
	return (
		getDb()
			.prepare('SELECT COUNT(*) AS c FROM plays WHERE record_id = ?')
			.get(recordId) as { c: number }
	).c;
}

/** ISO datetime of the most recent play, or null. */
export function latestPlayedAt(recordId: number): string | null {
	const row = getDb()
		.prepare('SELECT MAX(played_at) AS t FROM plays WHERE record_id = ?')
		.get(recordId) as { t: string | null };
	return row.t;
}

/**
 * Play counts for many records in one pass (record_id → count). Records with
 * no plays are absent from the map — callers treat a missing key as 0.
 */
export function playCounts(recordIds?: number[]): Record<number, number> {
	const db = getDb();
	let rows: { record_id: number; c: number }[];
	if (recordIds && recordIds.length > 0) {
		const sql = `SELECT record_id, COUNT(*) AS c FROM plays WHERE record_id IN (${recordIds.map(() => '?').join(',')}) GROUP BY record_id`;
		rows = db.prepare(sql).all(...recordIds) as { record_id: number; c: number }[];
	} else {
		rows = db
			.prepare('SELECT record_id, COUNT(*) AS c FROM plays GROUP BY record_id')
			.all() as { record_id: number; c: number }[];
	}
	return Object.fromEntries(rows.map((r) => [r.record_id, r.c]));
}

/** Safely delete a media file by its (relative, non-traversal) filename. */
export function rmMediaFile(filename: string): void {
	// filename is stored as a bare name (e.g. "123-cover.jpg"); never allow paths.
	if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
		return;
	}
	try {
		rmSync(path.join(MEDIA_DIR, filename), { force: true });
	} catch {
		/* best effort */
	}
}

/** Ensure media dir exists and generate a collision-free filename. */
export function allocateMediaFilename(recordId: number, kind: 'cover' | 'photo'): string {
	ensureDataDirs();
	const used = new Set(
		readdirSync(MEDIA_DIR, { withFileTypes: true })
			.map((e) => e.name)
	);
	let name: string;
	do {
		name = `${recordId}-${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
	} while (used.has(name));
	return name;
}
