/**
 * Collection aggregates for the /stats page (server-only).
 * Pure read queries over the existing schema — no new tables or columns.
 * A personal collection is small, so a few full-table passes are cheap and keep
 * the bucketing logic (decades, formats, cross-tabs) in readable JavaScript.
 */
import { getDb } from '$lib/server/db';
import { CONDITIONS, type RecordStatus } from '$lib/types';

export interface StatBarRow {
	label: string;
	count: number;
}

/** A distribution row that also carries the money behind it (B4 metric toggle). */
export interface ValBarRow {
	label: string;
	count: number;
	value_cents: number; // Σ price_paid × copies over in_collection rows in the group
}

export interface StatusCount {
	status: RecordStatus;
	count: number;
}

/* ---- S1 — the rhythm (A1/A2/A4), most collected (C1), abstract (D1), D3/D5 ---- */

export type StatsWindow = '12m' | '24m' | 'all';
export type StatsMetric = 'count' | 'value';

export interface TimelineBucket {
	key: string; // 'YYYY-MM' (monthly) or 'YYYY' (yearly, long histories)
	label: string; // full label for tooltips — 'Aug 2026' / '2016'
	tick_label: string; // short axis tick — "Aug '26" / "2016"
	tick: boolean; // show a tick under this column
	count: number;
	cumulative: number; // running shelf growth (A2)
}

export interface PaceStats {
	label: string; // 'the last year' | 'the last two years' | 'since the first shelf'
	windowed: number; // dated acquisitions inside the window
	months: number; // months elapsed in the window (0 when nothing is dated)
	per_month: number; // windowed / months
	biggest: { label: string; count: number } | null;
	drought_weeks: number; // longest run of acquisition-free weeks (0 = none)
	oldest_acquired: string | null; // earliest acquired_at in the window, 'YYYY-MM-DD'
}

export interface PriciestRecord {
	id: number;
	artist: string;
	title: string;
	year: string | null;
	price_cents: number;
	cover: string | null;
}

/* ---- S2 — what it cost (B1–B5) ---- */

export interface PriceBand {
	label: string; // 'Under $10' … '$100+'
	count: number;
	value_cents: number;
}

export interface ScatterDot {
	x: number; // index into CONDITIONS (P→M order)
	y: number; // price_paid, cents
	label: string; // 'Artist — Title · $24.50 · NM'
}

/* ---- S3 — the object (A3, C2–C7, D2) ---- */

export interface CrossTabRow {
	decade: string;
	total: number;
	segments: { label: string; count: number }[]; // top genres + 'Other'
}

export interface Extremes {
	oldest: { year: number; artist: string; title: string; id: number } | null;
	freshest: { year: number; artist: string; title: string; id: number } | null;
}

