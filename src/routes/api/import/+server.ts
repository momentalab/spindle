/**
 * Import API (no saving happens here — previews only).
 *
 * GET /api/import?barcode=0123456789012
 *   -> { mode: "barcode", barcode, candidates: SearchResultItem[], total }
 *
 * GET /api/import/release?id=6778478
 *   -> { seed: DiscogsSeed }
 */
import { error } from '@sveltejs/kit';
import { DiscogsError, getRelease, searchReleases, toSeed } from '$lib/server/discogs';

export async function GET({ url }: { url: URL }): Promise<Response> {
	const barcode = url.searchParams.get('barcode');
	const releaseId = url.searchParams.get('id');

	try {
		if (releaseId) {
			const id = Number.parseInt(releaseId, 10);
			if (!Number.isFinite(id) || id <= 0) throw new DiscogsError('Bad release id.', 400);
			const seed = toSeed(await getRelease(id));
			return Response.json({ seed });
		}

		if (barcode && barcode.trim()) {
			const { results, total } = await searchReleases({ barcode: barcode.trim(), perPage: 25 });
			return Response.json({ mode: 'barcode', barcode: barcode.trim(), candidates: results, total });
		}

		const q = url.searchParams.get('q');
		if (q && q.trim()) {
			const { results, total } = await searchReleases({ q: q.trim(), perPage: 25 });
			return Response.json({ mode: 'search', q: q.trim(), candidates: results, total });
		}

		throw new DiscogsError('Provide ?barcode= or ?q= or ?id=. ', 400);
	} catch (e) {
		if (e instanceof DiscogsError) {
			error(502, e.message);
		}
		throw e;
	}
}
