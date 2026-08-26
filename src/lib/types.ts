/** Shared row types + domain constants (used by server and client). */

export type RecordStatus = 'in_collection' | 'sold' | 'traded_away';

export const RECORD_STATUSES: RecordStatus[] = ['in_collection', 'sold', 'traded_away'];

export const STATUS_LABELS: Record<RecordStatus, string> = {
	in_collection: 'In collection',
	sold: 'Sold',
	traded_away: 'Traded away'
};

/** Goldmine condition scale (media + sleeve). */
export const CONDITIONS = ['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface RecordRow {
	id: number;
	discogs_id: number | null;
	barcode: string | null;
	artist: string;
	title: string;
	style: string | null;
	genre: string | null;
	year: string | null;
	label: string | null;
	format: string | null;
	limited_edition: 0 | 1;
	condition_media: string | null;
	condition_sleeve: string | null;
	price_paid: number | null; // integer cents
	acquired_at: string | null; // ISO date
	source: string | null;
	status: RecordStatus;
	copies: number;
	notes: string | null;
	cover_filename: string | null;
	cover_remote_url: string | null;
	created_at: string;
	updated_at: string;
}

export interface PhotoRow {
	id: number;
	record_id: number;
	filename: string;
	caption: string | null;
	created_at: string;
}

/** Fields that the Discogs import seeds (before user edits). */
export interface DiscogsSeed {
	discogs_id: number;
	barcode: string | null;
	artist: string;
	title: string;
	style: string | null;
	genre: string | null;
	year: string | null;
	label: string | null;
	format: string | null;
	limited_edition: 0 | 1;
	cover_url: string | null;
}

export type SortColumn =
	| 'artist'
	| 'title'
	| 'year'
	| 'genre'
	| 'label'
	| 'acquired_at'
	| 'updated_at';

export interface ListOptions {
	search?: string;
	genre?: string;
	label?: string;
	status?: RecordStatus | '';
	sort: SortColumn;
	dir: 'asc' | 'desc';
}
