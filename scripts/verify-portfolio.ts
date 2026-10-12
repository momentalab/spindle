/**
 * Verify the portfolio history + per-record market log on a scratch database
 * (never the real one):
 *   - portfolioHistory(): monthly grid from first shelf month to now,
 *     cumulative worth (latest-quote-else-cost) / invested (cost) / count,
 *     sold records leaving in their sale month, wanted rows excluded,
 *     undated records attributed to created_at, copies multiplied,
 *     empty collection → empty history,
 *   - recordMarket(): id-ordered log, priced-only trendline subset,
 *     latest / first / last derived stats, change_pct since first priced,
 *     isolation per record.
 *
 * Run (bundled with rolldown — vite 8 no longer ships esbuild; value.ts pulls in
 * discogs.ts, which needs SvelteKit's env alias; the stub keeps it inert).
 * DATA_DIR is set on the command line because paths.ts reads it at module init,
 * which in an ESM bundle runs before this file's own statements:
 *   node --input-type=module -e 'import { rolldown } from "rolldown";import { resolve } from "node:path";const a={name:"alias",resolveId(s){if(s==="\u0024env/dynamic/private")return resolve("scripts/env-stub.ts");if(s.startsWith("\u0024lib/"))return resolve("src/lib/"+s.slice(5)+".ts");return null}};const b=await rolldown({input:"scripts/verify-portfolio.ts",plugins:[a],external:["better-sqlite3"]});await b.write({format:"esm",file:".verify-portfolio.mjs",codeSplitting:false})' \
 *     && DATA_DIR=.scratch/verify-portfolio/data node .verify-portfolio.mjs; rm -f .verify-portfolio.mjs
 */
import assert from 'node:assert';
import { mkdirSync } from 'node:fs';

// Project-local scratch dir (gitignored) — works under sandboxed shells where
// /tmp writes may be refused. Nothing is unlinked; previous runs are cleared by
// truncating the tables.
const DATA = '.scratch/verify-portfolio/data';
process.env.DATA_DIR = DATA; // also covers unbundled runs where import order is ours
mkdirSync(DATA, { recursive: true });

const { getDb } = await import('../src/lib/server/db');
const db = getDb(); // scratch DB — migrations are idempotent
if (!db.name.includes('.scratch/verify-portfolio')) {
	throw new Error(`refusing to run outside the scratch dir (opened ${db.name})`);
}
db.exec('DELETE FROM market_prices; DELETE FROM records;'); // stale rows from a previous run
const { portfolioHistory, recordMarket } = await import('../src/lib/server/value');

/* ---- month math (same convention as value.ts: local calendar months) ---- */
function monthIndex(offsetFromNow: number): { idx: number; y: number; m: number; key: string } {
	const now = new Date();
	const idx = now.getFullYear() * 12 + now.getMonth() + offsetFromNow;
	const y = Math.floor(idx / 12);
	const m = idx % 12;
	return { idx, y, m, key: `${y}-${String(m + 1).padStart(2, '0')}` };
}
function dateInMonth(offsetFromNow: number, day: number): string {
	const now = new Date();
	return new Date(Date.UTC(now.getFullYear(), now.getMonth() + offsetFromNow, day)).toISOString().slice(0, 10);
}

const NOW_KEY = monthIndex(0).key;
const M9 = monthIndex(-9);

// --- seed ---------------------------------------------------------------------
const ins = db.prepare(
	`INSERT INTO records (artist, title, status, discogs_id, price_paid, copies, acquired_at, sold_at)
	 VALUES (@artist, @title, @status, @discogs_id, @price_paid, @copies, @acquired_at, @sold_at)`
);
function seed(
	name: string,
	p: {
		artist?: string;
		status?: string;
		discogs_id?: number | null;
		price_paid?: number | null;
		copies?: number;
		acquired_at?: string | null;
		sold_at?: string | null;
	}
): number {
	const id = Number(
		ins.run({
			artist: p.artist ?? `${name} Artist`,
			title: name,
			status: p.status ?? 'in_collection',
			discogs_id: p.discogs_id ?? null,
			price_paid: p.price_paid ?? null,
			copies: p.copies ?? 1,
			acquired_at: p.acquired_at ?? null,
			sold_at: p.sold_at ?? null
		}).lastInsertRowid
	);
	ids[name] = id;
	return id;
}
const ids: Record<string, number> = {};

// E is seeded FIRST — a wanted-only collection must produce an empty history.
seed('E', { artist: 'Wanted Artist', status: 'wanted', price_paid: 500, acquired_at: dateInMonth(-3, 10) });
const empty = portfolioHistory();
assert.equal(empty.points.length, 0, 'wanted-only collection → no points');
assert.equal(empty.records, 0);
assert.equal(empty.has_quotes, false);

// A — in 5 months, cost 1000×2, quotes 500 → null → 600 (worth = 600×2)
seed('A', { discogs_id: 9001, price_paid: 1000, copies: 2, acquired_at: dateInMonth(-5, 5) });
q(ids.A, 500, dateInMonth(-3, 1) + ' 09:00:00', 2, 9001);
q(ids.A, null, dateInMonth(-2, 1) + ' 09:00:00', null, 9001);
q(ids.A, 600, dateInMonth(-1, 1) + ' 09:00:00', 3, 9001);

// B — in 3 months, cost 2500, no quote (worth falls back to cost)
seed('B', { price_paid: 2500, acquired_at: dateInMonth(-3, 20) });

