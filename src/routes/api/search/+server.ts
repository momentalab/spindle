/**
 * Name-based search API for the collection home's search bar.
 *
 * GET /api/search?q=artist+title
 *   -> { q, candidates: SearchResultItem[], total }
 *      (Discogs release search; local results are computed client-side)
 *
 * POST /api/search  { id, status? }
 *   -> saves that Discogs release to the local collection (cover download
 *      included) and returns { recordId }. `status` is 'in_collection'
 *      (default — "+ Add") or 'wanted' (the wishlist heart). When the release
 *      is already saved (same Discogs ID or barcode) no second row is created
 *      — the response carries { recordId: null, duplicate: { id, artist,
 *      title } } instead so the UI can point at the existing record.
 */
import { error, json } from '@sveltejs/kit';
import { DiscogsError, getRelease, searchReleases, toSeed } from '$lib/server/discogs';
import { findByBarcode, findByDiscogsId, type NewRecordInput } from '$lib/server/records';
import { importRecord } from '$lib/server/importer';
import type { RecordStatus } from '$lib/types';

export async function GET({ url }): Promise<Response> {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q) throw new DiscogsError('Provide ?q=.', 400);
	try {
		const { results, total } = await searchReleases({ q, perPage: 25 });
		return json({ q, candidates: results, total });
	} catch (e) {
		if (e instanceof DiscogsError) error(502, e.message);
		throw e;
	}
}

export async function POST({ request }): Promise<Response> {
	let body: { id?: unknown; status?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Expected a JSON body with an "id".');
	}
	const id = Number.parseInt(String(body.id ?? ''), 10);
	if (!Number.isFinite(id) || id <= 0) error(400, 'Bad release id');
	// Only the two save-targets from the search bar are accepted — everything
	// else (sold/traded_away) is a status transition, not an import.
	const status: RecordStatus = body.status === 'wanted' ? 'wanted' : 'in_collection';

	let seed;
	try {
		seed = toSeed(await getRelease(id));
	} catch (e) {
		if (e instanceof DiscogsError) error(502, e.message);
		throw e;
	}

	// Dedupe at write time: the same release (or same barcode) already saved
	// gets no second row — mirror of the import flow's create-anyway guard.
	// status rides along so the flash can say WHERE it already lives.
	const existing = seed.discogs_id ? findByDiscogsId(seed.discogs_id) : undefined;
	const byBarcode = seed.barcode ? findByBarcode(seed.barcode) : undefined;
	const duplicate = existing ?? byBarcode;
	if (duplicate) {
		return json({
			recordId: null,
			duplicate: {
				id: duplicate.id,
				artist: duplicate.artist,
				title: duplicate.title,
				status: duplicate.status
			}
		});
	}

	const input: NewRecordInput = {
		discogs_id: seed.discogs_id,
		barcode: seed.barcode,
		artist: seed.artist,
		title: seed.title,
		styles: seed.styles,
		genres: seed.genres,
		year: seed.year,
		labels: seed.labels,
		format: seed.format,
		limited_edition: Boolean(seed.limited_edition),
		condition_media: null,
		condition_sleeve: null,
		price_paid: null,
		acquired_at: new Date().toISOString().slice(0, 10),
		// Blank source — quick-add knows the details came from Discogs, not
		// where the user got the record. Reads as 'Unrecorded' in /stats.
		source: null,
		status,
		// wanted rows get wanted_at stamped + acquired_at nulled by createRecord's invariants.
		wanted_at: null,
		copies: 1,
		copy_number: null,
		copy_total: null,
		sale_price: null,
		sold_at: null,
		notes: null,
		cover_filename: null,
		cover_remote_url: seed.cover_url
	};

	const { recordId } = await importRecord(input);
	return json({ recordId });
}
