/**
 * Barcode import: look up the barcode on Discogs, show candidates, then save a
 * local record (with cover download). Dedupe: if the barcode or chosen Discogs
 * ID is already in the collection, offer "add another copy" first.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { searchReleases, getRelease, toSeed, DiscogsError } from '$lib/server/discogs';
import {
	findByBarcode,
	findByDiscogsId,
	addCopy,
	acquireRecord,
	parseRecordForm
} from '$lib/server/records';
import { importRecord } from '$lib/server/importer';
import type { PageServerLoad, Actions } from './$types';
import type { DiscogsSeed } from '$lib/types';
import type { SearchResultItem } from '$lib/server/discogs';

export const load: PageServerLoad = async ({ params }) => {
	const barcode = (params.barcode ?? '').replace(/\D+/g, '');
	if (barcode.length !== 12 && barcode.length !== 13) error(400, 'Not a valid barcode');

	const existing = findByBarcode(barcode);

	let candidates: SearchResultItem[] = [];
	let seed: DiscogsSeed | null = null;
	let lookupError: string | null = null;

	try {
		const res = await searchReleases({ barcode, perPage: 25 });
		candidates = res.results;
		if (candidates.length === 1) {
			seed = toSeed(await getRelease(candidates[0].id));
		}
	} catch (e) {
		lookupError = e instanceof DiscogsError ? e.message : 'Discogs lookup failed.';
	}

	return { barcode, candidates, seed, existing, lookupError };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const barcode = (params.barcode ?? '').replace(/\D+/g, '');
		const data = await request.formData();
		const op = data.get('op');

		if (op === 'add_copy') {
			const recordId = Number.parseInt(String(data.get('record_id') ?? ''), 10);
			if (Number.isFinite(recordId) && recordId > 0) {
				addCopy(recordId);
				redirect(303, `/records/${recordId}?added_copy=1`);
			}
		}

		// F5 — the buying-companion loop: re-scanning a wanted record flips it
		// into the collection instead of offering another copy.
		if (op === 'acquire') {
			const recordId = Number.parseInt(String(data.get('record_id') ?? ''), 10);
			if (Number.isFinite(recordId) && recordId > 0) {
				acquireRecord(recordId);
				redirect(303, `/records/${recordId}?acquired=1`);
			}
		}

		const input = parseRecordForm(data);
		if (!input) {
			return fail(400, { error: 'Artist and title are required.' });
		}

		// Dedupe (re-check at write time; user can override via "create anyway").
		if (data.get('op') !== 'create_anyway') {
			const byBarcode = input.barcode ? findByBarcode(input.barcode) : undefined;
			const byDiscogs = input.discogs_id ? findByDiscogsId(input.discogs_id) : undefined;
			const duplicate = byBarcode ?? byDiscogs;
			if (duplicate) {
				// status rides along so the banner can offer "Mark as acquired"
				// when the existing row is a want (F5).
				return fail(409, {
					duplicate: {
						id: duplicate.id,
						artist: duplicate.artist,
						title: duplicate.title,
						status: duplicate.status
					}
				});
			}
		}

		const result = await importRecord(input);
		redirect(303, `/records/${result.recordId}?imported=1`);
	}
};
