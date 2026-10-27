/**
 * Records data access (server-only). Thin prepared-statement wrapper over the
 * SQLite layer; all business logic for create/update/list/delete lives here so
 * route handlers stay small.
 */
import type Database from 'better-sqlite3';
import { getDb } from '$lib/server/db';
import { MEDIA_DIR, ensureDataDirs } from '$lib/server/paths';
import type { LabelEntry, ListOptions, PlayRow, PhotoRow, CopyRow, RecordRow, RecordStatus } from '$lib/types';
import { parseGenreList, parseLabelList, parseStyleList, RECORD_STATUSES } from '$lib/types';
import { isLeadWordNormalizationOn, normalizeLeadWord } from '$lib/server/artist';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

type RawRecord = Omit<RecordRow, 'genres' | 'styles' | 'labels'>;

/**
 * Genres, styles and labels each live in their own junction table (one row per
 * value), so raw records rows never carry them — every record read hydrates all
 * three sets from their junctions before returning.
 */
function hydrateSets(row: RawRecord): RecordRow {
	const db = getDb();
	const genres = (
		db.prepare('SELECT genre FROM record_genres WHERE record_id = ? ORDER BY id').all(row.id) as {
			genre: string;
		}[]
	).map((g) => g.genre);
	const styles = (
		db.prepare('SELECT style FROM record_styles WHERE record_id = ? ORDER BY id').all(row.id) as {
			style: string;
		}[]
	).map((s) => s.style);
	const labels = (
		db.prepare('SELECT label, catno FROM record_labels WHERE record_id = ? ORDER BY id').all(row.id) as {
			label: string;
			catno: string | null;
		}[]
	).map((l): LabelEntry => ({ name: l.label, catno: l.catno }));
	return { ...row, genres, styles, labels };
}

/** For modules that read raw record rows directly (e.g. the exporter). */
export function withGenres(row: RawRecord): RecordRow {
	return hydrateSets(row);
}

export function findRecordById(id: number): RecordRow | undefined {
	const row = getDb().prepare('SELECT * FROM records WHERE id = ?').get(id) as RawRecord | undefined;
	return row ? hydrateSets(row) : undefined;
}

export function findByBarcode(barcode: string): RecordRow | undefined {
	const digits = barcode.replace(/\D+/g, '');
	if (!digits) return undefined;
	const row = getDb().prepare('SELECT * FROM records WHERE barcode = ? LIMIT 1').get(digits) as RawRecord | undefined;
	return row ? hydrateSets(row) : undefined;
}

export function findByDiscogsId(discogsId: number): RecordRow | undefined {
	const row = getDb().prepare('SELECT * FROM records WHERE discogs_id = ? LIMIT 1').get(discogsId) as
		RawRecord | undefined;
	return row ? hydrateSets(row) : undefined;
}

/** One record's genre rows for batch writes (create / update). */
function upsertRecordGenres(db: Database.Database, recordId: number, genres: string[]): void {
	const deleteAll = db.prepare('DELETE FROM record_genres WHERE record_id = ?');
	const insert = db.prepare('INSERT OR IGNORE INTO record_genres (record_id, genre) VALUES (?, ?)');
	deleteAll.run(recordId);
	for (const g of genres) insert.run(recordId, g);
}

function upsertRecordStyles(db: Database.Database, recordId: number, styles: string[]): void {
	const deleteAll = db.prepare('DELETE FROM record_styles WHERE record_id = ?');
	const insert = db.prepare('INSERT OR IGNORE INTO record_styles (record_id, style) VALUES (?, ?)');
	deleteAll.run(recordId);
	for (const s of styles) insert.run(recordId, s);
}

function upsertRecordLabels(db: Database.Database, recordId: number, labels: LabelEntry[]): void {
	const deleteAll = db.prepare('DELETE FROM record_labels WHERE record_id = ?');
	const insert = db.prepare('INSERT OR IGNORE INTO record_labels (record_id, label, catno) VALUES (?, ?, ?)');
	deleteAll.run(recordId);
	for (const l of labels) insert.run(recordId, l.name, l.catno);
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
	// Labels likewise order by the first (lowest-id) label entry, rl0.label.
	label: 'rl0.label',
	// Scalar subquery; NULL-safe via the shared `IS NULL` prefix in listRecords.
	favorite_tracks: '(SELECT COUNT(*) FROM record_tracks t WHERE t.record_id = r.id AND t.favorite = 1)',
	acquired_at: 'acquired_at',
	updated_at: 'updated_at'
};

