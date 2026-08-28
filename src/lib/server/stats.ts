/**
 * Collection aggregates for the /stats page (server-only).
 * Pure read queries over the existing schema — no new tables or columns.
 */
import { getDb } from '$lib/server/db';
import type { RecordStatus } from '$lib/types';

export interface StatBarRow {
	label: string;
	count: number;
}

export interface StatusCount {
	status: RecordStatus;
	count: number;
}

export interface CollectionStats {
	/* headline counters */
	total: number;
	in_collection: number;
	sold: number;
	traded_away: number;
	copies_total: number;
	limited_editions: number; // in-collection rows flagged limited
	covers_local: number; // rows with a locally stored cover file
	value_cents: number; // current collection value: Σ price_paid × copies (in_collection)
	avg_price_cents: number | null; // mean price_paid across priced entries
	priced_entries: number;
	/* distributions */
	by_genre: StatBarRow[];
	by_label: StatBarRow[];
	by_decade: StatBarRow[]; // ascending, "Undated" last
	statuses: StatusCount[];
}

const TOP_N = 8;

/** Keep the longest tail readable: top N + a single "Other" bucket. */
function topN(rows: StatBarRow[]): StatBarRow[] {
	if (rows.length <= TOP_N) return rows;
	const head = [...rows].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, TOP_N);
	const restCount = rows.slice(TOP_N).reduce((sum, r) => sum + r.count, 0);
	return [...head, { label: 'Other', count: restCount }];
}

/** "1974" → "1970s"; anything unparsable → "Undated". */
function decadeOf(year: string | null): string {
	if (!year) return 'Undated';
	const m = /^(\d{4})/.exec(year.trim());
	if (!m) return 'Undated';
	const y = Number(m[1]);
	if (y < 1900 || y > 2100) return 'Undated';
	return `${Math.floor(y / 10) * 10}s`;
}

export function collectionStats(): CollectionStats {
	const db = getDb();

	const headline = (db.prepare(`
		SELECT
			COUNT(*) AS total,
			SUM(status = 'in_collection') AS in_collection,
			SUM(status = 'sold') AS sold,
			SUM(status = 'traded_away') AS traded_away,
			SUM(copies) AS copies_total,
			SUM(CASE WHEN status = 'in_collection' AND limited_edition = 1 THEN 1 ELSE 0 END) AS limited_editions,
			SUM(cover_filename IS NOT NULL) AS covers_local,
			SUM(CASE WHEN status = 'in_collection' THEN COALESCE(price_paid, 0) * copies ELSE 0 END) AS value_cents,
			COUNT(price_paid) AS priced_entries,
			AVG(price_paid) AS avg_price
		FROM records
	`).get() as Record<string, null | number>) ?? {};

	const n = (v: unknown): number => (typeof v === 'number' ? v : 0);

	const groupRows = (column: 'genre' | 'label'): StatBarRow[] =>
		(db.prepare(`
			SELECT ${column} AS label, COUNT(*) AS count
			FROM records
			WHERE ${column} IS NOT NULL AND TRIM(${column}) != ''
			GROUP BY ${column}
		`).all() as { label: string; count: number }[]).sort(
			(a, b) => b.count - a.count || a.label.localeCompare(b.label)
		);

	/* Decades: bucket in JS — a personal collection is small and years are free text. */
	const years = (db.prepare('SELECT year FROM records').all() as { year: string | null }[]).map((r) =>
		decadeOf(r.year)
	);
	const decadeCounts = new Map<string, number>();
	for (const d of years) decadeCounts.set(d, (decadeCounts.get(d) ?? 0) + 1);
	const by_decade: StatBarRow[] = [...decadeCounts.entries()]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) =>
			a.label === 'Undated'
				? 1
				: b.label === 'Undated'
					? -1
					: a.label.localeCompare(b.label)
		);

	const statuses = (db.prepare(`
		SELECT status, COUNT(*) AS count FROM records GROUP BY status
	`).all() as StatusCount[])
		.map((s) => ({ ...s }))
		.sort((a, b) => b.count - a.count);

	return {
		total: n(headline.total),
		in_collection: n(headline.in_collection),
		sold: n(headline.sold),
		traded_away: n(headline.traded_away),
		copies_total: n(headline.copies_total),
		limited_editions: n(headline.limited_editions),
		covers_local: n(headline.covers_local),
		value_cents: n(headline.value_cents),
		avg_price_cents: typeof headline.avg_price === 'number' ? Math.round(headline.avg_price) : null,
		priced_entries: n(headline.priced_entries),
		by_genre: topN(groupRows('genre')),
		by_label: topN(groupRows('label')),
		by_decade,
		statuses
	};
}
