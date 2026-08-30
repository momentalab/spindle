/**
 * Record detail: all fields + photo gallery.
 * Actions (named only — SvelteKit forbids mixing named + default actions):
 *   edit      — update the record's fields (form)
 *   add_copy  — increment copies
 *   delete    — remove record (cascades photos + media files)
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { repairCover } from '$lib/server/covers';
import {
	addCopy,
	deleteRecord,
	findRecordById,
	latestPlayedAt,
	listPhotos,
	parseRecordForm,
	playCount,
	updateRecord
} from '$lib/server/records';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number.parseInt(params.id, 10);
	if (!Number.isFinite(id) || id <= 0) error(400, 'Bad record id');
	const record = findRecordById(id);
	if (!record) error(404, 'Record not found');
	return {
		record,
		photos: listPhotos(id),
		play_count: playCount(id),
		last_played_at: latestPlayedAt(id)
	};
};

export const actions: Actions = {
	edit: async ({ request, params }) => {
		const id = Number.parseInt(params.id, 10);
		const data = await request.formData();

		const input = parseRecordForm(data);
		if (!input) return fail(400, { error: 'Artist and title are required.' });

		// Fields with no UI in the edit form must not be clobbered by an edit:
		//  - cover_filename / cover_remote_url: the cover is downloaded at import time;
		//    the local file reference must survive edits (parseRecordForm has no way to express "unchanged").
		//  - copies: managed exclusively by the "add a copy" action, not by a field edit.
		const { cover_filename, cover_remote_url, copies, ...patch } = input;

		const updated = updateRecord(id, patch);
		if (!updated) error(404, 'Record not found');
		// Returning nothing = success: SvelteKit revalidates and stays on the page.
		return null;
	},

	add_copy: async ({ params }) => {
		const id = Number.parseInt(params.id, 10);
		if (!findRecordById(id)) error(404, 'Record not found');
		addCopy(id);
		redirect(303, `/records/${id}?added_copy=1`);
	},

	repair_cover: async ({ params }) => {
		const id = Number.parseInt(params.id, 10);
		if (!findRecordById(id)) error(404, 'Record not found');
		try {
			await repairCover(id);
		} catch (e) {
			return fail(502, {
				error: e instanceof Error ? e.message : 'Cover download failed.'
			});
		}
		// Success: return nothing so SvelteKit revalidates the page data.
	},

	delete: async ({ params }) => {
		const id = Number.parseInt(params.id, 10);
		if (deleteRecord(id)) {
			redirect(303, '/?deleted=1');
		}
		error(404, 'Record not found');
	}
};
