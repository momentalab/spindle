/**
 * Manual entry: no barcode, no Discogs lookup. Same form, local-only save.
 * If the user fills in a barcode and it already exists locally, offer add-copy.
 */
import { fail, redirect } from '@sveltejs/kit';
import { findByBarcode, addCopy, parseRecordForm } from '$lib/server/records';
import { importRecord } from '$lib/server/importer';
import type { Actions } from './$types';

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

		const input = parseRecordForm(data);
		if (!input) return fail(400, { error: 'Artist and title are required.' });

		const duplicate = input.barcode ? findByBarcode(input.barcode) : undefined;
		if (duplicate && data.get('op') !== 'create_anyway') {
			return fail(409, {
				duplicate: { id: duplicate.id, artist: duplicate.artist, title: duplicate.title }
			});
		}

		const result = await importRecord(input);
		redirect(303, `/records/${result.recordId}?imported=1`);
	}
};
