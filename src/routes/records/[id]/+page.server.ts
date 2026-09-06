/**
 * Record detail: all fields + photo gallery.
 * Actions (named only — SvelteKit forbids mixing named + default actions):
 *   edit         — update the record's fields (form)
 *   reidentify   — repoint the record at a different Discogs release
 *   add_copy     — increment copies
 *   delete       — remove record (cascades photos + media files)
 *   pick_cover   — override the cover with the artwork of ANY Discogs entry
 *   reset_cover  — re-pull the cover from the record's own linked release
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { pickCoverFromRelease, repairCover, resetCoverToDiscogs } from '$lib/server/covers';
import { DiscogsError } from '$lib/server/discogs';
import { ReidentifyConflictError, reidentifyRecord } from '$lib/server/reidentify';
import {
	acquireRecord,
	addCopy,
	deleteRecord,
	findRecordById,
	latestPlayedAt,
	listPhotos,
	parseRecordForm,
	playCount,
	updateRecord,
	distinctValues
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
		last_played_at: latestPlayedAt(id),
		// Existing purchase sources — suggestions for the edit form's source field.
		sources: distinctValues('source')
	};
};

export const actions: Actions = {
	acquire: async ({ request, params }) => {
		const id = Number.parseInt(params.id, 10);
		const rec = findRecordById(id);
		if (!rec) error(404, 'Record not found');
		// Not a wanted record — nothing to acquire (banner offers this instead of Add a copy).
		if (rec.status !== 'wanted')
			return fail(400, { error: 'Only wanted records can be acquired.' });

		// The acquire dialog may carry purchase details (all optional):
		// acquired_at (YYYY-MM-DD), price_paid (dollars), both conditions.
		const data = await request.formData();
		const dateRaw = String(data.get('acquired_at') ?? '');
		const priceRaw = String(data.get('price_paid') ?? '').trim();
		const priceCents =
			priceRaw && Number.isFinite(parseFloat(priceRaw))
				? Math.round(parseFloat(priceRaw) * 100)
				: null;
		acquireRecord(id, {
			acquired_at: /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null,
			price_paid: priceCents,
			condition_media: String(data.get('condition_media') ?? '') || null,
			condition_sleeve: String(data.get('condition_sleeve') ?? '') || null
		});
		redirect(303, `/records/${id}?acquired=1`);
	},

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
	
		reidentify: async ({ request, params }) => {
			const id = Number.parseInt(params.id, 10);
			if (!findRecordById(id)) error(404, 'Record not found');
			const data = await request.formData();
			const discogsId = Number.parseInt(String(data.get('discogs_id') ?? ''), 10);
			if (!Number.isFinite(discogsId) || discogsId <= 0)
				return fail(400, { error: 'No release was selected.' });
			try {
				await reidentifyRecord(id, discogsId);
			} catch (e) {
				if (e instanceof ReidentifyConflictError) return fail(409, { error: e.message });
				const msg =
					e instanceof DiscogsError
						? e.message
						: 'Could not re-identify this record. Please try again.';
				return fail(502, { error: msg });
			}
			redirect(303, `/records/${id}?reidentified=1`);
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

	// Cover override from any Discogs entry — artwork only, identity untouched.
	pick_cover: async ({ request, params }) => {
		const id = Number.parseInt(params.id, 10);
		if (!findRecordById(id)) error(404, 'Record not found');
		const data = await request.formData();
		const releaseId = Number.parseInt(String(data.get('release_id') ?? ''), 10);
		if (!Number.isFinite(releaseId) || releaseId <= 0)
			return fail(400, { error: 'No release was selected.' });
		try {
			await pickCoverFromRelease(id, releaseId);
		} catch (e) {
			const msg =
				e instanceof DiscogsError ? e.message : 'Could not save that cover. Please try again.';
			return fail(502, { error: msg });
		}
		redirect(303, `/records/${id}?cover_saved=1`);
	},

	// Undo an override: re-pull the cover from the record's own linked release.
	reset_cover: async ({ params }) => {
		const id = Number.parseInt(params.id, 10);
		const rec = findRecordById(id);
		if (!rec) error(404, 'Record not found');
		if (!rec.discogs_id) return fail(400, { error: 'This record has no linked Discogs release.' });
		try {
			await resetCoverToDiscogs(id);
		} catch (e) {
			const msg =
				e instanceof DiscogsError ? e.message : 'Could not save that cover. Please try again.';
			return fail(502, { error: msg });
		}
		redirect(303, `/records/${id}?cover_saved=1`);
	},

	delete: async ({ params }) => {
		const id = Number.parseInt(params.id, 10);
		if (deleteRecord(id)) {
			redirect(303, '/?deleted=1');
		}
		error(404, 'Record not found');
	}
};
