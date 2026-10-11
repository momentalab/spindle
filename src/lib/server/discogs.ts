/**
 * Discogs API v2 client (server-only).
 *
 * Auth model (verified against live API 2026-08-26, see plans/spindle-plan.md §4.2):
 * - Search (/database/search), release lookup, and image download all work
 *   UNauthenticated (25 req/min tier).
 * - With consumer key/secret ("Discogs Auth" — Authorization: Discogs key=…, secret=…):
 *   60 req/min tier + guaranteed image URLs. No OAuth dance needed for this app
 *   because we never call user-scoped endpoints (collection lives in local SQLite).
 * - Credentials come from .env (DISCOGS_CONSUMER_KEY / DISCOGS_CONSUMER_SECRET).
 *   When absent, the client degrades gracefully to unauthenticated requests and
 *   the UI falls back to manual entry. Local data is always fully usable.
 */
import { env } from '$env/dynamic/private';
import type {
	DiscogsSeed,
	LabelEntry,
	ReleaseCredit,
	ReleaseSnapshot,
	ReleaseVideo,
	SearchCandidate
} from '$lib/types';

const API_BASE = 'https://api.discogs.com';
const USER_AGENT = 'spindle/0.1 (local vinyl collection tracker)';

export class DiscogsError extends Error {
	readonly status: number | null;
	constructor(message: string, status: number | null) {
		super(message);
		this.name = 'DiscogsError';
		this.status = status;
	}
}

/** Minimal local throttle keyed off the observed rate-limit window. */
const throttle = { remaining: 60, resetAt: 0 };

async function waitIfThrottled(): Promise<void> {
	const now = Date.now();
	if (throttle.remaining <= 0 && now < throttle.resetAt) {
		await new Promise((r) => setTimeout(r, throttle.resetAt - now));
	}
}

function recordRateHeaders(headers: Headers): void {
	const remaining = headers.get('x-discogs-ratelimit-remaining');
	if (remaining !== null) {
		throttle.remaining = Number(remaining);
		throttle.resetAt = Date.now() + 60_000;
	}
}

/**
 * Remaining requests in the observed rate-limit window. Batch callers
 * (the /value market snapshot) use this to stop *before* the wall instead
 * of eating a 429 — e.g. loop while `throttleRemaining() > 1`.
 */
export function throttleRemaining(): number {
	return throttle.remaining;
}

