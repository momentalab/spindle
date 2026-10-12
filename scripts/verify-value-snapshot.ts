/**
 * Verify hasTodaySnapshot() on a scratch database (never the real one):
 *   - an empty price log reports no snapshot for today,
 *   - an observation from a previous local day does not count as today's,
 *   - an observation stored with the app's default UTC timestamp counts for
 *     today (fetched_at is UTC text; the check normalizes to the local calendar).
 *
 * Run (bundled — server modules pull in SvelteKit aliases; the stub keeps them inert):
 *   node scripts/verify-bundle.mjs scripts/verify-value-snapshot.ts .verify-value-snap.mjs \
 *     && DATA_DIR=.scratch/verify-value-snap/data node .verify-value-snap.mjs; rm -f .verify-value-snap.mjs
 */
import assert from 'node:assert';
import { mkdirSync, rmSync } from 'node:fs';

const SCRATCH = '.scratch/verify-value-snap';
const DATA = `${SCRATCH}/data`;
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
// Must precede the dynamic import: paths.ts reads DATA_DIR at module init.
process.env.DATA_DIR = DATA;

const { getDb } = await import('../src/lib/server/db');
const db = getDb(); // fresh DB — runs migrations on the scratch copy
// Belt and braces against a missing env var silently pointing at ./data:
assert.ok(db.name.includes('verify-value-snap'), `opened the scratch DB (got ${db.name})`);

const { hasTodaySnapshot } = await import('../src/lib/server/value');

// A record to anchor the price rows on (market_prices.record_id is an FK).
const recId = db
	.prepare(`INSERT INTO records (artist, title, status) VALUES ('Snap Artist', 'Snap Album', 'in_collection')`)
	.run().lastInsertRowid as number;

assert.strictEqual(hasTodaySnapshot(), false, 'empty log: no snapshot today');

// A row from the previous local day does NOT count as today's.
db.prepare(
	"INSERT INTO market_prices (record_id, discogs_id, price_cents, fetched_at) VALUES (?, 42, 999, datetime('now', 'localtime', '-1 day'))"
).run(recId);
assert.strictEqual(hasTodaySnapshot(), false, "yesterday's observation is not today's snapshot");

// A row stored the way the app stores it (default UTC timestamp) counts for today.
db.prepare('INSERT INTO market_prices (record_id, discogs_id, price_cents) VALUES (?, 42, 1234)').run(recId);
assert.strictEqual(hasTodaySnapshot(), true, 'an observation with the default UTC timestamp counts for today');

console.log('✓ hasTodaySnapshot: all assertions passed');
