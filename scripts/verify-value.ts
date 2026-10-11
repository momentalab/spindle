/**
 * Verify the F7 "Value" data layer on a scratch database (never the real one):
 *   - migration v7 created `market_prices` (+ index), FK cascade intact,
 *     foreign_key_check clean,
 *   - portfolioStats(): latest-quote derivation from the append-only log,
 *     cost basis / market value / unrealized + realized P&L, gainer/loser
 *     ranking, movers since first watched (cost-agnostic), money bars,
 *     wanted rows excluded everywhere, nearest-observation missed-the-bus
 *     check on the sales ledger,
 *   - same-second observations both persist and MAX(id) still picks latest,
 *   - updateRecord form path: entering `sold` auto-stamps sold_at, leaving
 *     `sold` clears the sale pair (a record bought back is not a sale),
 *   - deleting a record cascades its price history.
 *
 * Run (bundled — value.ts pulls in discogs.ts, which needs SvelteKit's env alias;
 * the stub keeps it inert):
 *   ./node_modules/.bin/esbuild scripts/verify-value.ts --bundle --platform=node --format=cjs \
 *     "--alias:$lib=./src/lib" "--alias:$env/dynamic/private=./scripts/env-stub.ts" \
 *     --external:better-sqlite3 --outfile=.verify-value.cjs && node .verify-value.cjs; rm -f .verify-value.cjs
 */
import assert from 'node:assert';
import { mkdirSync, rmSync } from 'node:fs';

