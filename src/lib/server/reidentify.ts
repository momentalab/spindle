/**
 * Re-identification (server-only): correct a record whose release was picked
 * wrongly at import time. The caller supplies only the chosen Discogs release
 * id; this module re-fetches that release authoritatively and overwrites the
 * record's identity fields from it, preserving everything that describes the
 * user's copy (conditions, price, notes, sale data). The cover art is swapped
 * to the new release's artwork — non-fatal, mirroring the import path.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from '$lib/server/paths';
import { seedTracklist, storeSnapshot } from '$lib/server/enrichment';
import { DiscogsError, downloadImage, getRelease, toSeed, toSnapshot } from '$lib/server/discogs';
import {
	allocateMediaFilename,
	findByBarcode,
	findByDiscogsId,
	findRecordById,
	rmMediaFile,
	updateRecord
} from '$lib/server/records';
import type { RecordRow } from '$lib/types';

/** Raised when another local record already owns the chosen release's id or barcode. */
export class ReidentifyConflictError extends Error {}

export async function reidentifyRecord(recordId: number, newDiscogsId: number): Promise<RecordRow> {
	const existing = findRecordById(recordId);
	if (!existing) throw new Error('Record not found.');

	// Picking the release the record already points at is a no-op.
	if (existing.discogs_id === newDiscogsId) return existing;

	let raw: Awaited<ReturnType<typeof getRelease>>;
	try {
		raw = await getRelease(newDiscogsId);
	} catch (e) {
		throw e instanceof DiscogsError ? e : new Error('Could not load that release from Discogs.');
	}
	const seed = toSeed(raw);

	const byDiscogs = findByDiscogsId(newDiscogsId);
	if (byDiscogs && byDiscogs.id !== recordId) {
		throw new ReidentifyConflictError(`Already saved as ${byDiscogs.artist} — ${byDiscogs.title} (same Discogs ID).`);
	}
	if (seed.barcode) {
		const byBarcode = findByBarcode(seed.barcode);
		if (byBarcode && byBarcode.id !== recordId) {
			throw new ReidentifyConflictError(`Already saved as ${byBarcode.artist} — ${byBarcode.title} (same barcode).`);
		}
	}

	// Identity only: ownership fields are deliberately omitted so updateRecord leaves them alone.
	const updated = updateRecord(recordId, {
		discogs_id: seed.discogs_id,
		barcode: seed.barcode ?? existing.barcode,
		artist: seed.artist,
		title: seed.title,
		styles: seed.styles,
		genres: seed.genres,
		year: seed.year,
		labels: seed.labels,
		format: seed.format,
		limited_edition: seed.limited_edition === 1,
		cover_remote_url: seed.cover_url
	});
	if (!updated) throw new Error('Record disappeared while saving.');

	// The release was already fetched above; fold it into the tracklist (stars
	// carried over by position+title, so re-pointing at another pressing of the
	// same album keeps them) and refresh the detail snapshot — zero extra API
	// calls. Wrapped so a seed hiccup can't undo the identity swap.
	try {
		seedTracklist(recordId, raw);
		storeSnapshot(recordId, toSnapshot(raw, newDiscogsId));
	} catch {
		// Non-fatal: identity is saved; tracks/details recover via the page buttons.
	}

	let result = updated;
	if (seed.cover_url) {
		try {
			const filename = allocateMediaFilename(recordId, 'cover');
			const { bytes } = await downloadImage(seed.cover_url);
			writeFileSync(path.join(MEDIA_DIR, filename), bytes);
			result = updateRecord(recordId, { cover_filename: filename }) ?? result;
			if (existing.cover_filename && existing.cover_filename !== filename) {
				rmMediaFile(existing.cover_filename);
			}
		} catch {
			// Non-fatal: the old cover stays in place; re-identify can retry later.
		}
	}
	return result;
}
