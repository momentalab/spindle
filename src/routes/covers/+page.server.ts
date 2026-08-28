/**
 * /covers — missing-cover repair: every record still leaning on a remote image
 * (or with no cover at all but a Discogs ID to look one up), with a per-row retry.
 */
import { listMissingCovers, repairCover } from '$lib/server/covers';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { rows: listMissingCovers() };
};

export const actions: Actions = {
	/** Per-row retry (enhanced — stays on the page, revalidates the row list). */
	repair: async ({ request }) => {
		const v = (await request.formData()).get('record_id');
		if (typeof v !== 'string') return { ok: false, message: 'Bad record id.' };
		const id = Number.parseInt(v, 10);
		if (!Number.isFinite(id) || id <= 0) return { ok: false, message: 'Bad record id.' };
		try {
			await repairCover(id);
			return { ok: true, recordId: id };
		} catch (e) {
			return {
				ok: false,
				recordId: id,
				message: e instanceof Error ? e.message : 'Cover download failed.'
			};
		}
	},

	/** One retry-all pass, top to bottom. */
	repair_all: async () => {
		const rows = listMissingCovers();
		let fixed = 0;
		let failed = 0;
		for (const r of rows) {
			try {
				await repairCover(r.id);
				fixed += 1;
			} catch {
				failed += 1;
			}
		}
		return { ok: true, fixed, failed };
	}
};
