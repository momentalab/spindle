/**
 * Collection export (server-only): dump the local database to plain-text
 * formats so the user's data can always be taken out of the app.
 *
 * Formats:
 *  - CSV   strictly RFC 4180 — a header row plus one row per line, nothing
 *          else — so Excel/pandas/LibreOffice parse it cleanly. Price rendered
 *          in dollars; UTF-8 with BOM so Excel opens accented artists.
 *  - JSON  full fidelity — every field, raw values (price in cents, flags as
 *          integers) — for round-trips and tooling.
 *
 * Tables: both exports cover `records`, `photos`, `plays` and `tracks`; pass
 * table= to limit to one (CSV defaults to records).
 */
import { getDb } from '$lib/server/db';
import { withGenres } from '$lib/server/records';
import type { PlayRow, PhotoRow, RecordRow, TrackRow } from '$lib/types';
import { joinLabels, joinStyles } from '$lib/types';

export type ExportFormat = 'csv' | 'json';
export const EXPORT_FORMATS: ExportFormat[] = ['csv', 'json'];

export type ExportTable = 'records' | 'photos' | 'plays' | 'tracks';
export const EXPORT_TABLES: ExportTable[] = ['records', 'photos', 'plays', 'tracks'];

/** Column order for the CSV (and the key order for the JSON records array). */
export const RECORD_COLUMNS: (keyof RecordRow)[] = [
	'id',
	'discogs_id',
	'barcode',
	'artist',
	'title',
	'styles',
	'genres',
	'year',
	'labels',
	'format',
	'limited_edition',
	'copy_number',
	'copy_total',
	'condition_media',
	'condition_sleeve',
	'price_paid',
	'sale_price',
	'acquired_at',
	'sold_at',
	'source',
	'status',
	'copies',
	'notes',
	'cover_filename',
	'cover_remote_url',
	'wanted_at',
	'created_at',
	'updated_at'
];

/** Human-friendly CSV headers. */
const CSV_HEADERS: Record<string, string> = {
	price_paid: 'price_paid_usd',
	sale_price: 'sale_price_usd',
	limited_edition: 'limited_edition (yes/no)',
	cover_filename: 'cover_url',
	created_at: 'added_at',
	updated_at: 'updated_at'
};

const PHOTO_COLUMNS: (keyof PhotoRow)[] = [
	'id',
	'record_id',
	'filename',
	'caption',
	'created_at'
];

const PLAY_COLUMNS: (keyof PlayRow)[] = ['id', 'record_id', 'played_at'];

const TRACK_COLUMNS: (keyof TrackRow)[] = [
	'id',
	'record_id',
	'position',
	'title',
	'duration',
	'favorite'
];