export function listRecords(opts: ListOptions): RecordRow[] {
	const db = getDb();
	const where: string[] = [];
	const params: Record<string, unknown> = {};

	if (opts.search && opts.search.trim()) {
		where.push(
			`(r.artist LIKE @q OR r.title LIKE @q OR EXISTS (SELECT 1 FROM record_genres g WHERE g.record_id = r.id AND g.genre LIKE @q) OR EXISTS (SELECT 1 FROM record_labels rl WHERE rl.record_id = r.id AND rl.label LIKE @q))`
		);
		params.q = `%${opts.search.trim()}%`;
	}
	if (opts.genre) {
		where.push(`EXISTS (SELECT 1 FROM record_genres g WHERE g.record_id = r.id AND g.genre = @genre)`);
		params.genre = opts.genre;
	}
	if (opts.label) {
		where.push(`EXISTS (SELECT 1 FROM record_labels rl WHERE rl.record_id = r.id AND rl.label = @label)`);
		params.label = opts.label;
	}
	if (opts.status) {
		where.push('r.status = @status');
		params.status = opts.status;
	}
	if (opts.exclude_status) {
		where.push('r.status != @exclude_status');
		params.exclude_status = opts.exclude_status;
	}
	if (opts.favorite_only) {
		where.push('EXISTS (SELECT 1 FROM record_tracks t WHERE t.record_id = r.id AND t.favorite = 1)');
	}

	const sortCol = SORTABLE[opts.sort] ?? 'r.artist';
	const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
	const sql = `SELECT r.* FROM records r
		LEFT JOIN record_genres rg0 ON rg0.record_id = r.id AND rg0.id = (
			SELECT MIN(id) FROM record_genres WHERE record_id = r.id
		)
		LEFT JOIN record_labels rl0 ON rl0.record_id = r.id AND rl0.id = (
			SELECT MIN(id) FROM record_labels WHERE record_id = r.id
		)
		${where.length ? `WHERE ${where.join(' AND ')}` : ''}
		ORDER BY ${sortCol} IS NULL, ${sortCol} ${dir}, r.artist ASC, r.title ASC`;

	return (db.prepare(sql).all(params) as RawRecord[]).map(hydrateSets);
}

/** Distinct values for filter dropdowns. */
export function distinctValues(column: 'genre' | 'label' | 'source'): string[] {
	const db = getDb();
	if (column === 'genre') {
		// Genres are individual entries now — a record with "Electronic, Pop"
		// contributes to both dropdown values.
		const rows = db.prepare('SELECT DISTINCT genre AS v FROM record_genres ORDER BY v').all() as { v: string }[];
		return rows.map((r) => r.v);
	}
	if (column === 'label') {
		// Labels are individual entries now (clean names — catnos excluded), so a
		// record on two labels contributes to both dropdown values.
		const rows = db.prepare('SELECT DISTINCT label AS v FROM record_labels ORDER BY v').all() as { v: string }[];
		return rows.map((r) => r.v);
	}
	const rows = db
		.prepare(`SELECT DISTINCT ${column} AS v FROM records WHERE ${column} IS NOT NULL AND ${column} != '' ORDER BY v`)
		.all() as { v: string }[];
	return rows.map((r) => r.v);
}

/** Count all records, or — with a status — only the rows in that state. */
export function countRecords(status?: RecordStatus): number {
	const sql = status ? 'SELECT COUNT(*) AS c FROM records WHERE status = ?' : 'SELECT COUNT(*) AS c FROM records';
	const row = (status ? getDb().prepare(sql).get(status) : getDb().prepare(sql).get()) as { c: number };
	return row.c;
}

/* ------------------------------------------------------------------ */
/* Create / update / delete                                            */
/* ------------------------------------------------------------------ */

