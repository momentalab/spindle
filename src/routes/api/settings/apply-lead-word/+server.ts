/**
 * One-time backfill for the artist lead-word preference.
 *
 * POST /api/settings/apply-lead-word
 *   -> { ok, changed }
 *
 * Toggling the preference only changes FUTURE saves; this endpoint rewrites
 * the already-stored records whose artist still has a trailing leading word
 * ("Beatles, The" -> "The Beatles"). Idempotent — a second run changes nothing.
 */
import { applyLeadWordToAllRecords } from '$lib/server/artist';

export function POST(): Response {
	const changed = applyLeadWordToAllRecords();
	return Response.json({ ok: true, changed });
}
