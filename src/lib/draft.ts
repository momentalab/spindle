/** Pure draft-state helpers (client + server). */
import type { DiscogsSeed, RecordDraft, RecordRow } from '$lib/types';
import { joinGenres, joinLabels, joinStyles } from '$lib/types';

/**
 * Date-only 'YYYY-MM-DD' for <input type="date">. Accepts date-only values or
 * legacy full ISO timestamps (truncates) so any pre-standardization rows in the
 * DB render correctly and heal to date-only on the next save.
 */
export function dateOnly(v: string | null): string {
	if (!v) return '';
	const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
	return m ? m[1] : '';
}

export function emptyDraft(): RecordDraft {
	return {
		discogs_id: '',
		barcode: '',
		artist: '',
		title: '',
		style: '',
		genre: '',
		year: '',
		label: '',
		format: '',
		limited_edition: false,
		condition_media: '',
		condition_sleeve: '',
		price_paid: '',
		acquired_at: new Date().toISOString().slice(0, 10),
		source: 'manual',
		status: 'in_collection',
		copy_number: '',
		copy_total: '',
		sale_price: '',
		sold_at: '',
		notes: '',
		cover_url: ''
	};
}

/** Seed a draft from a Discogs search-result / release expansion. */
export function draftFromSeed(seed: DiscogsSeed): RecordDraft {
	const d = emptyDraft();
	return {
		...d,
		discogs_id: String(seed.discogs_id),
		barcode: seed.barcode ?? '',
		artist: seed.artist,
		title: seed.title,
		style: joinStyles(seed.styles ?? []),
		genre: joinGenres(seed.genres ?? []),
		year: seed.year ?? '',
		label: joinLabels(seed.labels ?? []),
		format: seed.format ?? '',
		limited_edition: seed.limited_edition === 1,
		// Source stays blank — the seed tells us where the *details* came from,
		// not where the user got the record. The form's Discogs note keys off
		// discogs_id, not this field.
		source: '',
		cover_url: seed.cover_url ?? ''
	};
}

/** Seed a draft from an existing local record (edit flow). */
export function draftFromRow(row: RecordRow): RecordDraft {
	const cents = row.price_paid;
	return {
		discogs_id: row.discogs_id ? String(row.discogs_id) : '',
		barcode: row.barcode ?? '',
		artist: row.artist,
		title: row.title,
		style: joinStyles(row.styles),
		genre: joinGenres(row.genres),
		year: row.year ?? '',
		label: joinLabels(row.labels),
		format: row.format ?? '',
		limited_edition: row.limited_edition === 1,
		condition_media: row.condition_media ?? '',
		condition_sleeve: row.condition_sleeve ?? '',
		price_paid: cents !== null ? (cents / 100).toFixed(2) : '',
		acquired_at: dateOnly(row.acquired_at),
		source: row.source ?? '',
		status: row.status,
		copy_number: row.copy_number !== null ? String(row.copy_number) : '',
		copy_total: row.copy_total !== null ? String(row.copy_total) : '',
		sale_price: row.sale_price !== null ? (row.sale_price / 100).toFixed(2) : '',
		sold_at: dateOnly(row.sold_at),
		notes: row.notes ?? '',
		cover_url: row.cover_remote_url ?? ''
	};
}
