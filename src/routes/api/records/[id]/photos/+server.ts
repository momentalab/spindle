/**
 * Photo management for a record (multipart form via use:enhance / fetch).
 *
 * POST  /api/records/<id>/photos   { files: File[], caption?: string }
 * DELETE /api/records/<id>/photos?photoId=<n>
 */
import { error, json } from '@sveltejs/kit';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from '$lib/server/paths';
import { addPhoto, allocateMediaFilename, deletePhoto, findRecordById, listPhotos } from '$lib/server/records';

export async function POST({ params, request }): Promise<Response> {
	const recordId = Number.parseInt(params.id, 10);
	if (!Number.isFinite(recordId) || recordId <= 0) error(400, 'Bad record id');
	const record = findRecordById(recordId);
	if (!record) error(404, 'Record not found');

	const data = await request.formData();
	const files = (data.getAll('files') as File[]).filter((f) => f instanceof File && f.size > 0);
	if (files.length === 0) error(400, 'No file provided');
	if (files.length > 10) error(400, 'Too many files at once (max 10)');

	const captionRaw = data.get('caption');
	const caption = typeof captionRaw === 'string' && captionRaw.trim() ? captionRaw.trim() : null;

	// Client re-encodes to ~1600px JPEG and asks before compressing photos over
	// 8MB; enforce a hard ceiling here regardless. Must stay in sync with the
	// UPLOAD_MAX_BYTES cap in records/[id]/+page.svelte.
	const MAX_BYTES = 25 * 1024 * 1024;
	for (const f of files) {
		if (f.size > MAX_BYTES) error(400, `Photo too large (${Math.ceil(f.size / 1024 / 1024)}MB, max 25MB)`);
	}

	const saved = [];
	for (const f of files) {
		const filename = allocateMediaFilename(recordId, 'photo');
		const bytes = Buffer.from(await f.arrayBuffer());
		writeFileSync(path.join(MEDIA_DIR, filename), bytes);
		saved.push(addPhoto(recordId, filename, caption));
	}

	return json({ ok: true, photos: listPhotos(recordId) });
}

export async function DELETE({ params, url }): Promise<Response> {
	const recordId = Number.parseInt(params.id, 10);
	const photoId = Number.parseInt(url.searchParams.get('photoId') ?? '', 10);
	if (!Number.isFinite(recordId) || !Number.isFinite(photoId)) error(400, 'Bad id');

	const ok = deletePhoto(photoId);
	if (!ok) error(404, 'Photo not found');
	return json({ ok: true, photos: listPhotos(recordId) });
}
