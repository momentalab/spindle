/** Shared row types + domain constants (used by server and client). */

export type RecordStatus = 'in_collection' | 'sold' | 'traded_away' | 'wanted';

export const RECORD_STATUSES: RecordStatus[] = ['in_collection', 'sold', 'traded_away', 'wanted'];

export const STATUS_LABELS: Record<RecordStatus, string> = {
	in_collection: 'In collection',
	sold: 'Sold',
	traded_away: 'Traded away',
	wanted: 'Wanted'
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
	/** One entry per style from the record_styles table (hydrated onto the row). */
	styles: string[];
	/** One entry per genre from the record_genres table (hydrated onto the row). */
	genres: string[];
	year: string | null;
	/** One entry per label from the record_labels table (hydrated onto the row). */
	labels: LabelEntry[];
	format: string | null;
	limited_edition: 0 | 1;
	condition_media: string | null;
	condition_sleeve: string | null;
	price_paid: number | null; // integer cents
	acquired_at: string | null; // 'YYYY-MM-DD'
	source: string | null;
	status: RecordStatus;
	wanted_at: string | null; // 'YYYY-MM-DD' — set when the row enters "wanted", cleared on acquire
	copies: number;
	/** Optional copy number for numbered pressings (e.g. 828 of 1000). */
	copy_number: number | null;
	/** Optional total copies (e.g. 1000) — independently settable from copy_number. */
	copy_total: number | null;
	/** F7 pre-stage: realized sale price, integer cents (same convention as price_paid). */
	sale_price: number | null;
	/** F7 pre-stage: 'YYYY-MM-DD' the record was sold. */
	sold_at: string | null;
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

/** A single logged spin of a record (plays table, one row per play). */
export interface PlayRow {
	id: number;
	record_id: number;
	played_at: string; // ISO datetime
}

/** Fields that the Discogs import seeds (before user edits). */
export interface DiscogsSeed {
	discogs_id: number;
	barcode: string | null;
	artist: string;
	title: string;
	styles: string[];
	genres: string[];
	year: string | null;
	labels: LabelEntry[];
	format: string | null;
	limited_edition: 0 | 1;
	cover_url: string | null;
}

/** One candidate release from a Discogs search, as rendered in picker UIs. */
export interface SearchCandidate {
	id: number;
	title: string;
	type?: string;
	resource_url?: string;
	year?: string;
	catno?: string;
	barcode?: string[];
	thumb?: string;
	format?: string[];
	label?: string[];
	genre?: string[];
	style?: string[];
	country?: string;
	community?: { want: number; have: number };
}

/** Editable draft of a record (all-string form state + one boolean), shared by import/manual/edit. */
export interface RecordDraft {
	discogs_id: string;
	barcode: string;
	artist: string;
	title: string;
	/** Comma-separated form state — split into individual styles on save. */
	style: string;
	/** Comma-separated form state — split into individual genres on save. */
	genre: string;
	year: string;
	/** Comma-separated form state, "Name (CATNO)" per label — split on save. */
	label: string;
	format: string;
	limited_edition: boolean;
	condition_media: string;
	condition_sleeve: string;
	price_paid: string;
	acquired_at: string;
	source: string;
	status: RecordStatus;
	/** Form strings for the numbered-pressing pair (both optional, '' = unset). */
	copy_number: string;
	copy_total: string;
	/** F7 pre-stage — sale price as a dollar string (matches price_paid's convention). */
	sale_price: string;
	/** F7 pre-stage — 'YYYY-MM-DD' (from <input type="date">). */
	sold_at: string;
	notes: string;
	/** Hidden input so a Discogs remote cover URL survives the round trip as fallback. */
	cover_url: string;
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
	/** Exact genre value — matches records that carry this genre (one of many). */
	genre?: string;
	label?: string;
	status?: RecordStatus | '';
	/** Rows in this status are omitted — the home Collection shelf hides the wishlist. */
	exclude_status?: RecordStatus;
	sort: SortColumn;
	dir: 'asc' | 'desc';
}

/* ------------------------------------------------------------------ */
/* Genre vocabulary + parsing                                          */
/* ------------------------------------------------------------------ */

/** The top-level genres Discogs offers (discogs.com/genre) — suggested in the
 * record form so a completed value is spelled exactly as Discogs has it. */
export const DISCOGS_GENRES = [
	'Blues',
	'Brass & Military',
	"Children's",
	'Classical',
	'Electronic',
	'Folk, World, & Country',
	'Funk / Soul',
	'Hip-Hop',
	'Jazz',
	'Latin',
	'Non-Music',
	'Pop',
	'Reggae',
	'Rock',
	'Stage & Screen'
] as const;

/**
 * Genres Discogs defines with an embedded comma. The API sends them as single
 * array elements, but the record form carries genres as one comma-separated
 * string — a naive split would shred "Folk, World, & Country" into "Folk",
 * "World", "& Country". `parseGenreList` uses these to keep the genre atomic.
 */
export const DISCOGS_COMMA_GENRES = ['Folk, World, & Country'] as const;

/**
 * fragment ("& country") → full genre name. When a comma-bearing genre's
 * joined form is split on commas, only its `&`-clause survives as a
 * recognizable fragment — the leading pieces ("Folk", "World") look like
 * ordinary standalone genres and are dropped instead.
 */
const COMMA_GENRE_FRAGMENTS: Record<string, string> = Object.fromEntries(
	[...DISCOGS_COMMA_GENRES].flatMap((g) =>
		g.split(',')
			.filter((p) => p.includes('&'))
			.map((p) => [p.trim().toLowerCase(), g])
	)
);

/**
 * Split a comma-separated genre field (form input, legacy column value) into
 * individual genres: trimmed, blanks and case-insensitive duplicates dropped.
 *
 * The `&`-clause fragment of a comma-bearing Discogs genre ("Folk, World, &
 * Country" → "& Country") is merged back into the full genre name, and the
 * bare leading fragments that accompany it are dropped — so "Folk, World, &
 * Country" parses to the single genre ["Folk, World, & Country"], and a
 * record already shredded by an older split heals itself on its next save.
 */
export function parseGenreList(raw: string | null | undefined): string[] {
	if (!raw) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const g = part.trim();
		if (!g) continue;
		const key = g.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(COMMA_GENRE_FRAGMENTS[key] ?? g);
	}
	// A merged comma-bearing genre swallows its own bare leading fragments:
	// "Folk, World, & Country" must not leave stray "Folk" / "World" entries.
	for (const c of DISCOGS_COMMA_GENRES) {
		if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) continue;
		const pieces = new Set(
			c.split(',')
				.filter((p) => !p.includes('&'))
				.map((p) => p.trim().toLowerCase())
		);
		for (let i = out.length - 1; i >= 0; i--) {
			if (pieces.has(out[i].toLowerCase())) out.splice(i, 1);
		}
	}
	return out;
}

