/**
 * /value — the collection as a portfolio (F7).
 *
 * Server-side aggregates only: local cost basis + realized sales from
 * `records`, live market comparison from the append-only `market_prices`
 * log (filled by POST /api/value/snapshot — never fetched on render, so
 * the page stays fully usable offline). No query params; one SSR'd spread.
 */
import { portfolioStats } from '$lib/server/value';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return { stats: portfolioStats() };
};