/** RFC 4180 field quoting: quote when the value holds a comma, quote, or newline. */
function csvField(value: unknown): string {
	if (value === null || value === undefined) return '';
	const s = String(value);
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

/** Render one record for CSV: price in dollars, flag as yes/no, cover → URL. */
function recordToCsvRow(rec: RecordRow): string {
	const cells = RECORD_COLUMNS.map((col) => {
		switch (col) {
			case 'styles':
				// Individual styles rendered back into the familiar comma-joined form.
				return csvField(joinStyles(rec.styles));
			case 'genres':
				// Individual genres rendered back into the familiar comma-joined form.
				return csvField(rec.genres.join(', '));
			case 'labels':
				// One "Name (CATNO)" per label, comma-joined.
				return csvField(joinLabels(rec.labels));
			case 'price_paid':
				return rec.price_paid === null ? '' : String((rec.price_paid / 100).toFixed(2));
			case 'sale_price':
				return rec.sale_price === null ? '' : String((rec.sale_price / 100).toFixed(2));
			case 'limited_edition':
				return rec.limited_edition ? 'yes' : 'no';
			case 'cover_filename':
				return rec.cover_filename ? `/media/${rec.cover_filename}` : (rec.cover_remote_url ?? '');
			default:
				return csvField(rec[col]);
		}
	});
	return cells.join(',');
}

/**
 * Strict CSV dump: header row + data rows only (RFC 4180, CRLF line endings).
 * `table` selects the dataset — "records" (default), "photos" or "plays".
 */
export function exportAsCsv(table: ExportTable = 'records'): string {
	const db = getDb();
	const lines: string[] = [];

	if (table === 'records') {
		const records = (
			db.prepare('SELECT * FROM records ORDER BY artist ASC, title ASC').all() as Omit<RecordRow, 'genres'>[]
		).map(withGenres);
		lines.push(RECORD_COLUMNS.map((c) => csvField(CSV_HEADERS[c] ?? c)).join(','));
		for (const rec of records) lines.push(recordToCsvRow(rec));
	} else if (table === 'photos') {
		const photos = db
			.prepare('SELECT * FROM photos ORDER BY record_id ASC, id ASC')
			.all() as PhotoRow[];
		lines.push(PHOTO_COLUMNS.join(','));
		for (const p of photos) lines.push(PHOTO_COLUMNS.map((c) => csvField(p[c])).join(','));
	} else if (table === 'plays') {
		const plays = db
			.prepare('SELECT * FROM plays ORDER BY record_id ASC, id ASC')
			.all() as PlayRow[];
		lines.push(PLAY_COLUMNS.join(','));
		for (const p of plays) lines.push(PLAY_COLUMNS.map((c) => csvField(p[c])).join(','));
	} else {
		const tracks = db
			.prepare('SELECT * FROM record_tracks ORDER BY record_id ASC, id ASC')
			.all() as TrackRow[];
		lines.push(
			TRACK_COLUMNS.map((c) => (c === 'favorite' ? 'favorite (yes/no)' : c)).join(',')
		);
		for (const t of tracks)
			lines.push(
				TRACK_COLUMNS.map((c) =>
					c === 'favorite' ? csvField(t.favorite === 1 ? 'yes' : 'no') : csvField(t[c])
				).join(',')
			);
	}

	return lines.join('\r\n') + '\r\n';
}

/**
 * Full JSON dump. `table` defaults to "all" (records + photos + plays + tracks
 * + summary counts); pass a table name to limit the export to that dataset.
 */
export function exportAsJson(table: 'all' | ExportTable = 'all'): string {
	const db = getDb();
	const records =
		table === 'photos' || table === 'plays' || table === 'tracks'
			? []
			: (db.prepare('SELECT * FROM records ORDER BY artist ASC, title ASC').all() as Omit<RecordRow, 'genres'>[]).map(
					withGenres
				);
	const photos =
		table === 'records' || table === 'plays' || table === 'tracks'
			? []
			: (db.prepare('SELECT * FROM photos ORDER BY record_id ASC, id ASC').all() as PhotoRow[]);
	const plays =
		table === 'records' || table === 'photos' || table === 'tracks'
			? []
			: (db.prepare('SELECT * FROM plays ORDER BY record_id ASC, id ASC').all() as PlayRow[]);
	const tracks =
		table === 'records' || table === 'photos' || table === 'plays'
			? []
			: (db.prepare('SELECT * FROM record_tracks ORDER BY record_id ASC, id ASC').all() as TrackRow[]);
	return JSON.stringify(
		{
			app: 'mynyl',
			exported_at: new Date().toISOString(),
			schema_version: 1,
			record_count: records.length,
			photo_count: photos.length,
			play_count: plays.length,
			track_count: tracks.length,
			records,
			photos,
			plays,
			tracks
		},
		null,
		'\t'
	);
}

/** Dispatch to a format. Throws on unknown format (route maps that to 400). */
export function renderExport(
	format: ExportFormat,
	opts: { bom?: boolean; table?: 'all' | ExportTable } = {}
): string {
	let body: string;
	switch (format) {
		case 'csv':
			// CSV is single-table: "all" (JSON default) falls back to records.
			body = exportAsCsv(opts.table && opts.table !== 'all' ? opts.table : 'records');
			break;
		case 'json':
			body = exportAsJson(opts.table ?? 'all') + '\n';
			break;
		default:
			throw new Error(`Unknown export format: ${String(format)}`);
	}
	return opts.bom ? `\uFEFF${body}` : body;
}