async function discogsFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
	await waitIfThrottled();
	const url = new URL(`${API_BASE}${path}`);
	if (params) for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

	const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
	const key = env.DISCOGS_CONSUMER_KEY;
	const secret = env.DISCOGS_CONSUMER_SECRET;
	if (key && secret) headers.Authorization = `Discogs key=${key}, secret=${secret}`;

	let res: Response;
	try {
		res = await fetch(url, { headers });
	} catch {
		throw new DiscogsError(
			'Could not reach Discogs. If you are offline that is fine — your local records remain fully browsable.',
			null
		);
	}
	recordRateHeaders(res.headers);

	if (!res.ok) {
		let detail = '';
		try {
			const j = (await res.json()) as { message?: string };
			detail = j.message ?? '';
		} catch {
			/* non-JSON body */
		}
		if (res.status === 403)
			throw new DiscogsError(
				`Discogs rejected this request${detail ? `: ${detail}` : ' (invalid or revoked credentials?).'}`,
				403
			);
		if (res.status === 429) throw new DiscogsError('Discogs rate limit hit — wait a minute and try again.', 429);
		if (res.status === 404) throw new DiscogsError(detail || 'Not found on Discogs.', 404);
		throw new DiscogsError(`Discogs error ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
	}
	return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Response shapes (only the fields we consume)                        */
/* ------------------------------------------------------------------ */

interface RawArtist {
	name: string;
	anv?: string;
	join?: string;
}
interface RawLabel {
	name: string;
	catno?: string;
	entity_type?: string; // "1" = record label
}
interface RawFormat {
	name: string;
	descriptions?: string[];
	qty?: string;
}
interface RawImage {
	type?: string;
	uri: string;
	uri150?: string;
	resource_url?: string;
}
interface RawIdentifier {
	type: string;
	value: string;
}
export interface RawRelease {
	id: number;
	title: string;
	artists?: RawArtist[];
	artists_sort?: string;
	labels?: RawLabel[];
	genres?: string[];
	styles?: string[];
	year?: number | string;
	released?: string;
	released_formatted?: string;
	formats?: RawFormat[];
	identifiers?: RawIdentifier[];
	images?: RawImage[];
	thumb?: string;
	uri?: string;
	country?: string;
	series?: string[];
	notes?: string;
	community?: {
		want?: number | null;
		have?: number | null;
		rating?: { average?: number | null; count?: number | null } | null;
	};
	companies?: { name?: string; entity_type_name?: string }[];
	extraartists?: { name?: string; anv?: string; role?: string }[];
	videos?: {
		title?: string;
		duration?: number | null;
		uri?: string;
		embed?: boolean;
	}[];
	tracklist?: {
		position?: string;
		title?: string;
		duration?: string;
		type_?: string;
	}[];
}

/** One Discogs search result — shared with the client pickers (see SearchCandidate). */
export type SearchResultItem = SearchCandidate;
interface SearchResponse {
	pagination?: { items?: number; page?: number; pages?: number };
	results?: SearchResultItem[];
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

export function normalizeBarcode(value: string): string {
	// Discogs stores barcodes with space/hyphen grouping; strip non-digits for matching.
	return value.replace(/\D+/g, '');
}

/** Map a raw release object to the fields we seed into our local record. */
export function toSeed(release: RawRelease): DiscogsSeed {
	const artists = (release.artists ?? []).map((a) => (a.anv ? `${a.name} (${a.anv})` : a.name)).join(', ');

	// Record labels are entity_type "1"; prefer those, fall back to any label.
	// Keep name + catno as structured entries (one record_labels row each);
	// case-insensitive dedupe by name so co-pressings collapse to one entry.
	const recordLabels = (release.labels ?? []).filter((l) => l.entity_type === '1');
	const rawLabels = recordLabels.length > 0 ? recordLabels : (release.labels ?? []);
	const labels: LabelEntry[] = [];
	{
		const seen = new Set<string>();
		for (const l of rawLabels) {
			const name = (l.name ?? '').trim();
			if (!name) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			labels.push({ name, catno: (l.catno ?? '').trim() || null });
		}
	}

	const format =
		(release.formats ?? [])
			.map((f) => [f.name, ...(f.descriptions ?? [])].filter(Boolean).join(', '))
			.filter(Boolean)
			.join('; ') || null;

	// Limited pressings are flagged in the format descriptions by Discogs.
	const limited_edition: 0 | 1 = (release.formats ?? []).some((f) =>
		(f.descriptions ?? []).some((d) => /limited/i.test(d))
	)
		? 1
		: 0;

	const barcodeRaw = (release.identifiers ?? [])
		.filter((i) => i.type === 'Barcode')
		.map((i) => normalizeBarcode(i.value))
		.find(Boolean);

	const year = String(release.year ?? release.released_formatted ?? release.released ?? '').trim() || null;

	const primaryImage = (release.images ?? []).find((i) => i.type === 'primary');
	const fallbackImage = (release.images ?? [])[0];
	const cover_url = (primaryImage?.uri ?? fallbackImage?.uri ?? release.thumb ?? '').trim() || null;

	return {
		discogs_id: release.id,
		barcode: barcodeRaw ?? null,
		artist: release.artists_sort || artists || 'Unknown artist',
		title: release.title,
		styles: (release.styles ?? []).map((s) => s.trim()).filter(Boolean),
		genres: (release.genres ?? []).map((g) => g.trim()).filter(Boolean),
		year,
		labels,
		format,
		limited_edition,
		cover_url
	};
}

/**
 * Map a raw release object to the cached detail snapshot stored per record
 * (release_snapshots table). Pure function of the parsed payload — same
 * normalization discipline as toSeed: trim, drop empties, round ratings to 2 dp.
 */
export function toSnapshot(release: RawRelease, discogsId?: number): ReleaseSnapshot {
	const clean = (v: string | null | undefined): string | null => {
		const t = (v ?? '').trim();
		return t ? t : null;
	};

	const avg = release.community?.rating?.average;
	const count = release.community?.rating?.count;

	// Companies first, extra-artists after — companies' role is their entity
	// type ("Mastered At"), artists carry an explicit role; both fall back to ''.
	// Discogs duplicates whole entries in these lists too (same disease as
	// videos); drop repeats (first wins) or the detail page's keyed each crashes.
	const credits: ReleaseCredit[] = [];
	const seenCreditKeys = new Set<string>();
	for (const c of release.companies ?? []) {
		const name = clean(c.name);
		if (!name) continue;
		const role = clean(c.entity_type_name) ?? '';
		const key = `${name}\u0000${role}\u0000company`;
		if (seenCreditKeys.has(key)) continue;
		seenCreditKeys.add(key);
		credits.push({ name, role, kind: 'company' });
	}
	for (const a of release.extraartists ?? []) {
		const name = clean(a.anv ? `${a.name} (${a.anv})` : a.name);
		if (!name) continue;
		const role = clean(a.role) ?? '';
		const key = `${name}\u0000${role}\u0000artist`;
		if (seenCreditKeys.has(key)) continue;
		seenCreditKeys.add(key);
		credits.push({ name, role, kind: 'artist' });
	}

	// Discogs returns some releases' video lists with whole entries duplicated;
	// drop repeat URIs (first occurrence wins) so snapshots stay clean.
	const videos: ReleaseVideo[] = [];
	const seenVideoUris = new Set<string>();
	for (const v of release.videos ?? []) {
		if (!v.uri || !v.title?.trim()) continue;
		if (seenVideoUris.has(v.uri)) continue;
		seenVideoUris.add(v.uri);
		videos.push({
			title: v.title.trim(),
			duration: typeof v.duration === 'number' && Number.isFinite(v.duration) ? v.duration : null,
			url: v.uri
		});
	}

	return {
		discogs_id: discogsId ?? release.id,
		country: clean(release.country),
		series: (release.series ?? []).map((s) => s.trim()).filter(Boolean),
		notes: clean(release.notes),
		released_formatted: clean(release.released_formatted),
		community: {
			want: typeof release.community?.want === 'number' ? release.community!.want! : null,
			have: typeof release.community?.have === 'number' ? release.community!.have! : null,
			rating_avg: typeof avg === 'number' && Number.isFinite(avg) ? Math.round(avg * 100) / 100 : null,
			rating_count: typeof count === 'number' ? count : null
		},
		credits,
		videos,
		fetched_at: new Date().toISOString()
	};
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface SearchParams {
	barcode?: string;
	q?: string;
	artist?: string;
	title?: string; // release_title in Discogs terms
	genre?: string;
	label?: string;
	catno?: string;
	year?: string;
	perPage?: number;
	page?: number;
}

/** Search releases. Barcode lookups go through the `barcode` param (verified). */
export async function searchReleases(params: SearchParams): Promise<{ results: SearchResultItem[]; total: number }> {
	const query: Record<string, string> = { type: 'release' };
	if (params.barcode) query.barcode = params.barcode;
	if (params.q) query.q = params.q;
	if (params.artist) query.artist = params.artist;
	if (params.title) query.release_title = params.title;
	if (params.genre) query.genre = params.genre;
	if (params.label) query.label = params.label;
	if (params.catno) query.catno = params.catno;
	if (params.year) query.year = params.year;
	query.per_page = String(params.perPage ?? 25);
	query.page = String(params.page ?? 1);

	const res = await discogsFetch<SearchResponse>('/database/search', query);
	return { results: res.results ?? [], total: res.pagination?.items ?? 0 };
}

/** Fetch one release by its Discogs ID. */
export async function getRelease(id: number): Promise<RawRelease> {
	return discogsFetch<RawRelease>(`/releases/${id}`);
}

/**
 * Download a cover image (a fully-qualified api-img.discogs.com URL from a
 * release object). Returns raw bytes + content type. Works authenticated and
 * (empirically) unauthenticated.
 */
export async function downloadImage(imageUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
	let res: Response;
	try {
		res = await fetch(imageUrl, { headers: { 'User-Agent': USER_AGENT } });
	} catch {
		throw new DiscogsError('Could not download the cover image from Discogs.', null);
	}
	if (!res.ok) {
		throw new DiscogsError(`Cover image download failed (HTTP ${res.status}).`, res.status);
	}
	const bytes = Buffer.from(await res.arrayBuffer());
	const contentType = res.headers.get('content-type') ?? 'image/jpeg';
	return { bytes, contentType };
}

/**
 * Live marketplace quote for one release: the lowest current listing (USD)
 * and how many copies are for sale. Powers the /value page's cost-vs-market
 * comparison and its price-history log.
 *
 * Endpoint: GET /marketplace/stats/{release_id}?curr_abbr=USD — per the API
 * docs (see references/discogs-api-docs-2026-08-21.md) this works UNAUTHENTICATED
 * (prices come back in USD), so it needs no more auth than the rest of the app.
 * `price_cents` is null when nothing is for sale or the release is blocked —
 * that is data ("no live listings"), not an error; the caller stores it as such.
 */
export interface MarketStats {
	/** Lowest current listing in USD, cents; null = no live listings. */
	price_cents: number | null;
	/** Copies currently for sale; null alongside a null price. */
	num_for_sale: number | null;
	/** True when the release is blocked from marketplace sale entirely. */
	blocked: boolean;
}

interface RawMarketStats {
	lowest_price?: { currency?: string; value?: number } | null;
	num_for_sale?: number | null;
	blocked_from_sale?: boolean;
}

export async function getMarketStats(releaseId: number): Promise<MarketStats> {
	const raw = await discogsFetch<RawMarketStats>(`/marketplace/stats/${releaseId}`, {
		curr_abbr: 'USD'
	});
	const value = raw.lowest_price?.value;
	return {
		price_cents: typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null,
		num_for_sale: typeof raw.num_for_sale === 'number' ? raw.num_for_sale : null,
		blocked: raw.blocked_from_sale === true
	};
}

/** True when consumer credentials are configured in .env. */
export function isConfigured(): boolean {
	return Boolean(env.DISCOGS_CONSUMER_KEY && env.DISCOGS_CONSUMER_SECRET);
}
