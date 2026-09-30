/**
 * Single track: partial edit or delete.
 *
 * PATCH  /api/records/<id>/tracks/<trackId> → { position?, title?, duration?, favorite? }
 *        (a star tap is just a PATCH with { favorite } — the one write path for
 *        both field edits and the favorite toggle)
 * DELETE /api/records/<id>/tracks/<trackId> → remove the track
 *
 * Every response carries the full authoritative list so the client can
 * re-sync from it (the photos API pattern).
 */
import { error, json } from '@sveltejs/kit';
import { findRecordById } from '$lib/server/records';
import { deleteTrack, listTracks, updateTrack, type UpdateTrackInput } from '$lib/server/tracks';

function parseRecordId(raw: string): number {
	const id = Number.parseInt(raw, 10);
	if (!Number.isFinite(id) || id <= 0) error(400, 'Bad record id');
	return id;
}

function strOr(v: unknown): string | null {
	return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export async function PATCH({ params, request }): Promise<Response> {
	const recordId = parseRecordId(params.id);
	const trackId = Number.parseInt(params.trackId, 10);
	if (!Number.isFinite(trackId) || trackId <= 0) error(400, 'Bad track id');
	if (!findRecordById(recordId)) error(404, 'Record not found');

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return json({ ok: false, message: 'Empty patch.' }, { status: 400 });

	const patch: UpdateTrackInput = {};
	if (body.position !== undefined) patch.position = strOr(body.position);
	if (body.title !== undefined) patch.title = String(body.title ?? '');
	if (body.duration !== undefined) patch.duration = strOr(body.duration);
	if (body.favorite !== undefined) {
		const f = typeof body.favorite === 'boolean' ? body.favorite : Number(body.favorite) === 1;
		patch.favorite = f ? 1 : 0;
	}

	try {
		const updated = updateTrack(trackId, patch);
		if (!updated || updated.record_id !== recordId) error(404, 'Track not found');
	} catch (e) {
		return json(
			{ ok: false, message: e instanceof Error ? e.message : 'Could not update the track.' },
			{ status: 400 }
		);
	}
	return json({ ok: true, tracks: listTracks(recordId) });
}

export async function DELETE({ params }): Promise<Response> {
	const recordId = parseRecordId(params.id);
	const trackId = Number.parseInt(params.trackId, 10);
	if (!Number.isFinite(trackId) || trackId <= 0) error(400, 'Bad track id');
	if (!findRecordById(recordId)) error(404, 'Record not found');
	if (!deleteTrack(trackId)) error(404, 'Track not found');
	return json({ ok: true, tracks: listTracks(recordId) });
}
