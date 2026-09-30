/**
 * Collection home: server-side list with search / sort / filter, plus the
 * Collection | Wishlist shelf split (the wishlist is `status = 'wanted'`).
 */
import { fail } from '@sveltejs/kit';
import {
	acquireRecord,
	countRecords,
	distinctValues,
	findRecordById,
	listRecords,
	playCounts
} from '$lib/server/records';
import { favoriteCounts } from '$lib/server/tracks';
import type { ListOptions, RecordStatus } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

const SORT_COLUMNS = new Set([
	'artist',
	'title',
	'year',
	'genre',
	'label',
	'favorite_tracks',
	'acquired_at',
	'updated_at'
]);

export const load: PageServerLoad = async ({ url }) => {
	const search = url.searchParams.get('q') ?? '';
	const genre = url.searchParams.get('genre') ?? '';
	const label = url.searchParams.get('label') ?? '';
	const statusParam = url.searchParams.get('status') ?? '';
	// local=1 — hide the Discogs section of the search results entirely.
	const localOnly = url.searchParams.get('local') === '1';
	const sort = (url.searchParams.get('sort') ?? 'artist') as ListOptions['sort'];
	// Starred sort reads most-starred first by default; an explicit ?dir= wins.
	const dirParam = url.searchParams.get('dir') ?? (sort === 'favorite_tracks' ? 'desc' : 'asc');

	// Shelf split: the wishlist is its own tab (?tab=wishlist); the legacy
	// ?status=wanted deep link keeps working as an alias. On the collection
	// shelf, wanted rows are excluded entirely — each record lives on one shelf.
	const shelf: 'collection' | 'wishlist' =
		url.searchParams.get('tab') === 'wishlist' || statusParam === 'wanted' ? 'wishlist' : 'collection';
	const statusFilter: RecordStatus | '' = shelf === 'wishlist' ? '' : (statusParam as RecordStatus) || '';

	const opts: ListOptions = {
		search,
		genre: genre || undefined,
		label: label || undefined,
		status: shelf === 'wishlist' ? 'wanted' : statusFilter,
		exclude_status: shelf === 'collection' ? 'wanted' : undefined,
		favorite_only: url.searchParams.get('fav') === '1',
		sort: SORT_COLUMNS.has(sort) ? sort : 'artist',
		dir: dirParam === 'desc' ? 'desc' : 'asc'
	};

	const records = listRecords(opts);
	return {
		records,
		shelf,
		local_only: localOnly,
		total: countRecords(),
		// The header's quiet "N still wanted" pointer links across shelves.
		wanted_total: countRecords('wanted'),
		play_counts: playCounts(records.map((r) => r.id)),
		track_counts: favoriteCounts(records.map((r) => r.id)),
		filters: {
			genres: distinctValues('genre'),
			labels: distinctValues('label'),
			active: opts
		}
	};
};

export const actions: Actions = {
	/**
	 * Acquire from the home page (the "→ acquired" chip's modal). Returns a
	 * plain success — no redirect — so the dialog closes in place and the page
	 * revalidates; the record detail page keeps its own redirecting action.
	 */
	acquire: async ({ request }) => {
		const data = await request.formData();
		const id = Number.parseInt(String(data.get('record_id') ?? ''), 10);
		if (!Number.isFinite(id) || id <= 0) return fail(400, { error: 'Missing record.' });
		const rec = findRecordById(id);
		if (!rec) return fail(404, { error: 'Record not found.' });
		if (rec.status !== 'wanted') return fail(400, { error: 'Only wanted records can be acquired.' });

		// The acquire dialog may carry purchase details (all optional), parsed
		// exactly like the detail page's action: acquired_at (YYYY-MM-DD),
		// price_paid (dollars → cents), both conditions.
		const dateRaw = String(data.get('acquired_at') ?? '');
		const priceRaw = String(data.get('price_paid') ?? '').trim();
		const priceCents =
			priceRaw && Number.isFinite(parseFloat(priceRaw)) ? Math.round(parseFloat(priceRaw) * 100) : null;
		acquireRecord(id, {
			acquired_at: /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null,
			price_paid: priceCents,
			condition_media: String(data.get('condition_media') ?? '') || null,
			condition_sleeve: String(data.get('condition_sleeve') ?? '') || null
		});
		return { acquired: true };
	}
};
