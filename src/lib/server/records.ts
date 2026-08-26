/**
 * Records data access (server-only). Thin prepared-statement wrapper over the
 * SQLite layer; all business logic for create/update/list/delete lives here so
 * route handlers stay small.
 */
import { getDb } from '$lib/server/db';
import { MEDIA_DIR, ensureDataDirs } from '$lib/server/paths';
import type { ListOptions, PhotoRow, RecordRow, RecordStatus } from '$lib/types';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

export function findRecordById(id: number): RecordRow | undefined {
	return getDb().prepare('SELECT * FROM records WHERE id = ?').get(id) as RecordRow | undefined;
}

export function findByBarcode(barcode: string): RecordRow | undefined {
	const digits = barcode.replace(/\D+/g, '');
	if (!digits) return undefined;
	return getDb().prepare('SELECT * FROM records WHERE barcode = ? LIMIT 1').get(digits) as
		| RecordRow
		| undefined;
}

export function findByDiscogsId(discogsId: number): RecordRow | undefined {
	return getDb().prepare('SELECT * FROM records WHERE discogs_id = ? LIMIT 1').get(discogsId) as
		| RecordRow
		| undefined;
}

/* ------------------------------------------------------------------ */
/* List / search / sort / filter                                       */
/* ------------------------------------------------------------------ */

const SORTABLE: Record<ListOptions['sort'], string> = {
	artist: 'artist',
	title: 'title',
	year: 'year',
	genre: 'genre',
	label: 'label',
	acquired_at: 'acquired_at',
	updated_at: 'updated_at'
};

export function listRecords(opts: ListOptions): RecordRow[] {
	const db = getDb();
	const where: string[] = [];
	const params: Record<string, unknown> = {};

	if (opts.search && opts.search.trim()) {
		where.push('(artist LIKE @q OR title LIKE @q OR genre LIKE @q OR label LIKE @q)');
		params.q = `%${opts.search.trim()}%`;
	}
	if (opts.genre) {
		where.push('genre = @genre');
		params.genre = opts.genre;
	}
	if (opts.label) {
		where.push('label = @label');
		params.label = opts.label;
	}
	if (opts.status) {
		where.push('status = @status');
		params.status = opts.status;
	}

	const sortCol = SORTABLE[opts.sort] ?? 'artist';
	const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
	const sql = `SELECT * FROM records ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
		ORDER BY ${sortCol} IS NULL, ${sortCol} ${dir}, artist ASC, title ASC`;

	return db.prepare(sql).all(params) as RecordRow[];
}

/** Distinct values for filter dropdowns. */
export function distinctValues(column: 'genre' | 'label'): string[] {
	const rows = getDb()
		.prepare(`SELECT DISTINCT ${column} AS v FROM records WHERE ${column} IS NOT NULL AND ${column} != '' ORDER BY v`)
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
	genre: string | null;
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
	const info = db
		.prepare(
			`INSERT INTO records (
				discogs_id, barcode, artist, title, style, genre, year, label, format,
				limited_edition, condition_media, condition_sleeve, price_paid, acquired_at,
				source, status, copies, notes, cover_filename, cover_remote_url, created_at, updated_at
			) VALUES (
				@discogs_id, @barcode, @artist, @title, @style, @genre, @year, @label, @format,
				@limited_edition, @condition_media, @condition_sleeve, @price_paid, @acquired_at,
				@source, @status, @copies, @notes, @cover_filename, @cover_remote_url, @now, @now
			)`
		)
		.run({ ...input, limited_edition: input.limited_edition ? 1 : 0, now });
	return findRecordById(Number(info.lastInsertRowid))!;
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
		genre: str('genre'),
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

/** Columns that may be updated (everything except id / created_at). */
const UPDATABLE: (keyof NewRecordInput)[] = [
	'discogs_id',
	'barcode',
	'artist',
	'title',
	'style',
	'genre',
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
	if (fields.length === 0) return existing;

	params.now = new Date().toISOString();
	fields.push('updated_at = @now');

	db.prepare(`UPDATE records SET ${fields.join(', ')} WHERE id = @id`).run(params);
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

	// Collect photo filenames before the FK cascade removes the rows.
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