/** S1 — "fresh wax": the most recent arrivals (cover-art strip on the page). */
export interface FreshRecord {
	id: number;
	artist: string;
	title: string;
	year: string | null;
	cover: string | null;
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
	covers_missing: number; // rows without a local cover (repairable if a source exists)
	value_cents: number; // current collection value: Σ price_paid × copies (in_collection)
	avg_price_cents: number | null; // mean price_paid across priced entries
	priced_entries: number;
	unpriced_entries: number; // in_collection rows without a price (B1 tail)
	/* distributions (count + money for the B4 toggle) */
	by_genre: ValBarRow[];
	by_label: ValBarRow[];
	by_decade: ValBarRow[]; // ascending, "Undated" last
	statuses: StatusCount[];
	/* S1 — the rhythm, most collected, abstract & milestones */
	timeline: TimelineBucket[]; // filled buckets for the active window (A1/A2)
	undated_count: number; // rows with no parseable acquired/created date
	pace: PaceStats; // A4
	top_artists: StatBarRow[]; // C1 — top 10
	fresh: FreshRecord[]; // latest arrivals, for the "fresh wax" strip
	priciest: PriciestRecord | null; // D1 (first of priciest_ten)
	median_year: number | null; // D1
	window_top_genre: StatBarRow | null; // D1 — only meaningful when window != 'all'
	hero_decade: { label: string; count: number; share: number } | null; // D3
	milestone: { next: number; remaining: number }; // D5
	/* S2 — what it cost */
	price_bands: PriceBand[]; // B1 — five readable bands, in order
	priciest_ten: PriciestRecord[]; // B2
	by_source: ValBarRow[]; // B3 — count + spend per source, 'Unrecorded' bucket
	scatter: ScatterDot[] | null; // B5 — condition × price, null when < 15 graded+priced
	/* S3 — the object */
	heatmap_year: number; // A3 — year shown in the calendar grid
	heatmap_days: Record<string, number>; // A3 — 'YYYY-MM-DD' → acquisitions that day
	formats: StatBarRow[]; // C2 — fixed bucket order, non-zero only
	condition_media: StatBarRow[]; // C3 — Goldmine order M→P, non-zero only
	condition_sleeve: StatBarRow[];
	condition_report: { graded: number; nm_or_better_pct: number | null }; // C3 headline
	by_style: StatBarRow[]; // C4
	cross_tab: CrossTabRow[]; // C5 — one row per dated decade, ascending
	duplicates: { entries: number; biggest_copies: number; rows: { id: number; artist: string; title: string; copies: number }[] } | null; // C6
	photos_total: number; // C7
	records_with_photos: number; // C7
	extremes: Extremes; // D2 — oldest / freshest parsed year
}

const TOP_N = 8;
const ARTIST_TOP_N = 10;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WINDOW_MONTHS: Record<StatsWindow, number | null> = { '12m': 12, '24m': 24, all: null };
const WINDOW_LABELS: Record<StatsWindow, string> = {
	'12m': 'the last year',
	'24m': 'the last two years',
	all: 'since the first shelf'
};
/** D5 markers — powers of ten and friendly half-marks. */
const MILESTONE_MARKS = [10, 25, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 5000];
const DAY_MS = 86400000;
/** C2 — fixed display order for the format spectrum. */
const FORMAT_ORDER = ['7"', '10"', 'LP', 'Box', 'CD', 'Other'] as const;

/** Keep the longest tail readable: top N + a single "Other" bucket. */
function topN(rows: StatBarRow[]): StatBarRow[] {
	if (rows.length <= TOP_N) return rows;
	const head = [...rows].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, TOP_N);
	const restCount = rows.slice(TOP_N).reduce((sum, r) => sum + r.count, 0);
	return [...head, { label: 'Other', count: restCount }];
}

/** "1974" → 1974 (anything unparsable or out of 1900–2100 → null). */
function parseYear(year: string | null): number | null {
	if (!year) return null;
	const m = /^(\d{4})/.exec(year.trim());
	if (!m) return null;
	const y = Number(m[1]);
	return y >= 1900 && y <= 2100 ? y : null;
}

/** "1974" → "1970s"; anything unparsable → "Undated". */
function decadeOf(year: string | null): string {
	const y = parseYear(year);
	return y === null ? 'Undated' : `${Math.floor(y / 10) * 10}s`;
}

/** 'YYYY-MM' key for a Date (local calendar). */
function monthKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key: string, delta: number): string {
	const [y, m] = key.split('-').map(Number);
	const total = y * 12 + (m - 1) + delta;
	return `${Math.floor(total / 12)}-${String(((total % 12) + 12) % 12 + 1).padStart(2, '0')}`;
}

/** Inclusive month count between two 'YYYY-MM' keys. */
function monthsBetween(a: string, b: string): number {
	const [ay, am] = a.split('-').map(Number);
	const [by, bm] = b.split('-').map(Number);
	return (by * 12 + bm) - (ay * 12 + am) + 1;
}

function monthLabel(key: string): { full: string; short: string } {
	const [y, m] = key.split('-').map(Number);
	return { full: `${MONTHS[m - 1]} ${y}`, short: `${MONTHS[m - 1]} '${String(y).slice(2)}` };
}

