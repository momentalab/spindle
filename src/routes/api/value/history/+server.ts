/**
 * Price-history reset for the /value page (companion to the snapshot log).
 *
 * DELETE /api/value/history            -> wipe the whole market_prices log
 * DELETE /api/value/history?record_id= -> one record's observations only
 *   -> { ok: true, deleted }
 *   -> 400 when record_id is present but not a positive integer
 *
 * The log is append-only by design; this is the only route that removes from
 * it. It's destructive on purpose, so the UI confirms before calling.
 */
import { error } from '@sveltejs/kit';
import { resetMarketHistory } from '$lib/server/value';

export async function DELETE({ url }: { url: URL }): Promise<Response> {
	const raw = url.searchParams.get('record_id');
	let deleted: number;
	if (raw === null) {
		deleted = resetMarketHistory();
	} else {
		const id = Number(raw);
		if (!Number.isInteger(id) || id <= 0) error(400, `record_id must be a positive integer, got "${raw}".`);
		deleted = resetMarketHistory(id);
	}
	return Response.json({ ok: true, deleted }, { headers: { 'Cache-Control': 'no-store' } });
}
