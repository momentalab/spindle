/**
 * Discogs enrichment (server-only): the layer that fetches a release and folds
 * it into local data — the tracklist (record_tracks) and the detail snapshot
 * (release_snapshots, one latest-wins JSON row per record).
 *
 * Everything here is a NON-FATAL enrichment: callers wrap in try/catch because
 * a Discogs outage must never block saving a record. Local-first means the
 * page renders from the DB alone with the network off; these rows are an
 * overlay, never a dependency.
 */
import { getDb } from '$lib/server/db';
import { getRelease, toSnapshot, type RawRelease } from '$lib/server/discogs';
import { replaceTracklist, type SeedTrack } from '$lib/server/tracks';
import type { ReleaseSnapshot } from '$lib/types';

/** Latest-wins: overwrite the snapshot for this record (upsert keyed by record_id). */
export function storeSnapshot(recordId: number, snapshot: ReleaseSnapshot): void {
	getDb()
		.prepare(
			`INSERT INTO release_snapshots (record_id, discogs_id, payload, fetched_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(record_id) DO UPDATE SET
				discogs_id = excluded.discogs_id,
				payload = excluded.payload,
				fetched_at = excluded.fetched_at`
		)
		.run(recordId, snapshot.discogs_id, JSON.stringify(snapshot), snapshot.fetched_at);
}

/** The stored snapshot for a record, or undefined when none exists. */
export function snapshotForRecord(recordId: number): ReleaseSnapshot | undefined {
	const row = getDb().prepare('SELECT payload FROM release_snapshots WHERE record_id = ?').get(recordId) as
		{ payload: string } | undefined;
	if (!row) return undefined;
	try {
		return JSON.parse(row.payload) as ReleaseSnapshot;
	} catch {
		// Corrupt payload (hand-edited DB?) — treat as absent rather than crash.
		return undefined;
	}
}

/**
 * Seed the record's tracklist from an ALREADY-FETCHED release (no network here
 * → unit-testable with a fake). Maps the release's tracklist entries and
 * replaces the local list, carrying favorites over by position + title — so
 * re-pointing at a different pressing of the same album keeps the user's stars.
 *
 * Returns the number of tracks written (0 when the release has no usable
 * tracklist — the guard in replaceTracklist keeps any existing rows intact,
 * an empty Discogs tracklist must never wipe user-entered tracks).
 */
export function seedTracklist(recordId: number, release: RawRelease): number {
	const rows: SeedTrack[] = (release.tracklist ?? [])
		.filter((t) => t.title && t.title.trim() !== '')
		.map((t) => ({
			position: t.position ?? null,
			title: t.title!.trim(),
			duration: t.duration ?? null
		}));
	return replaceTracklist(recordId, rows);
}

/**
 * The wrapper that DOES fetch: get the release, seed the tracklist (always
 * re-seeded — import finds an empty list, re-identify deliberately replaces it
 * with favorites carried over), store the detail snapshot. Throws DiscogsError
 * on failure — every caller treats it as non-fatal (the record is saved;
 * enrichment can be retried via the "Load from Discogs" / "Refresh details"
 * buttons on the record page).
 */
export async function enrichFromDiscogs(recordId: number, discogsId: number): Promise<void> {
	const release = await getRelease(discogsId);
	seedTracklist(recordId, release);
	storeSnapshot(recordId, toSnapshot(release, discogsId));
}