/** Render individual genres back into the comma-joined form used by drafts. */
export function joinGenres(genres: readonly string[]): string {
	return genres.join(', ');
}

/* ------------------------------------------------------------------ */
/* Style + label parsing                                               */
/* ------------------------------------------------------------------ */

/** One record label: the clean name plus its catalogue number when known. */
export interface LabelEntry {
	name: string;
	/** Catalogue number ("catno") — e.g. "BS 2744" in "Warner Records (BS 2744)". */
	catno: string | null;
}

/**
 * Split a comma-separated style field (form input, legacy column value) into
 * individual styles: trimmed, blanks and case-insensitive duplicates dropped.
 * Discogs styles are a flat free list — no special-case entries like genres have.
 */
export function parseStyleList(raw: string | null | undefined): string[] {
	if (!raw) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const s = part.trim();
		if (!s) continue;
		const key = s.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
	}
	return out;
}

/**
 * Split a comma-separated label field into individual labels. Each part may
 * carry a parenthesized catalogue number — "Warner Records (BS 2744)" →
 * { name: 'Warner Records', catno: 'BS 2744' }. The first paren chunk becomes
 * the catno; further chunks (barcode noise) are dropped. Blanks and
 * case-insensitive name duplicates are dropped.
 */
export function parseLabelList(raw: string | null | undefined): LabelEntry[] {
	if (!raw) return [];
	const seen = new Set<string>();
	const out: LabelEntry[] = [];
	for (const part of raw.split(',')) {
		let name = '';
		let catno: string | null = null;
		for (const seg of part.split(/(\([^()]*\))/g)) {
			const m = /^\(([^()]*)\)$/.exec(seg);
			if (m) {
				const chunk = m[1].trim();
				if (chunk && catno === null) catno = chunk; // first paren chunk only
			} else {
				name += seg;
			}
		}
		const n = name.trim();
		if (!n) continue;
		const key = n.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ name: n, catno });
	}
	return out;
}

/** Render individual styles back into the comma-joined form used by drafts. */
export function joinStyles(styles: readonly string[]): string {
	return styles.join(', ');
}

/** Render labels back into the "Name (CATNO)" comma-joined form used by drafts. */
export function joinLabels(labels: readonly LabelEntry[]): string {
	return labels.map((l) => (l.catno ? `${l.name} (${l.catno})` : l.name)).join(', ');
}