// C — in 2 months, unpriced, single quote 900 (worth from market alone)
seed('C', { discogs_id: 9003, price_paid: null, acquired_at: dateInMonth(-2, 15) });
q(ids.C, 900, dateInMonth(-1, 2) + ' 10:00:00', 1, 9003);

// D — in 4 months, sold in month -1 (mid-month): on the books through end of -2
seed('D', { price_paid: 500, acquired_at: dateInMonth(-4, 10), status: 'sold', sold_at: dateInMonth(-1, 15) });

// F — undated: attributed to created_at (now) → enters the current month only
seed('F', { price_paid: 300, acquired_at: null });

// G — in 8 months… can't (grid starts at A's -5). Use a deeper past record.
seed('G', { price_paid: 700, acquired_at: dateInMonth(-9, 1), status: 'traded_away', sold_at: dateInMonth(-7, 20) });

function q(recordId: number, priceCents: number | null, at: string, forSale: number | null, discogsId: number) {
	db.prepare(
		'INSERT INTO market_prices (record_id, discogs_id, price_cents, num_for_sale, fetched_at) VALUES (?, ?, ?, ?, ?)'
	).run(recordId, discogsId, priceCents, forSale, at);
}

// --- portfolioHistory -----------------------------------------------------------
const pf = portfolioHistory();

assert.equal(pf.points.length, 10, 'grid spans -9..0 = ten months');
assert.equal(pf.points[0]?.key, M9.key, 'grid starts at the first shelf month (G, -9)');
assert.equal(pf.points[pf.points.length - 1]?.key, NOW_KEY, 'grid ends at the current month');
assert.equal(pf.has_quotes, true, 'quotes exist');

const at = (offset: number) => pf.points.find((p) => p.key === monthIndex(offset).key);

// Month -8: only G on the books.
assert.deepEqual([at(-8)?.worth_cents, at(-8)?.invested_cents, at(-8)?.count], [700, 700, 1], 'month -8: G alone');
// Month -7: G sold (leaves in its sale month), A/B/C/D/F not in yet.
assert.deepEqual(
	[at(-7)?.worth_cents, at(-7)?.invested_cents, at(-7)?.count],
	[0, 0, 0],
	"month -7: between G's exit and A's entry the shelf is empty"
);
// Month -5: A alone — unquoted so far, worth falls back to cost.
assert.deepEqual(
	[at(-5)?.worth_cents, at(-5)?.invested_cents, at(-5)?.count],
	[2000, 2000, 1],
	'month -5: A enters unquoted (cost mark)'
);
// Month -4: D joins; both still unquoted.
assert.deepEqual(
	[at(-4)?.worth_cents, at(-4)?.invested_cents, at(-4)?.count],
	[2500, 2500, 2],
	'month -4: A + D at cost marks'
);
// Month -3: B joins; A marked at its first quote (500, this month) ×2.
assert.deepEqual(
	[at(-3)?.worth_cents, at(-3)?.invested_cents, at(-3)?.count],
	[4000, 5000, 3],
	'month -3: A quote-marked, B + D at cost'
);
// Month -2: C joins (unquoted, no cost → worth 0); A's null-quote day keeps the 500 mark.
assert.deepEqual(
	[at(-2)?.worth_cents, at(-2)?.invested_cents, at(-2)?.count],
	[4000, 5000, 4],
	"month -2: A+B+C+D before D's sale month"
);
// Month -1: D has left.
assert.deepEqual(
	[at(-1)?.worth_cents, at(-1)?.invested_cents, at(-1)?.count],
	[4600, 4500, 3],
	'month -1: D gone in its sale month'
);
// Now: A + B + C + F (undated enters via created_at).
assert.equal(pf.current_worth_cents, 4900, 'current worth = 1200+2500+900+300');
assert.equal(pf.current_invested_cents, 4800, 'current invested = 2000+2500+0+300');
assert.equal(pf.net_cents, 100, 'net = worth − invested');
assert.equal(pf.records, 4, 'on the shelf now: A, B, C, F (wanted E never counted)');

// ms values land on month ends.
const lastP = pf.points[pf.points.length - 1];
const nd = new Date();
assert.equal(new Date(lastP.ms).getFullYear(), nd.getFullYear());
assert.equal(new Date(lastP.ms).getMonth() + 1, nd.getMonth() + 1, 'last point ms = end of the current month (local)');

// --- recordMarket ---------------------------------------------------------------
const mA = recordMarket(ids.A);
assert.equal(mA.points.length, 3, 'full log including the null-price day');
assert.equal(mA.priced_points.length, 2, 'trendline source is priced observations only');
assert.equal(mA.latest?.price_cents, 600, 'latest = last row of the id-ordered log');
assert.equal(mA.latest?.num_for_sale, 3);
assert.equal(mA.first_priced?.price_cents, 500);
assert.equal(mA.last_priced?.price_cents, 600);
assert.equal(mA.change_pct, 20, '(600−500)/500 = +20%');

const mC = recordMarket(ids.C);
assert.equal(mC.points.length, 1);
assert.equal(mC.change_pct, null, 'a single priced point has no change to measure');

const mB = recordMarket(ids.B);
assert.equal(mB.points.length, 0, "unwatched record → empty log (other records' quotes stay out)");
assert.equal(mB.latest, null);

console.log('\nAll portfolio checks passed ✔');
console.log(
	JSON.stringify(
		{
			grid: [pf.points[0]?.key, pf.points[pf.points.length - 1]?.key],
			now: {
				worth: pf.current_worth_cents,
				invested: pf.current_invested_cents,
				net: pf.net_cents,
				records: pf.records
			}
		},
		null,
		1
	)
);
