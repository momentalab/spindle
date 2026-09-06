/**
 * Tracklist for a record (one row per song; display order = insertion order).
 *
 * GET  /api/records/<id>/tracks → the authoritative list ({ ok, tracks })
 * POST /api/records/<id>/tracks → add a track ({ position?, title, duration? })
 *
 * The response carries the full authoritative list so the client never does
 * partial state surgery (the photos API pattern).
 */
import { error, json } from '@sveltejs/kit';
import { findRecordById } from '$lib/server/records';
import { addTrack, listTracks } from '$lib/server/tracks';

function parseRecordId(raw: string): number {
	const id = Number.parseInt(raw, 10);
	if (!Number.isFinite(id) || id <= 0) error(400, 'Bad record id');
	return id;
}

function strOr(v: unknown): string | null {
	return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export async function GET({ params }): Promise<Response> {
	const recordId = parseRecordId(params.id);
	if (!findRecordById(recordId)) error(404, 'Record not found');
	return json({ ok: true, tracks: listTracks(recordId) });
}

export async function POST({ params, request }): Promise<Response> {
	const recordId = parseRecordId(params.id);
	if (!findRecordById(recordId)) error(404, 'Record not found');

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const title = strOr(body?.title);
	if (!title) return json({ ok: false, message: 'Track title is required.' }, { status: 400 });

	try {
		addTrack(recordId, {
			position: strOr(body?.position),
			title,
			duration: strOr(body?.duration)
		});
	} catch (e) {
		return json({ ok: false, message: e instanceof Error ? e.message : 'Could not add the track.' }, { status: 400 });
	}
	return json({ ok: true, tracks: listTracks(recordId) });
}
