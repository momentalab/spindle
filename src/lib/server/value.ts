/**
 * The "Value" page (F7) — portfolio aggregates over records + market_prices.
 *
 * Server-only, in the style of stats.ts: prepared statements over getDb(),
 * bucketing in readable JavaScript (a personal collection is small).
 *
 * market_prices is an APPEND-ONLY log: every snapshot inserts one observation
 * per watched record; "the latest quote" is derived as the MAX(id) row per
 * record (autoincrement ⇒ insertion order). History rows are never updated or
 * rewritten — they ARE the feature (sparklines, movers since first watched,
 * the missed-the-bus check on the realized ledger).
 */
import { getDb } from '$lib/server/db';
import { DiscogsError, getMarketStats, throttleRemaining } from '$lib/server/discogs';
import type { RecordStatus } from '$lib/types';

export interface QuotePoint {
	at: string; // fetched_at, 'YYYY-MM-DD HH:MM:SS'
	price_cents: number | null; // null = "no live listings" that day (a data point)
}

/** A shelf record compared against its latest Discogs marketplace quote. */
export interface ValueRow {
	id: number;
	artist: string;
	title: string;
	year: string | null;
	cover: string | null; // cover_filename — the page renders `/media/${cover}`
	paid_cents: number | null;
	quote_cents: number | null; // latest observation's lowest listing
	num_for_sale: number | null;
	/** (quote - paid) / paid × 100, rounded to 1 decimal; null when either side is missing. */
	delta_pct: number | null;
	/** Full quote history oldest→newest (sparkline source). */
	series: QuotePoint[];
}

/** A value row whose change is measured from its FIRST priced observation, not cost. */
export interface MoverRow extends ValueRow {
	first_cents: number;
	first_at: string;
	/** (latest - first) / first × 100, rounded to 1 decimal. */
	change_pct: number;
}

/** One realized sale + what Discogs' market was doing around the day it left. */
export interface LedgerSale {
	id: number;
	artist: string;
	title: string;
	paid_cents: number | null;
	sale_cents: number | null;
	delta_cents: number; // sale - paid (nulls treated as 0)
	sold_at: string | null;
	/** Nearest observed *priced* quote to sold_at; null = never watched before it left. */
	market_at_sale: { price_cents: number; at: string } | null;
}

export interface ValueBarRow {
	label: string;
	count: number; // shelf records in the group
	cost_cents: number; // Σ price_paid × copies (priced, in_collection)
	market_cents: number; // Σ quote×copies where quoted, else cost (best-estimate value)
}

