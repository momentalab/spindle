/**
 * /value — the collection as a portfolio (F7).
 *
 * Server-side aggregates only: local cost basis + realized sales from
 * `records`, live market comparison + the monthly worth series from the
 * append-only `market_prices` log. The first visit of a day kicks off one
 * snapshot pass in the background — unawaited, since a pass is up to 45
 * sequential Discogs calls and must not hold render; the page paints instantly
 * from whatever history exists and stays fully usable offline, and a failed
 * (e.g. offline) pass simply retries on the next visit. POST
 * /api/value/snapshot remains the on-demand override. No query params; one
 * SSR'd spread.
 */
import { hasTodaySnapshot, portfolioHistory, portfolioStats, takeMarketSnapshot } from '$lib/server/value';
import type { PageServerLoad } from './$types';

/* A pass can run for a minute or more, well past a double-refresh — this keeps
   a burst of first-of-the-day visits from firing several passes at once. */
let autoPassInFlight = false;

export const load: PageServerLoad = () => {
	if (!hasTodaySnapshot() && !autoPassInFlight) {
		autoPassInFlight = true;
		void takeMarketSnapshot()
			.catch(() => {})
			.finally(() => {
				autoPassInFlight = false;
			});
	}
	return { stats: portfolioStats(), portfolio: portfolioHistory() };
};
