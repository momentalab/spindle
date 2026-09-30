/**
 * /settings page data (server-only): a small read-only summary of the
 * environment — Discogs credential state, storage location, how much is
 * stored, and the data-affecting preferences themselves. Pure reads; nothing
 * here mutates.
 */
import { getDb } from '$lib/server/db';
import { DATA_DIR } from '$lib/server/paths';
import { isConfigured } from '$lib/server/discogs';
import { isLeadWordNormalizationOn, normalizeLeadWord } from '$lib/server/artist';

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
	/** 'on' | 'off' — artist lead-word normalization ("Beatles, The" → "The Beatles"). */
	normalize_artist_leadword: 'on' | 'off';
	/** Stored records whose artist the lead-word move would rewrite (for the one-time apply action). */
	affected_records: number;
}

export function settingsSummary(): SettingsSummary {
	const db = getDb();
	const count = (table: 'records' | 'photos' | 'plays'): number =>
		(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
	const artists = (db.prepare(`SELECT artist FROM records`).all() as { artist: string }[]).map((r) => r.artist);
	return {
		discogs_configured: isConfigured(),
		data_dir: DATA_DIR,
		counts: { records: count('records'), photos: count('photos'), plays: count('plays') },
		normalize_artist_leadword: isLeadWordNormalizationOn() ? 'on' : 'off',
		affected_records: artists.filter((a) => normalizeLeadWord(a) !== a).length
	};
}
