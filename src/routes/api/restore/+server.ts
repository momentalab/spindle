/**
 * Collection restore endpoint (roadmap F8) — the risky half of backup/restore.
 *
 * POST /api/restore  (multipart/form-data, field name: file)
 *   Uploads the zip a backup download produced. The server parses it,
 *   validates structure + every path, opens the candidate DB out-of-band and
 *   runs PRAGMA integrity_check — only then does it shut the live handle down,
 *   preserve the outgoing files in DATA_DIR/.pre-restore/ and swap the new
 *   generation in. Any failure aborts before DATA_DIR is touched.
 *
 *   → { ok: true, db_size_bytes, media_count, pre_restore_dir, record_count }
 *
 * Body limit: restore rides on the app's single BODY_SIZE_LIMIT (adapter-node
 * dev + prod). It is set to 512M by default (.env.example / compose) because a
 * media-heavy backup zip can be large; individual photo uploads are still
 * capped per-file at 8MB in their own route.
 */
import { error, json } from '@sveltejs/kit';
import { restoreFromBackup } from '$lib/server/backup';

export async function POST({ request }): Promise<Response> {
	const data = await request.formData().catch(() => null);
	if (!data) error(400, 'Expected a multipart form with a "file" field (the backup zip).');

	const file = data.get('file');
	if (!(file instanceof File) || file.size === 0) {
		error(400, 'No file received — send the backup zip as field "file".');
	}

	// Early shape check before the heavier validation inside restoreFromBackup.
	const head = Buffer.from(await file.slice(0, 4).arrayBuffer());
	if (head[0] !== 0x50 || head[1] !== 0x4b) {
		error(400, 'Not a zip file — upload the .zip a backup download produced.');
	}

	let info;
	try {
		info = await restoreFromBackup(Buffer.from(await file.arrayBuffer()));
	} catch (e) {
		error(400, e instanceof Error && e.message ? e.message : 'Restore failed.');
	}

	return json({ ok: true, ...info });
}

export function GET() {
	error(405, 'Use POST /api/restore with the backup zip as a multipart file field "file".');
}