/** 'YYYY-MM…' prefix → valid 'YYYY-MM' key, else null. */
function parseMonthKey(v: string | null): string | null {
	if (!v) return null;
	const m = /^(\d{4})-(\d{2})/.exec(v.trim());
	if (!m) return null;
	const mo = Number(m[2]);
	return mo >= 1 && mo <= 12 ? `${m[1]}-${m[2]}` : null;
}

/** 'YYYY-MM-DD…' prefix → 'YYYY-MM-DD', else null. */
function parseDatePart(v: string | null): string | null {
	if (!v) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function dateUtc(s: string): number {
	const [y, m, d] = s.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

/** Millis of the Sunday that starts the week containing `ms` (Sunday-start weeks). */
function sundayOf(ms: number): number {
	return ms - new Date(ms).getUTCDay() * DAY_MS;
}

/** Longest run of consecutive acquisition-free Sundays in [start, end]. */
function longestDroughtWeeks(datesMs: number[], startMs: number, endMs: number): number {
	const filled = new Set(datesMs.map(sundayOf));
	let longest = 0;
	let run = 0;
	for (let t = sundayOf(startMs); t <= endMs; t += 7 * DAY_MS) {
		if (filled.has(t)) run = 0;
		else if (++run > longest) longest = run;
	}
	return longest;
}

/** C2 — bucket a Discogs multi-value format string by substring priority. */
function formatBucket(format: string | null): (typeof FORMAT_ORDER)[number] {
	if (!format) return 'Other';
	const s = format.toLowerCase();
	if (s.includes('7"')) return '7"';
	if (s.includes('10"')) return '10"';
	if (s.includes('box')) return 'Box';
	if (s.includes('lp')) return 'LP';
	if (s.includes('cd')) return 'CD';
	return 'Other';
}

/** C3 — condition rows in fixed Goldmine order (M→P), non-zero only. */
function conditionOrdered(counts: Record<string, number>): StatBarRow[] {
	return CONDITIONS.map((c) => ({ label: c, count: counts[c] ?? 0 })).filter((r) => r.count > 0);
}

export function collectionStats(window: StatsWindow = 'all'): CollectionStats {
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
			SUM(cover_filename IS NULL) AS covers_missing,
			SUM(CASE WHEN status = 'in_collection' THEN COALESCE(price_paid, 0) * copies ELSE 0 END) AS value_cents,
			COUNT(price_paid) AS priced_entries,
			SUM(status = 'in_collection' AND price_paid IS NULL) AS unpriced_entries,
			AVG(price_paid) AS avg_price
		FROM records
	`).get() as Record<string, null | number>) ?? {};

	const n = (v: unknown): number => (typeof v === 'number' ? v : 0);

	/* ---- Distributions with money attached (B4 toggle): genre & label in SQL. */
	const groupValRows = (column: 'genre' | 'label'): ValBarRow[] =>
		(db.prepare(`
			SELECT ${column} AS label,
			       COUNT(*) AS count,
			       SUM(CASE WHEN status = 'in_collection' THEN COALESCE(price_paid, 0) * copies ELSE 0 END) AS value_cents
			FROM records
			WHERE ${column} IS NOT NULL AND TRIM(${column}) != ''
			GROUP BY ${column}
		`).all() as ValBarRow[]).sort(
			(a, b) => b.count - a.count || a.label.localeCompare(b.label)
		);

	/* ---- One full-table pass feeds decades (F1/B4), median year (D1),
	   extremes (D2), cross-tab (C5), story dates (A1/A3) and formats (C2). ---- */
	const rows = db.prepare(`
		SELECT year, genre, status, price_paid, copies,
		       COALESCE(acquired_at, created_at) AS at,
		       acquired_at, format
		FROM records
	`).all() as {
		year: string | null;
		genre: string | null;
		status: RecordStatus;
		price_paid: number | null;
		copies: number;
		at: string | null;
		acquired_at: string | null;
		format: string | null;
	}[];

	const yearNums: number[] = [];
	const decadeAgg = new Map<string, ValBarRow>();
	const extremes: Extremes = { oldest: null, freshest: null };
	const crossAgg = new Map<string, Map<string, number>>();
	const formatCounts = new Map<string, number>();

	for (const r of rows) {
		const y = parseYear(r.year);
		if (y !== null) {
			yearNums.push(y);
			if (!extremes.oldest || y < extremes.oldest.year)
				extremes.oldest = { year: y, artist: '', title: '', id: 0 };
			if (!extremes.freshest || y > extremes.freshest.year)
				extremes.freshest = { year: y, artist: '', title: '', id: 0 };
		}
		const d = decadeOf(r.year);
		const cell = decadeAgg.get(d) ?? { label: d, count: 0, value_cents: 0 };
		cell.count++;
		if (r.status === 'in_collection' && r.price_paid !== null) cell.value_cents += r.price_paid * r.copies;
		decadeAgg.set(d, cell);
		if (y !== null && r.genre && r.genre.trim()) {
			const g = r.genre.trim();
			const m = crossAgg.get(d) ?? new Map<string, number>();
			m.set(g, (m.get(g) ?? 0) + 1);
			crossAgg.set(d, m);
		}
		if (r.status === 'in_collection') {
			const fb = formatBucket(r.format);
			formatCounts.set(fb, (formatCounts.get(fb) ?? 0) + 1);
		}
	}

	const by_decade: ValBarRow[] = [...decadeAgg.entries()]
		.map(([, v]) => v)
		.sort((a, b) =>
			a.label === 'Undated' ? 1 : b.label === 'Undated' ? -1 : a.label.localeCompare(b.label)
		);

	const median_year: number | null = yearNums.length
		? (() => {
				const ys = [...yearNums].sort((a, b) => a - b);
				const mid = Math.floor((ys.length - 1) / 2);
				return ys.length % 2 ? ys[mid] : Math.round((ys[mid] + ys[mid + 1]) / 2);
			})()
		: null;

	/* D2 — attach the actual pressing to each extreme year (most recent wins ties). */
	if (extremes.oldest || extremes.freshest) {
		const rowsWithId = db.prepare(`
			SELECT id, artist, title, year FROM records ORDER BY id
		`).all() as { id: number; artist: string; title: string; year: string | null }[];
		for (const r of rowsWithId) {
			const y = parseYear(r.year);
			if (y === null) continue;
			if (extremes.oldest && y === extremes.oldest.year)
				extremes.oldest = { year: y, artist: r.artist, title: r.title, id: r.id };
			if (extremes.freshest && y === extremes.freshest.year)
				extremes.freshest = { year: y, artist: r.artist, title: r.title, id: r.id };
		}
	}

	const statuses = (db.prepare(`
		SELECT status, COUNT(*) AS count FROM records GROUP BY status
	`).all() as StatusCount[])
		.map((s) => ({ ...s }))
		.sort((a, b) => b.count - a.count);

	/* ---- S1 — the rhythm: A1 buckets + A2 cumulative + A4 pace.
	   acquired_at drives the story; created_at is the fallback for undated rows. */
	const wm = WINDOW_MONTHS[window];
	const nowKey = monthKey(new Date());
	const startKey = wm !== null ? shiftMonth(nowKey, -(wm - 1)) : null;
	const inWindow = (key: string): boolean => (wm === null ? true : key >= (startKey as string));

	const perKey = new Map<string, number>();
	const windowedGenre = new Map<string, number>();
	let undated_count = 0;
	let minKey: string | null = null;
	let maxKey: string | null = null;
	const windowDatedMs: number[] = []; // dated rows inside the window (drought math)
	const acquiredInWindow: string[] = [];
	const heatmapDateCount = new Map<string, number>(); // A3 — 'YYYY-MM-DD' → n

	for (const r of rows) {
		const key = parseMonthKey(r.at);
		if (!key) {
			undated_count++;
			continue;
		}
		perKey.set(key, (perKey.get(key) ?? 0) + 1);
		if (!minKey || key < minKey) minKey = key;
		if (!maxKey || key > maxKey) maxKey = key;
		const datePart = parseDatePart(r.at);
		if (datePart) heatmapDateCount.set(datePart, (heatmapDateCount.get(datePart) ?? 0) + 1);
		if (inWindow(key)) {
			if (r.genre && r.genre.trim()) {
				const g = r.genre.trim();
				windowedGenre.set(g, (windowedGenre.get(g) ?? 0) + 1);
			}
			const acq = parseDatePart(r.acquired_at);
			if (acq) acquiredInWindow.push(acq);
			if (datePart) windowDatedMs.push(dateUtc(datePart));
		}
	}

	/* A1 — filled bucket array. Long histories (>36 months, window 'all') coast
	   from monthly to yearly buckets so the columns stay legible. */
	const timeline: TimelineBucket[] = [];
	if (minKey && maxKey) {
		const spanMonths = monthsBetween(minKey, maxKey);
		const yearly = wm === null && spanMonths > 36;
		const start = yearly ? minKey.slice(0, 4) : window === 'all' ? minKey : (startKey as string);
		const end = yearly ? maxKey.slice(0, 4) : window === 'all' ? maxKey : nowKey;
		let cum = 0;
		for (let k = start; ; k = yearly ? String(Number(k) + 1) : shiftMonth(k, 1)) {
			const count = yearly
				? [...perKey.entries()].reduce((sum, [key, c]) => (key.startsWith(`${k}-`) ? sum + c : sum), 0)
				: perKey.get(k) ?? 0;
			cum += count;
			const labels = yearly ? { full: k, short: k } : monthLabel(k);
			timeline.push({ key: k, label: labels.full, tick_label: labels.short, tick: false, count, cumulative: cum });
			if (k === end) break;
		}
		const len = timeline.length;
		timeline.forEach((b, i) => {
			b.tick =
				len <= 12 ||
				i === 0 ||
				i === len - 1 ||
				(yearly ? Number(b.key) % 5 === 0 : b.key.endsWith('-01'));
		});
	}

	/* A4 — the pace micro-stats, computed from the same rows as A1. */
	const windowed = timeline.reduce((sum, b) => sum + b.count, 0);
	const months = wm !== null ? wm : minKey && maxKey ? monthsBetween(minKey, maxKey) : 0;
	const biggest = timeline.reduce<{ label: string; count: number } | null>((best, b) => {
		if (b.count <= 0) return best;
		return !best || b.count > best.count ? { label: b.label, count: b.count } : best;
	}, null);
	let drought_weeks = 0;
	if (windowed > 0 && windowDatedMs.length) {
		const startMs = Math.min(...windowDatedMs);
		const endMs = Math.max(Date.now(), ...windowDatedMs);
		drought_weeks = longestDroughtWeeks(windowDatedMs, startMs, endMs);
	}
	const oldest_acquired = acquiredInWindow.length ? [...acquiredInWindow].sort()[0] : null;
	const pace: PaceStats = {
		label: WINDOW_LABELS[window],
		windowed,
		months,
		per_month: months > 0 ? Math.round((windowed / months) * 100) / 100 : 0,
		biggest,
		drought_weeks,
		oldest_acquired
	};

	/* C1 — most collected (top 10 artists). */
	const top_artists = (db.prepare(`
		SELECT artist AS label, COUNT(*) AS count
		FROM records
		WHERE TRIM(artist) != ''
		GROUP BY artist
	`).all() as StatBarRow[])
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
		.slice(0, ARTIST_TOP_N);

	/* Fresh wax — the most recent arrivals still on the shelf. */
	const fresh = db.prepare(`
		SELECT id, artist, title, year, cover_filename AS cover
		FROM records
		WHERE status = 'in_collection'
		ORDER BY COALESCE(acquired_at, created_at) DESC, id DESC
		LIMIT 12
	`).all() as FreshRecord[];

	/* B2 — the priciest ten (wall of fame). */
	const priciest_ten = db.prepare(`
		SELECT id, artist, title, year, price_paid AS price_cents, cover_filename AS cover
		FROM records
		WHERE status = 'in_collection' AND price_paid IS NOT NULL
		ORDER BY price_paid DESC, id
		LIMIT 10
	`).all() as PriciestRecord[];
	const priciest: PriciestRecord | null = priciest_ten[0] ?? null;

	/* B1 — spend histogram across five readable bands. */
	const price_bands = (db.prepare(`
		SELECT
			CASE
				WHEN price_paid < 1000 THEN 'Under $10'
				WHEN price_paid < 2500 THEN '$10–25'
				WHEN price_paid < 5000 THEN '$25–50'
				WHEN price_paid < 10000 THEN '$50–100'
				ELSE '$100+'
			END AS label,
			COUNT(*) AS count,
			SUM(price_paid * copies) AS value_cents,
			MIN(price_paid) AS lo
		FROM records
		WHERE status = 'in_collection' AND price_paid IS NOT NULL
		GROUP BY 1
		ORDER BY lo
	`).all() as (PriceBand & { lo: number })[]).map(({ label, count, value_cents }) => ({
		label,
		count,
		value_cents
	}));

	/* B3 — spend by source ('Unrecorded' bucket for the missing ones). */
	const by_source = (db.prepare(`
		SELECT COALESCE(NULLIF(TRIM(source), ''), 'Unrecorded') AS label,
		       COUNT(*) AS count,
		       SUM(COALESCE(price_paid, 0) * copies) AS value_cents
		FROM records
		WHERE status = 'in_collection'
		GROUP BY 1
	`).all() as ValBarRow[]).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

	/* B5 — condition × price scatter; hidden unless ≥15 graded + priced entries. */
	const scatterRaw = db.prepare(`
		SELECT condition_media AS c, price_paid, artist, title
		FROM records
		WHERE status = 'in_collection' AND price_paid IS NOT NULL AND condition_media IS NOT NULL
	`).all() as { c: string; price_paid: number; artist: string; title: string }[];
	let scatter: ScatterDot[] | null = null;
	if (scatterRaw.length >= 15) {
		scatter = scatterRaw
			.map((r) => {
				const x = CONDITIONS.indexOf(r.c as (typeof CONDITIONS)[number]);
				return x === -1
					? null
					: {
							x,
							y: r.price_paid,
							label: `${r.artist} — ${r.title} · $${(r.price_paid / 100).toFixed(2)} · ${r.c}`
					  };
			})
			.filter((d): d is ScatterDot => d !== null);
	}

	/* A3 — calendar heatmap for the current year (falls back to the most recent
	   active year when this one is empty). */
	let heatmap_year = new Date().getFullYear();
	if (![...heatmapDateCount.keys()].some((k) => k.startsWith(`${heatmap_year}-`))) {
		const latest = [...heatmapDateCount.keys()].sort().pop();
		if (latest) heatmap_year = Number(latest.slice(0, 4));
	}
	const heatmap_days: Record<string, number> = {};
	for (const [k, v] of heatmapDateCount) if (k.startsWith(`${heatmap_year}-`)) heatmap_days[k] = v;

	/* C2 — format mix in the fixed spectrum order. */
	const formats = FORMAT_ORDER.map((label) => ({ label, count: formatCounts.get(label) ?? 0 })).filter(
		(r) => r.count > 0
	);

	/* C3 — condition report (paired Goldmine histograms + NM-or-better share). */
	const condAgg = (column: 'condition_media' | 'condition_sleeve') => {
		const counts: Record<string, number> = {};
		let graded = 0;
		for (const r of db.prepare(
			`SELECT ${column} AS c FROM records WHERE status = 'in_collection' AND ${column} IS NOT NULL`
		).all() as { c: string }[]) {
			counts[r.c] = (counts[r.c] ?? 0) + 1;
			graded++;
		}
		const nm = (counts['M'] ?? 0) + (counts['NM'] ?? 0);
		return { rows: conditionOrdered(counts), graded, pct: graded ? Math.round((nm / graded) * 100) : null };
	};
	const mediaCond = condAgg('condition_media');
	const sleeveCond = condAgg('condition_sleeve');
	const condition_report = {
		graded: mediaCond.graded,
		nm_or_better_pct: mediaCond.pct
	};

	/* C4 — styles under genres (deeper taste texture). */
	const by_style = topN(
		(db.prepare(`
			SELECT style AS label, COUNT(*) AS count
			FROM records
			WHERE style IS NOT NULL AND TRIM(style) != ''
			GROUP BY style
		`).all() as StatBarRow[]).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
	);

	/* C5 — genre × decade cross-tab: top 5 genres per decade + 'Other'. */
	const cross_tab: CrossTabRow[] = [...crossAgg.entries()]
		.map(([decade, genres]) => {
			const segs = [...genres.entries()].map(([label, count]) => ({ label, count }));
			segs.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
			const head = segs.slice(0, 5);
			const rest = segs.slice(5).reduce((sum, s) => sum + s.count, 0);
			return {
				decade,
				total: head.reduce((sum, s) => sum + s.count, 0) + rest,
				segments: rest > 0 ? [...head, { label: 'Other', count: rest }] : head
			};
		})
		.sort((a, b) => a.decade.localeCompare(b.decade));

	/* C6 — duplicate watch (entries keeping extra copies). */
	const dupRows = db.prepare(`
		SELECT id, artist, title, copies FROM records
		WHERE status = 'in_collection' AND copies > 1
		ORDER BY copies DESC, artist
		LIMIT 8
	`).all() as { id: number; artist: string; title: string; copies: number }[];
	const duplicates = dupRows.length
		? {
				entries: dupRows.length,
				biggest_copies: Math.max(...dupRows.map((r) => r.copies)),
				rows: dupRows
		  }
		: null;

	/* C7 — documentation coverage. */
	const photoTotal = (db.prepare('SELECT COUNT(*) AS n FROM photos').get() as { n: number }).n;
	const photoRecords = (db.prepare('SELECT COUNT(DISTINCT record_id) AS n FROM photos').get() as { n: number })
		.n;

	const windowTopGenreRows = [...windowedGenre.entries()].map(([label, count]) => ({ label, count }));
	const window_top_genre: StatBarRow | null = windowTopGenreRows.length
		? windowTopGenreRows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0]
		: null;

	/* D3 — the modal dated decade. */
	const hero_decade = (() => {
		const dated = by_decade.filter((d) => d.label !== 'Undated');
		if (!dated.length) return null;
		const top = dated.reduce((a, b) => (b.count > a.count ? b : a));
		return { label: top.label, count: top.count, share: n(headline.total) ? Math.round((top.count / n(headline.total)) * 100) : 0 };
	})();

	/* D5 — next milestone marker (powers of ten and friendly half-marks). */
	const shelf = n(headline.in_collection);
	const nextMark = MILESTONE_MARKS.find((m) => m > shelf) ?? Math.ceil((shelf + 1) / 500) * 500;

	return {
		total: n(headline.total),
		in_collection: shelf,
		sold: n(headline.sold),
		traded_away: n(headline.traded_away),
		copies_total: n(headline.copies_total),
		limited_editions: n(headline.limited_editions),
		covers_local: n(headline.covers_local),
		covers_missing: n(headline.covers_missing),
		value_cents: n(headline.value_cents),
		avg_price_cents: typeof headline.avg_price === 'number' ? Math.round(headline.avg_price) : null,
		priced_entries: n(headline.priced_entries),
		unpriced_entries: n(headline.unpriced_entries),
		by_genre: groupValRows('genre'),
		by_label: groupValRows('label'),
		by_decade,
		statuses,
		timeline,
		undated_count,
		pace,
		top_artists,
		fresh,
		priciest,
		median_year,
		window_top_genre,
		hero_decade,
		milestone: { next: nextMark, remaining: nextMark - shelf },
		price_bands,
		priciest_ten,
		by_source,
		scatter,
		heatmap_year,
		heatmap_days,
		formats,
		condition_media: mediaCond.rows,
		condition_sleeve: sleeveCond.rows,
		condition_report,
		by_style,
		cross_tab,
		duplicates,
		photos_total: photoTotal,
		records_with_photos: photoRecords,
		extremes
	};
}
