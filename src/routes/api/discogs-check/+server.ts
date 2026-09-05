/**
 * Connection probe for the /settings status block.
 *
 * GET /api/discogs-check
 *   -> { ok, configured, message }
 *
 * One minimal search request (a fixed, well-known title) verifies credentials
 * AND reachability without touching the collection. The result is cached per
 * process for 60s so re-opening Settings doesn't burn a rate-limit slot.
 */
import { DiscogsError, isConfigured, searchReleases } from '$lib/server/discogs';

let cache: { at: number; body: Record<string, unknown> } | null = null;
const TTL_MS = 60_000;

export async function GET(): Promise<Response> {
	if (cache && Date.now() - cache.at < TTL_MS) return Response.json(cache.body);

	let body: Record<string, unknown>;
	if (!isConfigured()) {
		body = {
			ok: true,
			configured: false,
			message: 'Running unauthenticated — searches work at the low tier (25 req/min).'
		};
	} else {
		try {
			await searchReleases({ q: 'Abbey Road', perPage: 1 });
			body = { ok: true, configured: true, message: 'Credentials valid — high tier (60 req/min).' };
		} catch (e) {
			const detail = e instanceof DiscogsError ? e.message : String(e);
			body = { ok: false, configured: true, message: `Discogs rejected the probe — ${detail}` };
		}
	}

	cache = { at: Date.now(), body };
	return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
