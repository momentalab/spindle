/**
 * One-tap acquire for a wanted record (JSON API, used by the home page's
 * "→ acquired" chips). The record detail page instead uses its named
 * `acquire` form action, which redirects so the edit form can open.
 *
 * POST /api/records/<id>/acquire → flip a wanted row into the collection
 */
import { error, json } from '@sveltejs/kit';
import { acquireRecord, findRecordById } from '$lib/server/records';

function parseRecordId(raw: string): number {
	const id = Number.parseInt(raw, 10);
	if (!Number.isFinite(id) || id <= 0) error(400, 'Bad record id');
	return id;
}

export async function POST({ params }): Promise<Response> {
	const recordId = parseRecordId(params.id);
	if (!findRecordById(recordId)) error(404, 'Record not found');
	// acquireRecord is a guarded no-op unless the row is actually wanted —
	// the returned status lets the client distinguish "flipped" from "ignored".
	const rec = acquireRecord(recordId);
	return json({ ok: true, status: rec?.status ?? null });
}
