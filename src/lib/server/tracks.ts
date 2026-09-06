/**
 * Tracklist data access (server-only). Thin prepared-statement wrapper over the
 * record_tracks table. Display order is insertion order (id ASC) — Discogs
 * positions ("A1"…"B2") are not lex-sortable, so position is a display code only.
 */
import { getDb } from '$lib/server/db';
import type { TrackRow } from '$lib/types';

export interface NewTrackInput {
	position?: string | null;
	title: string;
	duration?: string | null;
	favorite?: 0 | 1;
}

export function listTracks(recordId: number): TrackRow[] {
	const rows = getDb()
		.prepare('SELECT * FROM record_tracks WHERE record_id = ? ORDER BY id')
		.all(recordId) as TrackRow[];
	return rows;
}

export function findTrackById(id: number): TrackRow | undefined {
	const row = getDb().prepare('SELECT * FROM record_tracks WHERE id = ?').get(id) as
		| TrackRow
		| undefined;
	return row;
}

export function addTrack(recordId: number, input: NewTrackInput): TrackRow {
	const title = input.title.trim();
	if (!title) throw new Error('Track title is required.');
	const now = new Date().toISOString();
	const db = getDb();
	const info = db
		.prepare(
			`INSERT INTO record_tracks (record_id, position, title, duration, favorite, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(
			recordId,
			input.position?.trim() || null,
			title,
			input.duration?.trim() || null,
			input.favorite ?? 0,
			now
		);
	const row = db.prepare('SELECT * FROM record_tracks WHERE id = ?').get(Number(info.lastInsertRowid)) as TrackRow;
	return row;
}

export type UpdateTrackInput = Partial<{
	position: string | null;
	title: string;
	duration: string | null;
	favorite: 0 | 1;
}>;

/**
 * Partial edit — the single write path for field edits AND the favorite toggle
 * (a star tap is just a PATCH with { favorite }). Undefined fields are left
 * untouched, matching updateRecord's patch semantics.
 */
export function updateTrack(id: number, patch: UpdateTrackInput): TrackRow | undefined {
	const existing = findTrackById(id);
	if (!existing) return undefined;

	const db = getDb();
	const fields: string[] = [];
	const params: Record<string, unknown> = { id };
	for (const key of ['position', 'title', 'duration', 'favorite'] as const) {
		const value = patch[key];
		if (value === undefined) continue;
		fields.push(`${key} = @${key}`);
		if (key === 'title') {
			const t = String(value).trim();
			if (!t) throw new Error('Track title is required.');
			params.title = t;
		} else if (key === 'favorite') {
			params.favorite = value ? 1 : 0;
		} else {
			params[key] = typeof value === 'string' ? (value.trim() || null) : value;
		}
	}
	if (fields.length === 0) return existing;
	db.prepare(`UPDATE record_tracks SET ${fields.join(', ')} WHERE id = @id`).run(params);
	return findTrackById(id);
}

export function deleteTrack(id: number): boolean {
	const info = getDb().prepare('DELETE FROM record_tracks WHERE id = ?').run(id);
	return info.changes > 0;
}

/**
 * Per-record track counts for list surfaces — one GROUP BY over all ids at
 * once (the playCounts() pattern), never N+1. Records with no tracks are
 * simply absent from the map; callers read `?? { total: 0, fav: 0 }`.
 */
export function favoriteCounts(ids: number[]): Map<number, { total: number; fav: number }> {
	const out = new Map<number, { total: number; fav: number }>();
	if (ids.length === 0) return out;
	const db = getDb();
	const placeholders = ids.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`SELECT record_id, COUNT(*) AS total, SUM(favorite) AS fav
			 FROM record_tracks WHERE record_id IN (${placeholders}) GROUP BY record_id`
		)
		.all(...ids) as { record_id: number; total: number; fav: number | null }[];
	for (const r of rows) out.set(r.record_id, { total: r.total, fav: r.fav ?? 0 });
	return out;
}

/* ------------------------------------------------------------------ */
/* Seeding / reloading from Discogs                                    */
/* ------------------------------------------------------------------ */

/** Normalized matching key for favorite carry-over across re-seeds. */
function trackKey(position: string | null, title: string): string {
	return `${(position ?? '').trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

export interface SeedTrack {
	position?: string | null;
	title: string;
	duration?: string | null;
}

/**
 * Replace the record's tracklist with `rows` (in display order), carrying each
 * existing row's favorite flag onto the incoming row whose normalized
 * position + title match — so re-pointing at a different pressing of the same
 * album keeps the user's stars.
 *
 * Guard: an empty `rows` list is a no-op. A Discogs release with no tracklist
 * must never wipe user-entered tracks (the recovery button only offers to
 * load when the local list is empty, but the primitive must hold the line).
 */
export function replaceTracklist(recordId: number, rows: SeedTrack[]): number {
	const db = getDb();
	const clean = rows.filter((r) => r.title.trim() !== '');
	if (clean.length === 0) return 0;

	const existing = listTracks(recordId);
	const favByKey = new Map<string, 0 | 1>();
	for (const t of existing) {
		if (t.favorite === 1) favByKey.set(trackKey(t.position, t.title), 1);
	}

	const now = new Date().toISOString();
	const ins = db.prepare(
		`INSERT INTO record_tracks (record_id, position, title, duration, favorite, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);
	const run = db.transaction(() => {
		db.prepare('DELETE FROM record_tracks WHERE record_id = ?').run(recordId);
		for (const r of clean) {
			const pos = r.position?.trim() || null;
			const title = r.title.trim();
			ins.run(recordId, pos, title, r.duration?.trim() || null, favByKey.get(trackKey(pos, title)) ?? 0, now);
		}
	});
	run();
	return clean.length;
}
