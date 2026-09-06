/**
 * Cover override by upload (manual image, same pipeline as photos).
 *
 * POST /api/records/<id>/cover  { file: File }
 *   -> { ok: true, record: RecordRow }
 *
 * Replaces the current cover (the superseded local file is removed) and nulls
 * `cover_remote_url` — a manual upload has no Discogs fallback by definition.
 */
import { error, json } from '@sveltejs/kit';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from '$lib/server/paths';
import { allocateMediaFilename, findRecordById, rmMediaFile, updateRecord } from '$lib/server/records';

export async function POST({ params, request }): Promise<Response> {
	const recordId = Number.parseInt(params.id, 10);
	if (!Number.isFinite(recordId) || recordId <= 0) error(400, 'Bad record id');
	const record = findRecordById(recordId);
	if (!record) error(404, 'Record not found');

	const data = await request.formData();
	const file = data.get('file');
	if (!(file instanceof File) || file.size === 0) error(400, 'No file provided');

	// Client re-encodes to ~1600px JPEG; enforce a hard ceiling here regardless.
	// Must stay in sync with the UPLOAD_MAX_BYTES cap in records/[id]/+page.svelte.
	const MAX_BYTES = 25 * 1024 * 1024;
	if (file.size > MAX_BYTES) {
		error(400, `Image too large (${Math.ceil(file.size / 1024 / 1024)}MB, max 25MB)`);
	}

	const filename = allocateMediaFilename(recordId, 'cover');
	const bytes = Buffer.from(await file.arrayBuffer());
	writeFileSync(path.join(MEDIA_DIR, filename), bytes);

	const updated = updateRecord(recordId, { cover_filename: filename, cover_remote_url: null });
	if (!updated) error(404, 'Record not found');

	// The superseded cover file is no longer referenced by anything.
	if (record.cover_filename && record.cover_filename !== filename) {
		rmMediaFile(record.cover_filename);
	}

	return json({ ok: true, record: updated });
}
