/**
 * Artist name normalization (server-only).
 *
 * The catalogue convention is leading-word-first: "Beatles, The" reads better
 * as "The Beatles". A settings toggle (`normalize_artist_leadword`, seeded in
 * migration v6) decides whether the write path applies this. Because it shapes
 * stored data — not just display — the preference lives in the DB (rides along
 * in backups/restores, and a phone scan obeys the same rule as a desktop save),
 * unlike cosmetic preferences which stay in localStorage.
 */
import { getDb } from '$lib/server/db';

const KEY = 'normalize_artist_leadword';

/** The small set of words that lead a name in "The X" form. */
const LEADING_WORDS = new Set(['the', 'a', 'an', 'this', 'that']);

export function isLeadWordNormalizationOn(): boolean {
	const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
	return row?.value === 'on';
}

export function setLeadWordNormalization(on: boolean): void {
	getDb()
		.prepare(
			`INSERT INTO settings (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
		)
		.run(KEY, on ? 'on' : 'off');
}

/**
 * Move a trailing leading word to the front: "Beatles, The" -> "The Beatles".
 * Only touches names whose FINAL comma-separated part is exactly one of the
 * known lead words (case-insensitive), so feature/duo names like
 * "A Tribe Called Quest" are left alone. Idempotent for already-normalized
 * names ("The Beatles" has no trailing comma) and whitespace-collapsing.
 */
export function normalizeLeadWord(artist: string): string {
	const s = artist.replace(/\s+/g, ' ').trim();
	const parts = s.split(',');
	if (parts.length < 2) return s;

	const last = parts[parts.length - 1].trim();
	if (!LEADING_WORDS.has(last.toLowerCase())) return s;

	// Collapse interior whitespace per part while reordering.
	const head = parts
		.slice(0, -1)
		.map((p) => p.trim())
		.filter(Boolean)
		.join(', ');
	if (!head) return s; // "The" alone — nothing to move
	return `${last[0].toUpperCase()}${last.slice(1)} ${head}`.replace(/\s+/g, ' ').trim();
}

/**
 * One-time backfill: apply the lead-word move to every stored record that has
 * it in trailing position. Returns how many rows changed so the UI can report
 * it. Runs in a single transaction; safe to re-run (idempotent).
 */
export function applyLeadWordToAllRecords(): number {
	const db = getDb();
	const rows = db.prepare(`SELECT id, artist FROM records`).all() as { id: number; artist: string }[];

	const changed: number[] = [];
	const update = db.prepare(`UPDATE records SET artist = @artist, updated_at = @now WHERE id = @id`);
	const tx = db.transaction(() => {
		for (const row of rows) {
			const next = normalizeLeadWord(row.artist);
			if (next !== row.artist) {
				update.run({ id: row.id, artist: next, now: new Date().toISOString() });
				changed.push(row.id);
			}
		}
	});
	tx();
	return changed.length;
}
