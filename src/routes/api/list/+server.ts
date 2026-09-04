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

export function GET(): Response {
	// No search/filter — everything, default artist A–Z order. Sorting and
	// slicing happen client-side once this lands.
	const records = listRecords({ sort: 'artist', dir: 'asc', status: '' });
	return json({ records });
}
