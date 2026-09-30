/**
 * Shared Discogs link helpers (client-safe — no API access).
 */

/**
 * Canonical public release URL for a record's `discogs_id`.
 * Returns null when the id is absent or not a positive integer.
 */
export function discogsReleaseUrl(discogsId: number | string | null | undefined): string | null {
	if (discogsId === null || discogsId === undefined) return null;
	const id = Number(discogsId);
	if (!Number.isInteger(id) || id <= 0) return null;
	return `https://www.discogs.com/release/${id}`;
}

/** Consistent rel/target attrs for outbound Discogs links. */
export const DISCOGS_LINK_ATTRS = {
	target: '_blank',
	rel: 'noopener noreferrer'
} as const;