const DATA = '/tmp/spindle-value-mig/data';
rmSync('/tmp/spindle-value-mig', { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
process.env.DATA_DIR = DATA; // must precede the dynamic import (paths read env at init)

const { getDb } = await import('../src/lib/server/db');
const db = getDb(); // fresh DB — runs migrations v1..v7 on the scratch copy
const { portfolioStats, takeMarketSnapshot } = await import('../src/lib/server/value');
const { createRecord, updateRecord } = await import('../src/lib/server/records');
import type { NewRecordInput } from '../src/lib/server/records';

const fkClean = (): boolean => (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0;
const count = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
const q = (recordId: number, priceCents: number | null, at: string, forSale: number | null, discogsId: number) =>
	db
		.prepare(
			'INSERT INTO market_prices (record_id, discogs_id, price_cents, num_for_sale, fetched_at) VALUES (?, ?, ?, ?, ?)'
		)
		.run(recordId, discogsId, priceCents, forSale, at);

// --- migration ----------------------------------------------------------------
const versions = (
	db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]
).map((v) => v.version);
assert.ok(versions.includes(7), `migration v7 present (got ${versions})`);
assert.ok(
	db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_market_prices_record_id'").get() !==
		undefined,
	'market_prices index present'
);

// --- seed ---------------------------------------------------------------------
const ins = db.prepare(
	`INSERT INTO records (artist, title, year, status, discogs_id, price_paid, copies, sale_price, sold_at)
	 VALUES (@artist, @title, @year, @status, @discogs_id, @price_paid, @copies, @sale_price, @sold_at)`
);
const ids: Record<string, number> = {};
const SEED_DEFAULTS = {
	artist: '',
	title: '',
	year: null,
	status: 'in_collection',
	discogs_id: null,
	price_paid: null,
	copies: 1,
	sale_price: null,
	sold_at: null
};
function seed(name: string, p: Partial<Record<keyof typeof SEED_DEFAULTS, unknown>>): number {
	const id = Number(ins.run({ ...SEED_DEFAULTS, ...p }).lastInsertRowid);
	ids[name] = id;
	return id;
}

// 1974, Electronic — cost 2000×2; quotes 2200 → 2500 → 3000 (gainer +50%, mover +36.4%)
seed('gainer', {
	artist: 'Gain Artist',
	title: 'Rises',
	year: '1974',
	status: 'in_collection',
	discogs_id: 9001,
	price_paid: 2000,
	copies: 2
});
q(ids.gainer, 2200, '2026-08-01 09:00:00', 2, 9001);
q(ids.gainer, 2500, '2026-08-15 09:00:00', 2, 9001);
q(ids.gainer, 3000, '2026-08-30 09:00:00', 3, 9001);
db.prepare('INSERT INTO record_genres (record_id, genre) VALUES (?, ?)').run(ids.gainer, 'Electronic');

// 1985, TestLabel — cost 10000; quotes 9000 → 7500 (loser -25%, mover -16.7%)
seed('loser', {
	artist: 'Lose Artist',
	title: 'Falls',
	year: '1985',
	status: 'in_collection',
	discogs_id: 9002,
	price_paid: 10000,
	copies: 1
});
q(ids.loser, 9000, '2026-08-01 09:30:00', 1, 9002);
q(ids.loser, 7500, '2026-08-30 09:30:00', 1, 9002);
db.prepare('INSERT INTO record_labels (record_id, label, catno) VALUES (?, ?, ?)').run(ids.loser, 'TestLabel', null);

// Undated — cost 1500; quotes 1600 → NULL (latest = "no live listings")
seed('nolist', {
	artist: 'Quiet Artist',
	title: 'No Listings',
	status: 'in_collection',
	discogs_id: 9003,
	price_paid: 1500,
	copies: 1
});
q(ids.nolist, 1600, '2026-08-01 10:00:00', 1, 9003);
q(ids.nolist, null, '2026-08-30 10:00:00', null, 9003);

// Sold — paid 8000, sold for 9500 on 2026-08-20; quotes 7000 → 9200 (08-19) → 10100 (08-25)
seed('sold', {
	artist: 'Exit Artist',
	title: 'Gone',
	status: 'sold',
	discogs_id: 9004,
	price_paid: 8000,
	copies: 1,
	sale_price: 9500,
	sold_at: '2026-08-20'
});
q(ids.sold, 7000, '2026-08-01 11:00:00', 1, 9004);
q(ids.sold, 9200, '2026-08-19 11:00:00', 1, 9004);
q(ids.sold, 10100, '2026-08-25 11:00:00', 1, 9004);

// Wanted — off-shelf: must not count anywhere (cost/linked/shelf)
seed('wanted', {
	artist: 'Wanted Artist',
	title: 'Missing',
	status: 'wanted',
	discogs_id: 9005,
	price_paid: 500,
	copies: 1
});

// Unlinked shelf record — no discogs_id: cost only, market falls back to cost
seed('unlinked', {
	artist: 'Plain Artist',
	title: 'No Link',
	status: 'in_collection',
	discogs_id: null,
	price_paid: 3000,
	copies: 1
});

// Same-second pair — both must persist; MAX(id) is the latest quote.
// Unpriced: tests movers are cost-agnostic (500 → 600 = +20%).
seed('same', {
	artist: 'Twice Artist',
	title: 'Twin Stamps',
	status: 'in_collection',
	discogs_id: 9007,
	price_paid: null,
	copies: 1
});
q(ids.same, 500, '2026-09-01 08:00:00', 1, 9007);
q(ids.same, 600, '2026-09-01 08:00:00', 1, 9007);

// --- portfolioStats ------------------------------------------------------------
const s = portfolioStats();

assert.equal(s.shelf_count, 5, 'shelf = 4 priced/linked + unlinked; wanted excluded');
assert.equal(s.cost_basis_cents, 18500, 'cost basis excludes the wanted row'); // 4000+10000+1500+3000
assert.equal(s.quoted_count, 3, 'gainer + loser + same-second (nolist latest is null)');
assert.equal(s.market_value_cents, 18600, 'quoted at market, unquoted fall back to cost'); // 6000+7500+1500+3000+600
// P&L pools only rows with BOTH a live quote and a known cost — the same-second
// row (quote 600, no recorded price) must NOT count its market value as profit.
assert.equal(s.priced_count, 2, 'gainer + loser only (same-second has no known cost)');
assert.equal(s.unrealized_cents, -500, '(6000+7500) − (4000+10000) = −500');
assert.equal(s.unrealized_pct, -3.6, '(−500/14000)×100 = −3.6%');
assert.equal(s.realized_cents, 1500, 'one sale at +1500');
assert.equal(s.sales_count, 1);
assert.equal(s.linked_count, 4, 'gainer, loser, nolist, same — sold/wanted not on the shelf');
assert.equal(s.watched_count, 4);
assert.equal(s.no_listing_count, 1, 'the nolist record');
assert.equal(s.history_rows, 12, '3+2+2+3+2 observations');
assert.equal(s.first_snapshot_at, '2026-08-01 09:00:00', 'log is in insertion order (ORDER BY id)');
assert.equal(s.last_snapshot_at, '2026-09-01 08:00:00');

// gainers / losers — needs cost AND a live quote; sorted by delta.
assert.deepEqual(
	s.gainers.map((g) => [g.id, g.delta_pct]),
	[[ids.gainer, 50]],
	'gainer +50%'
);
assert.equal(s.gainers[0]?.quote_cents, 3000, 'latest quote is the MAX(id) row');
assert.equal(s.gainers[0]?.series.length, 3, 'full history rides along for the sparkline');
assert.deepEqual(
	s.losers.map((l) => [l.id, l.delta_pct]),
	[[ids.loser, -25]],
	'loser -25%'
);

// movers — since first watched, cost-agnostic; |change| desc.
assert.deepEqual(
	s.movers.map((m) => [m.id, m.change_pct]),
	[
		[ids.gainer, 36.4], // 2200 → 3000
		[ids.same, 20], // 500 → 600 (never priced — still a mover)
		[ids.loser, -16.7] // 9000 → 7500
	],
	'mover ranking'
);
assert.equal(s.movers[1]?.quote_cents, 600, 'same-second pair: latest is the second insert');
assert.ok(count('market_prices') === 12, 'same-second observations both persisted (no UNIQUE drop)');

// sales ledger — missed-the-bus picks the NEAREST priced observation to sold_at.
assert.equal(s.sales.length, 1);
const sale = s.sales[0];
assert.equal(sale.id, ids.sold);
assert.equal(sale.delta_cents, 1500);
assert.equal(sale.sold_at, '2026-08-20');
assert.deepEqual(sale.market_at_sale?.price_cents, 9200, '08-19 observation is nearer than 08-25');

// money bars.
const dec = Object.fromEntries(s.by_decade.map((d) => [d.label, d]));
assert.equal(dec['1970s']?.cost_cents, 4000);
assert.equal(dec['1970s']?.market_cents, 6000);
assert.equal(dec['1980s']?.cost_cents, 10000);
assert.equal(dec['1980s']?.market_cents, 7500);
assert.equal(dec['Undated']?.cost_cents, 4500, 'nolist 1500 + unlinked 3000; same-second never priced');
assert.equal(dec['Undated']?.market_cents, 5100, '1500 cost-fallback + 3000 unlinked + 600 quote');
assert.equal(s.by_decade[s.by_decade.length - 1]?.label, 'Undated', 'Undated sorts last');
assert.deepEqual(Object.fromEntries(s.by_genre.map((g) => [g.label, g]))['Electronic'], {
	label: 'Electronic',
	count: 1,
	cost_cents: 4000,
	market_cents: 6000
});
assert.equal(s.by_label[0]?.label, 'TestLabel');
assert.equal(s.by_label[0]?.market_cents, 7500);

// --- form path (F7 fields via updateRecord) ------------------------------------
const base: NewRecordInput = {
	discogs_id: null,
	barcode: null,
	artist: 'Back And Fourth',
	title: 'Bought Back',
	year: null,
	styles: [],
	genres: [],
	labels: [],
	format: null,
	limited_edition: false,
	condition_media: null,
	condition_sleeve: null,
	price_paid: 1200,
	acquired_at: null,
	source: null,
	status: 'in_collection',
	wanted_at: null,
	copies: 1,
	copy_number: null,
	copy_total: null,
	sale_price: null,
	sold_at: null,
	notes: null,
	cover_filename: null,
	cover_remote_url: null
};
const r8 = createRecord(base);
assert.equal(r8.sale_price, null);

const sold8 = updateRecord(r8.id, { status: 'sold', sale_price: 1500 });
assert.equal(sold8?.sale_price, 1500, 'sale price stored in cents');
assert.match(sold8?.sold_at ?? '', /^\d{4}-\d{2}-\d{2}$/, 'entering sold auto-stamps today');

const back8 = updateRecord(r8.id, { status: 'in_collection' });
assert.equal(back8?.sale_price, null, 'leaving sold clears the sale pair');
assert.equal(back8?.sold_at, null, 'leaving sold clears the date');

// --- date convention: every user-facing event date is YYYY-MM-DD ---------------
const r9 = createRecord({ ...base, status: 'wanted' });
assert.match(r9.wanted_at ?? '', /^\d{4}-\d{2}-\d{2}$/, 'create as wanted stamps date-only wanted_at');
const acq9 = updateRecord(r9.id, { status: 'in_collection' });
assert.equal(acq9?.wanted_at, null, 'acquiring clears wanted_at');
assert.match(acq9?.acquired_at ?? '', /^\d{4}-\d{2}-\d{2}$/, 'acquiring stamps date-only acquired_at');

// v7 backfill: legacy full-timestamp rows normalize to date-only so pre-existing
// records export uniform.
db.prepare('UPDATE records SET acquired_at = ? WHERE id = ?').run('2026-01-02T09:30:00.000Z', r9.id);
db.exec(
	`UPDATE records SET acquired_at = substr(acquired_at, 1, 10)
	 WHERE acquired_at IS NOT NULL AND length(acquired_at) > 10`
);
assert.equal(
	(db.prepare('SELECT acquired_at FROM records WHERE id = ?').get(r9.id) as { acquired_at: string }).acquired_at,
	'2026-01-02',
	'v7 backfill normalizes legacy ISO timestamps to date-only'
);
// The form boundary still heals too (defense in depth).
db.prepare('UPDATE records SET acquired_at = ? WHERE id = ?').run('2026-01-03T10:00:00.000Z', r9.id);
const { findRecordById } = await import('../src/lib/server/records');
const { draftFromRow } = await import('../src/lib/draft');
assert.equal(
	draftFromRow(findRecordById(r9.id)!).acquired_at,
	'2026-01-03',
	'legacy ISO also heals at the form boundary (draft dateOnly)'
);

// --- cascade -------------------------------------------------------------------
q(r8.id, 700, '2026-09-02 09:00:00', 1, 9008);
assert.equal(count('market_prices'), 13);
db.prepare('DELETE FROM records WHERE id = ?').run(r8.id);
assert.equal(count('market_prices'), 12, 'deleting a record takes its price history');
assert.ok(fkClean(), 'foreign_key_check clean');

// --- snapshot guard (offline path) ---------------------------------------------
// Simulate an unreachable network: takeMarketSnapshot must throw WITHOUT
// committing anything (the commit happens only after the whole fetch pass).
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
	throw new TypeError('fetch failed');
}) as typeof fetch;
const before = count('market_prices');
let threw: unknown = null;
try {
	await takeMarketSnapshot();
} catch (e) {
	threw = e;
} finally {
	globalThis.fetch = realFetch;
}
assert.ok(threw instanceof Error, 'snapshot throws when Discogs is unreachable');
assert.match((threw as Error).message, /Discogs/, 'thrown error names Discogs');
assert.equal(count('market_prices'), before, 'nothing committed on a failed pass');

console.log('\nAll value checks passed ✔');
console.log(
	JSON.stringify({ headline: s, movers: s.movers.map((m) => `${m.artist} ${m.change_pct}%`), sale }, null, 1)
);
