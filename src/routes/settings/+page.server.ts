/**
 * /settings — preference management + data portability, all in one place.
 * Server load is read-only: the environment summary (Discogs state, data dir,
 * counts). Preferences themselves are client-owned (localStorage), and every
 * action on the page hits an existing endpoint (/api/export, /api/backup,
 * /api/restore, /api/discogs-check) — no write path of its own.
 */
import { settingsSummary } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { summary: settingsSummary() };
};