export interface ValueStats {
	/* headline */
	shelf_count: number;
	cost_basis_cents: number;
	market_value_cents: number; // quoted rows at market, unquoted priced rows at cost
	quoted_count: number; // shelf rows with a non-null latest quote
	priced_count: number; // shelf rows in the P&L pool (live quote + known cost)
	unrealized_cents: number | null; // over the P&L pool only — both sides must be known
	unrealized_pct: number | null;
	realized_cents: number; // Σ (sale - paid) over sold rows priced on both sides
	sales_count: number; // sold rows carrying a sale_price
	/* comparison strips */
	gainers: ValueRow[]; // has cost + quote, delta_pct desc, top 10
	losers: ValueRow[]; // same, delta_pct asc, top 10
	movers: MoverRow[]; // ≥2 priced observations, |change_pct| desc, top 5
	/* money-by-… bars */
	by_genre: ValueBarRow[];
	by_label: ValueBarRow[];
	by_decade: ValueBarRow[]; // ascending, "Undated" last
	/* realized ledger */
	sales: LedgerSale[]; // sold rows with sale_price, sold_at desc
	/* coverage — drives the snapshot section */
	linked_count: number; // shelf rows with a discogs_id
	watched_count: number; // shelf rows with ≥1 observation
	no_listing_count: number; // latest observation says "no live listings"
	first_snapshot_at: string | null;
	last_snapshot_at: string | null;
	history_rows: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TOP_N = 10;
const MOVER_TOP_N = 5;

interface ShelfRow {
	id: number;
	discogs_id: number | null;
	artist: string;
	title: string;
	year: string | null;
	status: RecordStatus;
	price_paid: number | null;
	copies: number;
	cover_filename: string | null;
	sale_price: number | null;
	sold_at: string | null;
}

interface QuoteRow {
	id: number;
	record_id: number;
	discogs_id: number;
	price_cents: number | null;
	num_for_sale: number | null;
	fetched_at: string;
}

interface GroupCell {
	count: number;
	cost_cents: number;
	market_cents: number;
}

/** "1974" → 1974 (unparsable/out of range → null) — same convention as stats.ts. */
function parseYear(year: string | null): number | null {
	if (!year) return null;
	const m = /^(\d{4})/.exec(year.trim());
	if (!m) return null;
	const y = Number(m[1]);
	return y >= 1900 && y <= 2100 ? y : null;
}

function decadeOf(year: string | null): string {
	const y = parseYear(year);
	return y === null ? 'Undated' : `${Math.floor(y / 10) * 10}s`;
}

/** (to - from) / from × 100, rounded to 1 decimal. Callers guarantee from > 0. */
function pctChange(from: number, to: number): number {
	return Math.round(((to - from) / from) * 1000) / 10;
}

/** 'YYYY-MM-DD…' → UTC ms (local-calendar day, same convention as stats.ts). */
function dateUtc(s: string): number {
	const [y, m, d] = s.split('-').map(Number);
	return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

/** Per-record quote state accumulated from the id-ordered observation log. */
interface QuoteState {
	latest: QuoteRow | null;
	firstPriced: QuoteRow | null;
	points: QuotePoint[]; // oldest→newest
	pricedSeries: QuoteRow[]; // priced observations only (movers)
}

/** The observed *priced* quote whose fetched_at is closest to `soldAt` (same-day ties: any). */
function nearestObservation(st: QuoteState | null, soldAt: string | null): { price_cents: number; at: string } | null {
	if (!st || !soldAt) return null;
	const target = dateUtc(soldAt.slice(0, 10));
	let best: { price_cents: number; at: string } | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const p of st.points) {
		if (p.price_cents === null) continue;
		const dist = Math.abs(Math.floor((dateUtc(p.at.slice(0, 10)) - target) / 86_400_000));
		if (dist < bestDist) {
			bestDist = dist;
			best = { price_cents: p.price_cents, at: p.at };
		}
	}
	return best;
}

function barsOf(agg: Map<string, GroupCell>, undatedLast: boolean): ValueBarRow[] {
	const rows = [...agg.entries()].map(([label, c]) => ({
		label,
		count: c.count,
		cost_cents: c.cost_cents,
		market_cents: c.market_cents
	}));
	if (undatedLast) {
		rows.sort((a, b) =>
			a.label === 'Undated' ? 1 : b.label === 'Undated' ? -1 : a.label.localeCompare(b.label)
		);
	} else {
		rows.sort((a, b) => b.market_cents - a.market_cents || a.label.localeCompare(b.label));
	}
	return rows;
}

/**
 * Read every record plus its quote state in two full-table passes and compute
 * all ValueStats. Pure read — no writes, safe to call on SSR.
 */
export function portfolioStats(): ValueStats {
	const db = getDb();

	const rows = db
		.prepare(
			`SELECT id, discogs_id, artist, title, year, status, price_paid, copies,
			        cover_filename, sale_price, sold_at
			 FROM records`
		)
		.all() as ShelfRow[];

	const quotes = db
		.prepare(
			`SELECT id, record_id, discogs_id, price_cents, num_for_sale, fetched_at
			 FROM market_prices ORDER BY id`
		)
		.all() as QuoteRow[];

	/* Quote state per record (the log arrives in id order). */
	const quoteByRecord = new Map<number, QuoteState>();
	for (const q of quotes) {
		const st = quoteByRecord.get(q.record_id) ?? {
			latest: null,
			firstPriced: null,
			points: [],
			pricedSeries: []
		};
		st.latest = q;
		st.points.push({ at: q.fetched_at, price_cents: q.price_cents });
		if (q.price_cents !== null) {
			if (!st.firstPriced) st.firstPriced = q;
			st.pricedSeries.push(q);
		}
		quoteByRecord.set(q.record_id, st);
	}

	/* Genre/label sets per record for the money bars (junction tables). */
	const genresByRecord = new Map<number, string[]>();
	for (const g of db.prepare('SELECT record_id, genre FROM record_genres').all() as {
		record_id: number;
		genre: string;
	}[]) {
		const list = genresByRecord.get(g.record_id) ?? [];
		list.push(g.genre);
		genresByRecord.set(g.record_id, list);
	}
	const labelsByRecord = new Map<number, string[]>();
	for (const l of db.prepare('SELECT record_id, label FROM record_labels').all() as {
		record_id: number;
		label: string;
	}[]) {
		const list = labelsByRecord.get(l.record_id) ?? [];
		list.push(l.label);
		labelsByRecord.set(l.record_id, list);
	}

	let shelf_count = 0;
	let cost_basis_cents = 0;
	let market_value_cents = 0;
	let quoted_count = 0;
	let unrealized_cost_cents = 0; // cost of the P&L subset (quoted + known cost)
	let priced_count = 0; // shelf records counted in the P&L pool
	let unrealized_market_cents = 0; // market of the same subset
	let realized_cents = 0;
	let sales_count = 0;
	let linked_count = 0;
	let watched_count = 0;
	let no_listing_count = 0;

	const ranked: (ValueRow & { _delta: number })[] = [];
	const moverCandidates: MoverRow[] = [];
	const sales: LedgerSale[] = [];

	const genreAgg = new Map<string, GroupCell>();
	const labelAgg = new Map<string, GroupCell>();
	const decadeAgg = new Map<string, GroupCell>();

	function bumpGroup(agg: Map<string, GroupCell>, label: string, cost: number, market: number): void {
		const cell = agg.get(label) ?? { count: 0, cost_cents: 0, market_cents: 0 };
		cell.count++;
		cell.cost_cents += cost;
		cell.market_cents += market;
		agg.set(label, cell);
	}

	for (const r of rows) {
		if (r.status === 'wanted') continue; // off-shelf — never counts toward value
		const st = quoteByRecord.get(r.id) ?? null;

		if (r.status !== 'in_collection') {
			/* sold / traded_away — the realized side. */
			if (r.status === 'sold' && r.sale_price !== null) {
				sales_count++;
				const delta = (r.sale_price ?? 0) - (r.price_paid ?? 0);
				realized_cents += delta;
				sales.push({
					id: r.id,
					artist: r.artist,
					title: r.title,
					paid_cents: r.price_paid,
					sale_cents: r.sale_price,
					delta_cents: delta,
					sold_at: r.sold_at,
					market_at_sale: nearestObservation(st, r.sold_at)
				});
			}
			continue;
		}

		/* ---- in_collection: the shelf ---- */
		shelf_count++;
		if (r.discogs_id) linked_count++;
		if (st && st.points.length > 0) watched_count++;

		const cost = (r.price_paid ?? 0) * r.copies;
		cost_basis_cents += cost;

		const quote = st?.latest ?? null;
		let market: number;
		if (quote && quote.price_cents !== null) {
			quoted_count++;
			market = quote.price_cents * r.copies;
			// P&L pools only what it can actually measure: a gain/loss needs BOTH
			// sides. Quoting a record whose cost you never recorded would count
			// its full market price as profit — so unknown-cost rows stay out of
			// the unrealized pool (they still show in market value and the bars).
			if (r.price_paid !== null && r.price_paid > 0) {
				priced_count++;
				unrealized_cost_cents += cost;
				unrealized_market_cents += market;
			}
		} else {
			market = cost; // best estimate: still worth what you paid
			if (quote && quote.price_cents === null) no_listing_count++;
		}
		market_value_cents += market;

		/* Gainer/loser candidate — needs a positive cost and a live quote. */
		if (r.price_paid !== null && r.price_paid > 0 && quote && quote.price_cents !== null) {
			const delta_pct = pctChange(r.price_paid, quote.price_cents);
			ranked.push({
				id: r.id,
				artist: r.artist,
				title: r.title,
				year: r.year,
				cover: r.cover_filename,
				paid_cents: r.price_paid,
				quote_cents: quote.price_cents,
				num_for_sale: quote.num_for_sale,
				delta_pct,
				series: st!.points,
				_delta: delta_pct
			});
		}

		/* Mover candidate — market drift since first watched, cost-agnostic. */
		if (st && st.pricedSeries.length >= 2) {
			const first = st.pricedSeries[0];
			const last = st.pricedSeries[st.pricedSeries.length - 1];
			if (first.price_cents !== null && last.price_cents !== null && first.price_cents > 0) {
				moverCandidates.push({
					id: r.id,
					artist: r.artist,
					title: r.title,
					year: r.year,
					cover: r.cover_filename,
					paid_cents: r.price_paid,
					quote_cents: last.price_cents,
					num_for_sale: last.num_for_sale,
					delta_pct:
						r.price_paid !== null && r.price_paid > 0 ? pctChange(r.price_paid, last.price_cents) : null,
					series: st.points,
					first_cents: first.price_cents,
					first_at: first.fetched_at,
					change_pct: pctChange(first.price_cents, last.price_cents)
				});
			}
		}

		/* Money bars — every group the record carries (a set per record). */
		for (const g of genresByRecord.get(r.id) ?? []) bumpGroup(genreAgg, g, cost, market);
		for (const l of labelsByRecord.get(r.id) ?? []) bumpGroup(labelAgg, l, cost, market);
		bumpGroup(decadeAgg, decadeOf(r.year), cost, market);
	}

	ranked.sort((a, b) => a._delta - b._delta || a.artist.localeCompare(b.artist)); // asc
	const strip = (top: (ValueRow & { _delta: number })[]): ValueRow[] =>
		top.map(({ _delta: _d, ...row }) => row);
	const gainers = strip([...ranked].reverse().filter((c) => c._delta > 0).slice(0, TOP_N));
	const losers = strip(ranked.filter((c) => c._delta < 0).slice(0, TOP_N));

	const movers: MoverRow[] = [...moverCandidates]
		.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct) || a.artist.localeCompare(b.artist))
		.slice(0, MOVER_TOP_N);

	sales.sort((a, b) => (b.sold_at ?? '').localeCompare(a.sold_at ?? ''));

	return {
		shelf_count,
		cost_basis_cents,
		market_value_cents,
		quoted_count,
		priced_count,
		unrealized_cents: priced_count > 0 ? unrealized_market_cents - unrealized_cost_cents : null,
		unrealized_pct:
			priced_count > 0 && unrealized_cost_cents > 0
				? pctChange(unrealized_cost_cents, unrealized_market_cents)
				: null,
		realized_cents,
		sales_count,
		gainers,
		losers,
		movers,
		by_genre: barsOf(genreAgg, false),
		by_label: barsOf(labelAgg, false),
		by_decade: barsOf(decadeAgg, true),
		sales,
		linked_count,
		watched_count,
		no_listing_count,
		first_snapshot_at: quotes.length ? quotes[0].fetched_at : null,
		last_snapshot_at: quotes.length ? quotes[quotes.length - 1].fetched_at : null,
		history_rows: quotes.length
	};
}

