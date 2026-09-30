/**
 * Manual entry: no barcode, no Discogs lookup. Same form, local-only save.
 * If the user fills in a barcode and it already exists locally, offer add-copy.
 */
import { fail, redirect } from '@sveltejs/kit';
import { findByBarcode, addCopy, acquireRecord, parseRecordForm, distinctValues } from '$lib/server/records';
import { importRecord } from '$lib/server/importer';
import type { Actions, PageServerLoad } from './$types';

/** Existing purchase sources, offered as suggestions in the form. */
export const load: PageServerLoad = () => ({
	sources: distinctValues('source')
});

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();

		if (data.get('op') === 'add_copy') {
			const recordId = Number.parseInt(String(data.get('record_id') ?? ''), 10);
			if (Number.isFinite(recordId) && recordId > 0) {
				addCopy(recordId);
				redirect(303, `/records/${recordId}?added_copy=1`);
			}
		}

		// F5 — re-entering a wanted record's details (or its barcode) flips it
		// into the collection instead of offering another copy.
		if (data.get('op') === 'acquire') {
			const recordId = Number.parseInt(String(data.get('record_id') ?? ''), 10);
			if (Number.isFinite(recordId) && recordId > 0) {
				acquireRecord(recordId);
				redirect(303, `/records/${recordId}?acquired=1`);
			}
		}

		const input = parseRecordForm(data);
		if (!input) return fail(400, { error: 'Artist and title are required.' });

		const duplicate = input.barcode ? findByBarcode(input.barcode) : undefined;
		if (duplicate && data.get('op') !== 'create_anyway') {
			// status rides along for the F5 wanted → "Mark as acquired" banner.
			return fail(409, {
				duplicate: {
					id: duplicate.id,
					artist: duplicate.artist,
					title: duplicate.title,
					status: duplicate.status
				}
			});
		}

		const result = await importRecord(input);
		redirect(303, `/records/${result.recordId}?imported=1`);
	}
};
