/**
 * Release import: the Collection search bar's "+ Add" lands here — the chosen
 * Discogs release, seeded into the record form for a last look before it's
 * saved (same contract as the barcode flow). Dedupe: if the Discogs ID is
 * already in the collection, offer "add another copy" / "Mark as acquired"
 * first.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { getRelease, toSeed, DiscogsError } from '$lib/server/discogs';
import { findByBarcode, findByDiscogsId, addSpecificCopy, acquireRecord, parseRecordForm } from '$lib/server/records';
import { importRecord } from '$lib/server/importer';
import type { PageServerLoad, Actions } from './$types';
import type { DiscogsSeed } from '$lib/types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number.parseInt(params.id ?? '', 10);
	if (!Number.isFinite(id) || id <= 0) error(400, 'Not a valid release id');

	const existing = findByDiscogsId(id);

	let seed: DiscogsSeed | null = null;
	let lookupError: string | null = null;
	try {
		seed = toSeed(await getRelease(id));
	} catch (e) {
		lookupError = e instanceof DiscogsError ? e.message : 'Discogs lookup failed.';
	}

	return { id, seed, existing, lookupError };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const op = data.get('op');

		if (op === 'add_copy') {
			const recordId = Number.parseInt(String(data.get('record_id') ?? ''), 10);
			if (Number.isFinite(recordId) && recordId > 0) {
				addSpecificCopy(recordId, null); // same release found again → one more (unlabeled) copy
				redirect(303, `/records/${recordId}?added_copy=1`);
			}
		}

		// F5 — the buying-companion loop: a wanted release flips into the
		// collection instead of offering another copy.
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
			const byDiscogs = input.discogs_id ? findByDiscogsId(input.discogs_id) : undefined;
			const byBarcode = input.barcode ? findByBarcode(input.barcode) : undefined;
			const duplicate = byDiscogs ?? byBarcode;
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
