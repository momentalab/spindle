/**
 * Price-history snapshot for the /value page (F7).
 *
 * POST /api/value/snapshot
 *   -> { ok: true, attempted, recorded, no_listing, errors }
 *   -> { ok: false, message }          (Discogs unreachable / hard failure)
 *
 * One observation per shelf record with a discogs_id, APPENDED to the
 * market_prices log (the page derives "latest" from MAX(id)). Sequential and
 * budget-capped inside takeMarketSnapshot(); nothing is committed if the
 * network disappears mid-pass, so a failed snapshot never leaves half state.
 */
import { DiscogsError } from '$lib/server/discogs';
import { takeMarketSnapshot } from '$lib/server/value';

export async function POST(): Promise<Response> {
	try {
		const result = await takeMarketSnapshot();
		return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		const message = e instanceof DiscogsError ? e.message : 'Snapshot failed unexpectedly.';
		return Response.json({ ok: false, message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
	}
}
