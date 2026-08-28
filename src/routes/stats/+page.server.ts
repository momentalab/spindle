/**
 * /stats — collection by the numbers (aggregates only, no filters).
 */
import { collectionStats } from '$lib/server/stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { stats: collectionStats() };
};
