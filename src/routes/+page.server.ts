/**
 * Collection home: server-side list with search / sort / filter.
 */
import { listRecords, distinctValues, countRecords } from '$lib/server/records';
import type { ListOptions, RecordStatus } from '$lib/types';
import type { PageServerLoad } from './$types';

const SORT_COLUMNS = new Set(['artist', 'title', 'year', 'genre', 'label', 'acquired_at', 'updated_at']);

export const load: PageServerLoad = async ({ url }) => {
	const search = url.searchParams.get('q') ?? '';
	const genre = url.searchParams.get('genre') ?? '';
	const label = url.searchParams.get('label') ?? '';
	const statusParam = url.searchParams.get('status') ?? '';
	const sort = (url.searchParams.get('sort') ?? 'artist') as ListOptions['sort'];
	const dirParam = url.searchParams.get('dir') ?? 'asc';

	const opts: ListOptions = {
		search,
		genre: genre || undefined,
		label: label || undefined,
		status: (statusParam as RecordStatus) || '',
		sort: SORT_COLUMNS.has(sort) ? sort : 'artist',
		dir: dirParam === 'desc' ? 'desc' : 'asc'
	};

	const records = listRecords(opts);
	return {
		records,
		total: countRecords(),
		filters: {
			genres: distinctValues('genre'),
			labels: distinctValues('label'),
			active: opts
		}
	};
};
