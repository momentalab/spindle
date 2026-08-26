/**
 * Import orchestration (server-only): create the local record, then pull the
 * cover art from Discogs to disk. Cover failure is non-fatal — the row keeps
 * its cover_remote_url as a fallback so the UI can still show something.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from '$lib/server/paths';
import { downloadImage } from '$lib/server/discogs';
import { allocateMediaFilename, createRecord, updateRecord, type NewRecordInput } from '$lib/server/records';

export interface ImportResult {
	recordId: number;
	coverSaved: boolean;
}

export async function importRecord(input: NewRecordInput): Promise<ImportResult> {
	const record = createRecord(input);
	let coverSaved = false;

	if (input.cover_remote_url) {
		try {
			const filename = allocateMediaFilename(record.id, 'cover');
			const { bytes } = await downloadImage(input.cover_remote_url);
			writeFileSync(path.join(MEDIA_DIR, filename), bytes);
			updateRecord(record.id, { cover_filename: filename });
			coverSaved = true;
		} catch {
			// Non-fatal: the record is saved; cover stays as the remote URL fallback.
		}
	}

	return { recordId: record.id, coverSaved };
}
