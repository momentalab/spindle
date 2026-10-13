/**
 * CI runner for the verification scripts (`npm test`).
 *
 * Runs the current-logic subset of scripts/*.ts: bundle each with
 * scripts/verify-bundle.mjs, execute it, remove the bundle. A failing script
 * does not stop the run — everything runs, failures are summarized at the end,
 * and the exit code is 1 if any failed.
 *
 * Not in this list (and why):
 *   verify-*-migration.ts (copies, genre, settings, style-label, tracks, wishlist)
 *     — one-off historical migrations; verified at write-up, not re-run on every PR
 *   backup-seed.mjs + backup-roundtrip.mjs — need a running production build (manual)
 *   verify-stats-s1.ts — deliberately reads the REAL database (read-only)
 *   env-stub.ts / verify-bundle.mjs — bundler infra, not tests
 *
 * DATA_DIR: the scripts that set it themselves do so at top level before their
 * dynamic imports. smoke-db.ts predates that pattern (static imports — paths.ts
 * reads the env at module init), so its scratch dir must come from the
 * environment; same value `npm run smoke:db` uses.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import process from 'node:process';

const SCRIPTS = [
	['smoke-db.ts', '.scratch/smoke-db/data'],
	['verify-catalogue.ts'],
	['verify-portfolio.ts'],
	['verify-value-snapshot.ts'],
	['verify-value.ts']
];

const failures = [];

for (const [name, dataDir] of SCRIPTS) {
	const bundle = `.${name.replace('.ts', '')}.mjs`;
	console.log(`\n=== ${name} ===`);
	const env = dataDir ? { ...process.env, DATA_DIR: dataDir } : process.env;

	const bundled = spawnSync(process.execPath, ['scripts/verify-bundle.mjs', `scripts/${name}`, bundle], {
		env,
		stdio: 'inherit'
	});
	if (bundled.status === 0) {
		const ran = spawnSync(process.execPath, [bundle], { env, stdio: 'inherit' });
		if (ran.status !== 0) failures.push({ name, step: 'run', code: ran.status });
	} else {
		failures.push({ name, step: 'bundle', code: bundled.status });
	}
	rmSync(bundle, { force: true });
}

console.log(`\n=== ${failures.length === 0 ? `all ${SCRIPTS.length} scripts passed` : 'FAILURES'} ===`);
for (const f of failures) console.log(`  FAIL  ${f.name} (${f.step}, exit ${f.code})`);
process.exit(failures.length === 0 ? 0 : 1);
