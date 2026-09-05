/**
 * /settings page data (server-only): a small read-only summary of the
 * environment — Discogs credential state, the storage location, and how much
 * is stored. Pure reads; nothing here mutates.
 */
import { getDb } from '$lib/server/db';
import { DATA_DIR } from '$lib/server/paths';
import { isConfigured } from '$lib/server/discogs';

export interface SettingsSummary {
	/** Consumer key + secret present in .env → high tier (60 req/min). */
	discogs_configured: boolean;
	/** Where the DB and media live on this machine (DATA_DIR override-aware). */
	data_dir: string;
	counts: {
		records: number;
		photos: number;
		plays: number;
	};
}

export function settingsSummary(): SettingsSummary {
	const db = getDb();
	const count = (table: 'records' | 'photos' | 'plays'): number =>
		(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
	return {
		discogs_configured: isConfigured(),
		data_dir: DATA_DIR,
		counts: { records: count('records'), photos: count('photos'), plays: count('plays') }
	};
}
