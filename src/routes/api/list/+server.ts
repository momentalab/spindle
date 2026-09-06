/**
 * Full collection dump for the home page's client-side filtering/sorting.
 *
 * The SSR page load returns a FILTERED row set (correct first paint for
 * deep-linked URLs like /?q=x). Once the client hydrates it fetches this
 * unfiltered list and takes over search/filter/sort locally — every change is
 * then pure $derived work with zero navigation, so nothing outside the result
 * grid can re-render.
 */
import { json } from '@sveltejs/kit';
import { listRecords } from '$lib/server/records';
import { favoriteCounts } from '$lib/server/tracks';

export function GET(): Response {
	// No search/filter — everything, default artist A–Z order. Sorting and
	// slicing happen client-side once this lands.
	const records = listRecords({ sort: 'artist', dir: 'asc', status: '' });
	// Per-record favorite counts ride along for the client's starred filter/sort.
	// Plain object (not the Map) — json() is raw JSON.stringify, which would
	// collapse a Map to {}.
	const counts = favoriteCounts(records.map((r) => r.id));
	const track_counts: Record<string, { total: number; fav: number }> = {};
	for (const [id, c] of counts) track_counts[id] = c;
	return json({ records, track_counts });
}
