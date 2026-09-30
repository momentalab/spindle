/**
 * Settings API (data-affecting preferences live in the DB, not localStorage).
 *
 * GET /api/settings
 *   -> SettingsSummary (same shape the page server-load returns)
 *
 * PUT /api/settings   { normalize_artist_leadword?: 'on' | 'off' }
 *   -> { ok, normalize_artist_leadword }
 *
 * Unknown keys are rejected with 400 so the client self-corrects. This route is
 * the only write path for the settings table; cosmetic prefs (theme, default
 * view) deliberately bypass it and stay in the browser.
 */
import { error } from '@sveltejs/kit';
import { setLeadWordNormalization } from '$lib/server/artist';
import { settingsSummary } from '$lib/server/settings';

export function GET(): Response {
	return Response.json(settingsSummary());
}

export async function PUT({ request }: { request: Request }): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'Expected a JSON body.');
	}

	if ('normalize_artist_leadword' in body) {
		const v = body.normalize_artist_leadword;
		if (v !== 'on' && v !== 'off') error(400, `normalize_artist_leadword must be "on" or "off", got "${String(v)}".`);
		setLeadWordNormalization(v === 'on');
	}

	return Response.json({
		ok: true,
		normalize_artist_leadword: settingsSummary().normalize_artist_leadword
	});
}
