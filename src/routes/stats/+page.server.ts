/**
 * /stats — collection by the numbers (aggregates only, no filters).
 * ?window=12m|24m|all scopes the rhythm section; ?metric=count|value swaps
 * the genre/label/decade bars between counts and money. Server-side only;
 * record mutations already trigger invalidateAll().
 */
import { collectionStats, type StatsMetric, type StatsWindow } from '$lib/server/stats';
import type { PageServerLoad } from './$types';

const WINDOWS = new Set<StatsWindow>(['12m', '24m', 'all']);
const METRICS = new Set<StatsMetric>(['count', 'value']);

export const load: PageServerLoad = async ({ url }) => {
	const rawWindow = url.searchParams.get('window') ?? 'all';
	const rawMetric = url.searchParams.get('metric') ?? 'count';
	const window: StatsWindow = WINDOWS.has(rawWindow as StatsWindow) ? (rawWindow as StatsWindow) : 'all';
	const metric: StatsMetric = METRICS.has(rawMetric as StatsMetric) ? (rawMetric as StatsMetric) : 'count';
	return { stats: collectionStats(window), window, metric };
};
