/**
 * Collection backup endpoint (roadmap F8).
 *
 * POST /api/backup  →  streams the whole collection as a zip download:
 *   spindle.db (WAL checkpointed + truncated first, so it is self-contained)
 *   spindle.db-wal / spindle.db-shm (only if still present)
 *   media/<every cover and photo>
 *
 * A POST (not a GET) on purpose: the body is freshly built per request, can
 * be several hundred MB, and never should be cached or pre-fetched by
 * crawlers.
 */
import { error } from '@sveltejs/kit';
import { createBackup } from '$lib/server/backup';

export async function POST(): Promise<Response> {
	let buffer: Buffer;
	try {
		const built = await createBackup();
		buffer = built.buffer;
	} catch (e) {
		error(500, e instanceof Error && e.message ? e.message : 'Backup failed.');
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return new Response(new Uint8Array(buffer), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Length': String(buffer.length),
			'Content-Disposition': `attachment; filename="spindle-backup-${stamp}.zip`,
			'Cache-Control': 'no-store'
		}
	});
}

export function GET() {
	error(405, 'Use POST /api/backup — the backup is built per request and streamed as a download.');
}
