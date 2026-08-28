/**
 * Cover repair (server-only): find records whose cover never made it to disk and
 * re-download one from Discogs on demand.
 *
 * A record "needs a cover" when it has no local `cover_filename` AND we know where
 * to fetch from: the stored `cover_remote_url` (import-time fallback) or its
 * `discogs_id` (we can always re-look-up the release's primary image).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from '$lib/server/paths';
import { getRelease, downloadImage, type RawRelease } from '$lib/server/discogs';
import { allocateMediaFilename, findRecordById, listRecords, updateRecord } from '$lib/server/records';
import type { RecordRow } from '$lib/types';

export interface CoverRepairRow extends RecordRow {
	/** Why it's listed: remote-url fallback present, or re-lookup via discogs_id. */
	reason: 'remote_fallback' | 'discogs_lookup';
}

export function listMissingCovers(): CoverRepairRow[] {
	const rows = listRecords({ sort: 'artist', dir: 'asc' });
	return rows
		.filter((r) => !r.cover_filename && (r.cover_remote_url || r.discogs_id))
		.map((r) => ({
			...r,
			reason: r.cover_remote_url ? ('remote_fallback' as const) : ('discogs_lookup' as const)
		}));
}

/**
 * Re-fetch a cover for a single record and store it locally. Returns the updated row,
 * or throws (Error with a user-safe message) when no source is reachable.
 */
export async function repairCover(id: number): Promise<RecordRow> {
	const rec = findRecordById(id);
	if (!rec) throw new Error('Record not found.');
	if (rec.cover_filename) return rec; // nothing to do

	let url: string | null = null;
	if (rec.cover_remote_url) {
		url = rec.cover_remote_url;
	} else if (rec.discogs_id) {
		const release: RawRelease = await getRelease(rec.discogs_id);
		const images = release.images ?? [];
		url =
			images.find((i) => i.type === 'primary')?.uri ?? images[0]?.uri ?? null;
	}
	if (!url) {
		throw new Error('No cover source available — this record has no remote URL or Discogs ID.');
	}

	const { bytes } = await downloadImage(url);
	const filename = allocateMediaFilename(rec.id, 'cover');
	writeFileSync(path.join(MEDIA_DIR, filename), bytes);
	const updated = updateRecord(id, { cover_filename: filename });
	if (!updated) throw new Error('Record disappeared while saving its cover.');
	return updated;
}
