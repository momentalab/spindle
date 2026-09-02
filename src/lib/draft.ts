/** Pure draft-state helpers (client + server). */
import type { DiscogsSeed, RecordDraft, RecordRow } from '$lib/types';
import { joinGenres } from '$lib/types';

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
		style: seed.style ?? '',
		genre: joinGenres(seed.genres ?? []),
		year: seed.year ?? '',
		label: seed.label ?? '',
		format: seed.format ?? '',
		limited_edition: seed.limited_edition === 1,
		source: 'discogs',
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
		style: row.style ?? '',
		genre: joinGenres(row.genres),
		year: row.year ?? '',
		label: row.label ?? '',
		format: row.format ?? '',
		limited_edition: row.limited_edition === 1,
		condition_media: row.condition_media ?? '',
		condition_sleeve: row.condition_sleeve ?? '',
		price_paid: cents !== null ? (cents / 100).toFixed(2) : '',
		acquired_at: row.acquired_at ?? '',
		source: row.source ?? '',
		status: row.status,
		notes: row.notes ?? '',
		cover_url: row.cover_remote_url ?? ''
	};
}