export interface NewRecordInput {
	discogs_id: number | null;
	barcode: string | null;
	artist: string;
	title: string;
	/** Individual styles (one record_styles row each). */
	styles: string[];
	/** Individual genres (one record_genres row each). */
	genres: string[];
	year: string | null;
	/** Individual labels (one record_labels row each, catno kept separately). */
	labels: LabelEntry[];
	format: string | null;
	limited_edition: boolean;
	condition_media: string | null;
	condition_sleeve: string | null;
	price_paid: number | null; // cents
	acquired_at: string | null;
	source: string | null;
	status: RecordStatus;
	wanted_at: string | null; // 'YYYY-MM-DD' — set on entering "wanted" (invariant, below)
	copies: number;
	copy_number: number | null;
	copy_total: number | null;
	sale_price: number | null; // cents
	sold_at: string | null; // ISO date
	notes: string | null;
	cover_filename: string | null;
	cover_remote_url: string | null;
}

export function createRecord(input: NewRecordInput): RecordRow {
	const db = getDb();
	const now = new Date().toISOString();
	const styles = input.styles.map((s) => s.trim()).filter(Boolean);
	const genres = input.genres.map((g) => g.trim()).filter(Boolean);
	const labels = input.labels.filter((l) => l.name.trim() !== '');
	// Artist lead-word normalization ("Beatles, The" -> "The Beatles") is applied
	// here — the single create chokepoint — when the settings toggle is on, so
	// every import path (barcode, manual, search-bar add, restore-free re-save)
	// stores the same canonical form.
	const artist = isLeadWordNormalizationOn() ? normalizeLeadWord(input.artist) : input.artist;
	// Status invariants are applied at write time, not in SQL. Entering "wanted"
	// stamps the wish date and forces acquired_at NULL (a wanted record can't be
	// both wanted and acquired); entering "sold" stamps the sale date.
	// User-facing event dates (acquired/wanted/sold) are date-only `YYYY-MM-DD` —
	// nobody tracks the time something happened to a record — so auto-stamps
	// slice the ISO "now" to match.
	const today = now.slice(0, 10);
	const wanted_at = input.status === 'wanted' ? (input.wanted_at ?? today) : null;
	const acquired_at = input.status === 'wanted' ? null : input.acquired_at;
	const sold_at = input.status === 'sold' ? (input.sold_at ?? today) : input.sold_at;
	const insertRecord = db.prepare(
		`INSERT INTO records (
			discogs_id, barcode, artist, title, year, format,
			limited_edition, condition_media, condition_sleeve, price_paid, acquired_at,
			source, status, wanted_at, copies, copy_number, copy_total, sale_price, sold_at,
			notes, cover_filename, cover_remote_url, created_at, updated_at
		) VALUES (
			@discogs_id, @barcode, @artist, @title, @year, @format,
			@limited_edition, @condition_media, @condition_sleeve, @price_paid, @acquired_at,
			@source, @status, @wanted_at, @copies, @copy_number, @copy_total, @sale_price, @sold_at,
			@notes, @cover_filename, @cover_remote_url, @now, @now
		)`
	);
	const { styles: _styles, genres: _genres, labels: _labels, ...rest } = input;
	const newId = db.transaction((): number => {
		const info = insertRecord.run({
			...rest,
			artist,
			limited_edition: input.limited_edition ? 1 : 0,
			acquired_at,
			wanted_at,
			sold_at,
			now
		});
		const recordId = Number(info.lastInsertRowid);
		upsertRecordStyles(db, recordId, styles);
		upsertRecordGenres(db, recordId, genres);
		upsertRecordLabels(db, recordId, labels);
		// The counter starts at input.copies — mirror it in the copies table so
		// the two can never drift from birth (normally one unlabeled copy).
		const insCopy = db.prepare('INSERT INTO record_copies (record_id, label) VALUES (?, NULL)');
		for (let i = 0; i < input.copies; i++) insCopy.run(recordId);
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

	// F7 pre-stage — sale price in dollars, same dollars→cents rounding as price_paid.
	const salePriceRaw = str('sale_price');
	let sale_price: number | null = null;
	if (salePriceRaw) {
		const parsed = Math.round(parseFloat(salePriceRaw) * 100);
		sale_price = Number.isFinite(parsed) ? parsed : null;
	}

	// Numbered pressings: both optional, independently settable positive integers.
	const posInt = (raw: string | null): number | null => {
		if (!raw) return null;
		const n = Number.parseInt(raw, 10);
		return Number.isInteger(n) && n > 0 ? n : null;
	};

	const statusRaw = str('status') ?? '';
	const status: RecordStatus = (RECORD_STATUSES as readonly string[]).includes(statusRaw)
		? (statusRaw as RecordStatus)
		: 'in_collection';

	return {
		discogs_id: str('discogs_id') ? Number.parseInt(str('discogs_id')!, 10) || null : null,
		barcode: str('barcode'),
		artist,
		title,
		styles: parseStyleList(str('style')),
		genres: parseGenreList(str('genre')),
		year: str('year'),
		labels: parseLabelList(str('label')),
		format: str('format'),
		limited_edition: data.get('limited_edition') === 'on',
		condition_media: str('condition_media'),
		condition_sleeve: str('condition_sleeve'),
		price_paid,
		acquired_at: str('acquired_at'),
		source: str('source'),
		status,
		wanted_at: str('wanted_at'),
		copies: 1,
		copy_number: posInt(str('copy_number')),
		copy_total: posInt(str('copy_total')),
		sale_price,
		sold_at: str('sold_at'),
		notes: str('notes'),
		cover_filename: null,
		cover_remote_url: str('cover_url')
	};
}

export type UpdateRecordInput = Partial<NewRecordInput> & { copies?: number };

/** Columns that may be updated (everything except id / created_at and the set fields — styles/genres/labels are synced in their junctions). wanted_at is not updatable: it's managed by the status-transition invariants below. */
const UPDATABLE: (keyof NewRecordInput)[] = [
	'discogs_id',
	'barcode',
	'artist',
	'title',
	'year',
	'format',
	'limited_edition',
	'condition_media',
	'condition_sleeve',
	'price_paid',
	'acquired_at',
	'source',
	'status',
	'copy_number',
	'copy_total',
	'sale_price',
	'sold_at',
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
	/** SET-clause writer that replaces any prior assignment to the same column. */
	const addField = (col: string, value: unknown): void => {
		const i = fields.findIndex((f) => f.startsWith(`${col} =`));
		if (i !== -1) fields.splice(i, 1); // a bare splice(-1) would drop the *last* field
		fields.push(`${col} = @${col}`);
		params[col] = value;
	};

	for (const key of UPDATABLE) {
		const value = patch[key];
		if (value === undefined) continue;
		if (key === 'artist') {
			// Same canonicalization as createRecord — the edit action feeds a full
			// parseRecordForm, so artist is present on every save.
			addField('artist', isLeadWordNormalizationOn() ? normalizeLeadWord(String(value)) : value);
			continue;
		}
		addField(key, key === 'limited_edition' ? (value ? 1 : 0) : value);
	}
	if (patch.copies !== undefined) {
		addField('copies', patch.copies);
	}

	// Status transitions get the same invariants as createRecord, using the
	// existing row so "since" dates survive re-saves.
	const oldStatus = existing.status;
	const newStatus = patch.status ?? oldStatus;
	if (newStatus !== oldStatus) {
		// All user-facing event dates are date-only `YYYY-MM-DD` — nobody tracks
		// the time something happened to a record.
		const today = new Date().toISOString().slice(0, 10);
		if (newStatus === 'wanted') {
			// Re-wanting after a sale keeps the original wish date — that's the
			// interesting number for D6. A wanted record can't have been acquired.
			addField('wanted_at', existing.wanted_at ?? today);
			addField('acquired_at', null);
		}
		if (oldStatus === 'wanted' && newStatus !== 'wanted') {
			addField('wanted_at', null);
			if (newStatus === 'in_collection' && !(patch.acquired_at ?? existing.acquired_at)) {
				addField('acquired_at', today);
			}
		}
		if (newStatus === 'sold') {
			addField('sold_at', patch.sold_at ?? existing.sold_at ?? today);
		}
		if (oldStatus === 'sold' && newStatus !== 'sold') {
			// A record you bought back is not a sale — keep the portfolio view honest.
			if (patch.sale_price === undefined) addField('sale_price', null);
			if (patch.sold_at === undefined) addField('sold_at', null);
		}
	}

	if (fields.length === 0 && patch.genres === undefined && patch.styles === undefined && patch.labels === undefined)
		return existing;

	params.now = new Date().toISOString();
	fields.push('updated_at = @now');

	const run = db.transaction(() => {
		if (fields.length > 0) {
			db.prepare(`UPDATE records SET ${fields.join(', ')} WHERE id = @id`).run(params);
		}
		if (patch.styles !== undefined) {
			upsertRecordStyles(db, id, patch.styles.map((s) => s.trim()).filter(Boolean));
		}
		if (patch.genres !== undefined) {
			upsertRecordGenres(db, id, patch.genres.map((g) => g.trim()).filter(Boolean));
		}
		if (patch.labels !== undefined) {
			upsertRecordLabels(
				db,
				id,
				patch.labels.filter((l) => l.name.trim() !== '')
			);
		}
	});
	run();
	return findRecordById(id);
}

/** All of a record's specific copies, oldest first (id order = acquisition order). */
export function listCopies(recordId: number): CopyRow[] {
	return getDb()
		.prepare('SELECT id, record_id, label, created_at FROM record_copies WHERE record_id = ? ORDER BY id')
		.all(recordId) as CopyRow[];
}

/**
 * Add one specific copy: a record_copies row + the denormalized counter, in a
 * single transaction so the two can't drift. `label` is the copy's identifier
 * ("Second pressing · #13/500"); blank/null leaves it unlabeled — the UI shows
 * "Copy N" by position. Returns the updated record, undefined if it doesn't exist.
 */
export function addSpecificCopy(recordId: number, label: string | null): RecordRow | undefined {
	const db = getDb();
	const trimmed = label?.trim() ? label.trim() : null;
	const run = db.transaction(() => {
		db.prepare('INSERT INTO record_copies (record_id, label) VALUES (?, ?)').run(recordId, trimmed);
		db.prepare("UPDATE records SET copies = copies + 1, updated_at = datetime('now') WHERE id = ?").run(recordId);
	});
	run();
	return findRecordById(recordId);
}

/**
 * Remove one specific copy by its row id: the record_copies row + the counter,
 * in a single transaction. Floored at 1 — the last copy of a record can't be
 * removed (the entry always implies at least one physical copy, the same
 * invariant the CHECK constraint encodes), so at the floor this is a no-op.
 * Returns the updated record; undefined if the copy id doesn't exist.
 */
export function removeSpecificCopy(copyId: number): RecordRow | undefined {
	const db = getDb();
	const row = db.prepare('SELECT record_id FROM record_copies WHERE id = ?').get(copyId) as
		{ record_id: number } | undefined;
	if (!row) return undefined;
	const { n } = db.prepare('SELECT COUNT(*) AS n FROM record_copies WHERE record_id = ?').get(row.record_id) as {
		n: number;
	};
	if (n <= 1) return findRecordById(row.record_id); // the floor — last copy stays
	const run = db.transaction(() => {
		db.prepare('DELETE FROM record_copies WHERE id = ?').run(copyId);
		db.prepare("UPDATE records SET copies = copies - 1, updated_at = datetime('now') WHERE id = ? AND copies > 1").run(
			row.record_id
		);
	});
	run();
	return findRecordById(row.record_id);
}

/**
 * Rename one specific copy: replace its label so an existing (e.g. unlabeled)
 * copy can be given an identity after the fact. A blank label clears it back
 * to an unlabeled copy. Returns the updated record; undefined if the copy id
 * doesn't exist.
 */
export function renameCopy(copyId: number, label: string | null): RecordRow | undefined {
	const db = getDb();
	const trimmed = label?.trim() ? label.trim() : null;
	const row = db.prepare('SELECT record_id FROM record_copies WHERE id = ?').get(copyId) as
		{ record_id: number } | undefined;
	if (!row) return undefined;
	db.prepare('UPDATE record_copies SET label = ? WHERE id = ?').run(trimmed, copyId);
	return findRecordById(row.record_id);
}

/** Optional purchase details captured at the moment of acquisition. */
export interface AcquireOptions {
	/** 'YYYY-MM-DD'; today's date when omitted or empty. */
	acquired_at?: string | null;
	/** Cents; only written when a non-null value is given (blank = keep). */
	price_paid?: number | null;
	condition_media?: string | null;
	condition_sleeve?: string | null;
}

/**
 * Acquire a wanted record: flip it into the collection, carrying optional
 * purchase details (the "just bought it" moment — date defaults to today).
 * Guarded no-op unless the row is actually wanted (a non-wanted record returns
 * untouched, so callers can distinguish via the returned status). Reuses the
 * updateRecord transition invariants (wanted_at cleared, acquired_at filled),
 * so the same rules apply as a manual status edit. Returns undefined if the
 * record doesn't exist → routes 404.
 */
export function acquireRecord(id: number, details?: AcquireOptions): RecordRow | undefined {
	const existing = findRecordById(id);
	if (!existing) return undefined;
	if (existing.status !== 'wanted') return existing;

	const patch: UpdateRecordInput = { status: 'in_collection' };
	if (details?.acquired_at) patch.acquired_at = details.acquired_at;
	if (details?.price_paid != null) patch.price_paid = details.price_paid;
	if (details?.condition_media) patch.condition_media = details.condition_media;
	if (details?.condition_sleeve) patch.condition_sleeve = details.condition_sleeve;
	return updateRecord(id, patch);
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

	// The per-record "track fetch failed" marker (settings KV) orphans on delete.
	db.prepare('DELETE FROM settings WHERE key = ?').run(`track_fetch_failed:${id}`);

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
	return getDb().prepare('SELECT * FROM photos WHERE record_id = ? ORDER BY id ASC').all(recordId) as PhotoRow[];
}

export function addPhoto(recordId: number, filename: string, caption?: string | null): PhotoRow {
	const db = getDb();
	const now = new Date().toISOString();
	const info = db
		.prepare('INSERT INTO photos (record_id, filename, caption, created_at) VALUES (?, ?, ?, ?)')
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
	const info = db.prepare('INSERT INTO plays (record_id, played_at) VALUES (?, ?)').run(recordId, now);
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
	return (getDb().prepare('SELECT COUNT(*) AS c FROM plays WHERE record_id = ?').get(recordId) as { c: number }).c;
}

/** ISO datetime of the most recent play, or null. */
export function latestPlayedAt(recordId: number): string | null {
	const row = getDb().prepare('SELECT MAX(played_at) AS t FROM plays WHERE record_id = ?').get(recordId) as {
		t: string | null;
	};
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
		rows = db.prepare('SELECT record_id, COUNT(*) AS c FROM plays GROUP BY record_id').all() as {
			record_id: number;
			c: number;
		}[];
	}
	return Object.fromEntries(rows.map((r) => [r.record_id, r.c]));
}

/* ------------------------------------------------------------------ */
/* Track durations — minutes played                                    */
/* ------------------------------------------------------------------ */

/** Parse a 'M:SS' or 'MM:SS' duration string to seconds (0 when unparseable). */
export function durationToSeconds(duration: string | null): number {
	if (!duration) return 0;
	const m = /^(\d+):(\d{1,2})$/.exec(duration.trim());
	if (!m) return 0;
	return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Total track duration (seconds) for one record. 0 when no tracks/durations. */
export function trackDurationSeconds(recordId: number): number {
	const rows = getDb().prepare('SELECT duration FROM record_tracks WHERE record_id = ?').all(recordId) as {
		duration: string | null;
	}[];
	return rows.reduce((sum, r) => sum + durationToSeconds(r.duration), 0);
}

/**
 * Total track durations (seconds) for many records in one pass
 * (record_id → seconds). Records with no tracks/durations are absent —
 * callers treat a missing key as 0. Same batch pattern as playCounts().
 */
export function trackDurationsFor(recordIds: number[]): Record<number, number> {
	if (recordIds.length === 0) return {};
	const db = getDb();
	const placeholders = recordIds.map(() => '?').join(',');
	const rows = db
		.prepare(`SELECT record_id, duration FROM record_tracks WHERE record_id IN (${placeholders})`)
		.all(...recordIds) as { record_id: number; duration: string | null }[];
	const out: Record<number, number> = {};
	for (const r of rows) {
		out[r.record_id] = (out[r.record_id] ?? 0) + durationToSeconds(r.duration);
	}
	return out;
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
	const used = new Set(readdirSync(MEDIA_DIR, { withFileTypes: true }).map((e) => e.name));
	let name: string;
	do {
		name = `${recordId}-${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
	} while (used.has(name));
	return name;
}
