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
			const { results } = await searchReleases({ barcode: barcode.trim(), perPage: 25 });
			// Always supplement with a text search on the top candidate's title so
			// the user sees pressings/variants. Barcode matches come first; text
			// matches are appended (deduped by id). One extra API call is negligible
			// for a single-user local app, and it keeps identify/re-identify lists
			// identical regardless of how many barcode hits Discogs returns.
			let candidates = results;
			if (results.length > 0) {
				const top = results[0];
				const q = [top.title, top.label?.[0]].filter(Boolean).join(' ');
				if (q) {
					try {
						const extra = await searchReleases({ q, perPage: 25 });
						const seen = new Set(candidates.map((c) => c.id));
						for (const c of extra.results) {
							if (!seen.has(c.id)) candidates.push(c);
						}
					} catch {
						// Non-fatal: the barcode results alone are fine.
					}
				}
			}
			return Response.json({ mode: 'barcode', barcode: barcode.trim(), candidates, total: candidates.length });
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