/* ------------------------------------------------------------------ */
/* Snapshot — one observation per shelf record with a discogs_id       */
/* ------------------------------------------------------------------ */

export interface SnapshotResult {
	attempted: number;
	recorded: number; // observations committed (including "no live listings")
	no_listing: number; // of those, ones where the market was empty
	errors: string[]; // per-release failures (e.g. 404) — not fatal
}

/**
 * Budget for one snapshot pass, in API calls. Stays well under the 60/min
 * authenticated tier (and a generous slice of the 25 unauthenticated), and
 * leaves headroom for scans/imports that may share the same window.
 */
const SNAPSHOT_BUDGET = 45;

/**
 * Fetch one marketplace observation per in_collection record with a discogs_id,
 * oldest-seen-first, and APPEND them all to market_prices in one transaction.
 *
 * Sequential by design: the module throttle in discogs.ts already waits out
 * windows, and parallel fetches would burn 60/min on this page alone.
 * Per-release failures (404 etc.) are collected and reported; a network-level
 * DiscogsError (offline) aborts the pass BEFORE anything is committed and is
 * rethrown for the route to surface as a Banner — local-first, no half state.
 */
export async function takeMarketSnapshot(): Promise<SnapshotResult> {
	const db = getDb();

	/* Candidates: shelf rows linked to Discogs, ordered by oldest last-observation
	   first — never-watched records lead, then the stalest — so repeated snapshots
	   rotate coverage across the shelf instead of re-pricing the same head. */
	const candidates = (
		db
			.prepare(
				`SELECT r.id AS id, r.discogs_id AS discogs_id
				 FROM records r
				 WHERE r.status = 'in_collection' AND r.discogs_id IS NOT NULL
				 ORDER BY
				         (SELECT MAX(mp.id) FROM market_prices mp WHERE mp.record_id = r.id) IS NULL DESC,
				         COALESCE((SELECT MAX(mp.fetched_at) FROM market_prices mp WHERE mp.record_id = r.id), '') ASC
			`
			)
			.all() as { id: number; discogs_id: number }[]
	).slice(0, SNAPSHOT_BUDGET);

	const result: SnapshotResult = { attempted: 0, recorded: 0, no_listing: 0, errors: [] };
	type Pending = [id: number, discogsId: number, price: number | null, forSale: number | null];
	const pending: Pending[] = [];
	const insert = db.prepare(
		'INSERT INTO market_prices (record_id, discogs_id, price_cents, num_for_sale) VALUES (?, ?, ?, ?)'
	);

	for (const c of candidates) {
		result.attempted++;
		try {
			const stats = await getMarketStats(c.discogs_id);
			if (stats.price_cents === null) result.no_listing++;
			pending.push([c.id, c.discogs_id, stats.price_cents, stats.num_for_sale]);
		} catch (e) {
			if (e instanceof DiscogsError && e.status === null) {
				// Network unreachable — abort before committing anything.
				throw new DiscogsError('Could not reach Discogs — no prices recorded this pass.', null);
			}
			result.errors.push(`id ${c.id} (Discogs ${c.discogs_id}): ${e instanceof Error ? e.message : String(e)}`);
		}
		/* Stop before the wall: throttleRemaining() is post-call, so 1 left means
		   one more request would land exactly at zero — keep the margin. */
		if (throttleRemaining() <= 1) break;
	}

	if (pending.length) {
		const commit = db.transaction(() => {
			for (const [id, discogsId, price, forSale] of pending) insert.run(id, discogsId, price, forSale);
		});
		commit();
	}
	result.recorded = pending.length;
	return result;
}
