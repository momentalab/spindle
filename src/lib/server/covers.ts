/**
 * Cover management (server-only): repair, override and restore.
 *
 * A record's cover state lives in two columns: `cover_filename` (local file in
 * data/media/, primary) and `cover_remote_url` (Discogs URI, fallback — kept so
 * the art is re-recoverable if the local file is ever lost). All three write
 * paths go through storeCoverFor(), which enforces that invariant.
 *
 *  - repairCover()          — heal a record whose cover never made it to disk.
 *  - pickCoverFromRelease() — borrow the artwork of ANY Discogs entry (a cover
 *                             override; the record's identity is untouched).
 *  - resetCoverToDiscogs()  — re-pull the cover of the record's own linked
 *                             release (undo an override when discogs_id exists).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from '$lib/server/paths';
import { DiscogsError, downloadImage, getRelease, type RawRelease } from '$lib/server/discogs';
import { allocateMediaFilename, findRecordById, listRecords, rmMediaFile, updateRecord } from '$lib/server/records';
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

/** The primary image of a release object (or the first image when no primary is flagged). */
function primaryImageUri(release: RawRelease): string | null {
	const images = release.images ?? [];
	return images.find((i) => i.type === 'primary')?.uri ?? images[0]?.uri ?? null;
}

/**
 * Download an image URL and store it as the record's cover file, replacing any
 * current cover (the superseded local file is removed). Also records `remoteUrl`
 * as the fallback so the art stays re-recoverable. Returns the updated row.
 */
async function storeCoverFor(
	id: number,
	previousFilename: string | null,
	imageUrl: string,
	remoteUrl: string | null
): Promise<RecordRow> {
	const { bytes } = await downloadImage(imageUrl);
	const filename = allocateMediaFilename(id, 'cover');
	writeFileSync(path.join(MEDIA_DIR, filename), bytes);
	const updated = updateRecord(id, { cover_filename: filename, cover_remote_url: remoteUrl });
	if (!updated) throw new Error('Record disappeared while saving its cover.');
	if (previousFilename && previousFilename !== filename) rmMediaFile(previousFilename);
	return updated;
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
		url = primaryImageUri(await getRelease(rec.discogs_id));
	}
	if (!url) {
		throw new Error('No cover source available — this record has no remote URL or Discogs ID.');
	}
	return storeCoverFor(id, rec.cover_filename, url, rec.cover_remote_url ?? url);
}

/**
 * Cover override from any Discogs entry: fetch the release, download its primary
 * artwork and store it as this record's cover. ONLY the two cover columns change —
 * no identity fields, no conflict checks (this is a deliberate contrast with
 * re-identification). The borrowed URI doubles as the remote fallback.
 */
export async function pickCoverFromRelease(recordId: number, releaseId: number): Promise<RecordRow> {
	const rec = findRecordById(recordId);
	if (!rec) throw new Error('Record not found.');

	let release: RawRelease;
	try {
		release = await getRelease(releaseId);
	} catch (e) {
		throw e instanceof DiscogsError ? e : new Error('Could not load that release from Discogs.');
	}
	const url = primaryImageUri(release);
	if (!url) throw new Error('That release has no cover images on Discogs.');

	return storeCoverFor(recordId, rec.cover_filename, url, url);
}

/**
 * Undo an override: re-pull the cover of the record's own linked release.
 * Requires a discogs_id (the UI hides the button otherwise).
 */
export async function resetCoverToDiscogs(recordId: number): Promise<RecordRow> {
	const rec = findRecordById(recordId);
	if (!rec) throw new Error('Record not found.');
	if (!rec.discogs_id) throw new Error('This record has no linked Discogs release to pull a cover from.');

	const url = primaryImageUri(await getRelease(rec.discogs_id));
	if (!url) throw new Error('The linked release has no cover images on Discogs.');

	return storeCoverFor(recordId, rec.cover_filename, url, url);
}
