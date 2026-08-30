/**
 * Play log for a record (one row per spin; undo = delete the latest row).
 *
 * POST   /api/records/<id>/plays  → log a play
 * DELETE /api/records/<id>/plays  → undo the most recent play
 *
 * Both return { ok, play_count, last_played_at } so the client can update
 * its count optimistically and reconcile from the authoritative response.
 */
import { error, json } from '@sveltejs/kit';
import { findRecordById, latestPlayedAt, logPlay, playCount, undoLatestPlay } from '$lib/server/records';

function parseRecordId(raw: string): number {
	const id = Number.parseInt(raw, 10);
	if (!Number.isFinite(id) || id <= 0) error(400, 'Bad record id');
	return id;
}

export async function POST({ params }): Promise<Response> {
	const recordId = parseRecordId(params.id);
	if (!findRecordById(recordId)) error(404, 'Record not found');
	logPlay(recordId);
	return json({ ok: true, play_count: playCount(recordId), last_played_at: latestPlayedAt(recordId) });
}

export async function DELETE({ params }): Promise<Response> {
	const recordId = parseRecordId(params.id);
	if (!findRecordById(recordId)) error(404, 'Record not found');
	if (!undoLatestPlay(recordId)) error(404, 'No plays to undo');
	return json({ ok: true, play_count: playCount(recordId), last_played_at: latestPlayedAt(recordId) });
}
