/**
 * Serve local media (covers + photos) with a traversal guard.
 * GET /media/<filename>  where filename is a bare name from the DB.
 */
import { error, json } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from '$lib/server/paths';

const EXT_TO_TYPE: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export async function GET({ params }): Promise<Response> {
	const name = params.file ?? '';

	// Traversal guard: must be a single bare filename, no path separators / dots tricks.
	if (
		!name ||
		name.includes('/') ||
		name.includes('\\') ||
		name.includes('..') ||
		name.startsWith('.')
	) {
		error(400, 'Bad media name');
	}

	const filePath = path.join(MEDIA_DIR, name);
	// Belt-and-suspenders: resolved path must stay inside MEDIA_DIR.
	const resolved = path.resolve(filePath);
	if (!resolved.startsWith(path.resolve(MEDIA_DIR) + path.sep)) {
		error(400, 'Bad media name');
	}

	if (!existsSync(resolved)) error(404, 'Media not found');

	const stat = statSync(resolved);
	const ext = path.extname(name).toLowerCase();
	const contentType = EXT_TO_TYPE[ext] ?? 'application/octet-stream';

	const stream = createReadStream(resolved);
	return new Response(stream as unknown as ReadableStream, {
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(stat.size),
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
}
