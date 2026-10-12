/**
 * Bundler for the verify-*.ts scripts (house pattern).
 *
 * Those scripts import server modules that use SvelteKit aliases ($lib,
 * $env/dynamic/private) plus native deps (better-sqlite3, sharp), so they can't
 * run under plain node. This bundles one with rolldown — already a project
 * dependency (esbuild is not installed in this environment):
 *
 *   node scripts/verify-bundle.mjs scripts/verify-catalogue.ts .verify-catalogue.mjs \
 *     && node .verify-catalogue.mjs; rm -f .verify-catalogue.mjs
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { rolldown } from 'rolldown';

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
	console.error('usage: node scripts/verify-bundle.mjs <entry.ts> <outfile.mjs>');
	process.exit(1);
}
const root = process.cwd();

// Node loads these fine on its own (native modules stay out of the bundle; the
// CJS ones — archiver, pdfkit — also dodge ESM interop shims).
const EXTERNAL = new Set(['better-sqlite3', 'sharp', 'archiver', 'pdfkit']);

const bundle = await rolldown({
	input: path.resolve(root, entry),
	external: (id) => EXTERNAL.has(id) || id.startsWith('node:') || builtinModules.includes(id),
	plugins: [
		{
			name: 'spindle-verify-alias',
			resolveId(id) {
				if (id === '$env/dynamic/private') return path.join(root, 'scripts', 'env-stub.ts');
				if (id === '$lib' || id.startsWith('$lib/')) {
					const base = path.join(root, 'src', 'lib', id.slice(4));
					if (existsSync(base + '.ts')) return base + '.ts'; // rolldown won't probe for .ts itself
					if (existsSync(path.join(base, 'index.ts'))) return path.join(base, 'index.ts');
					return base;
				}
				return null;
			}
		}
	]
});
// ESM output — the scripts use top-level await, which rolldown can't wrap in CJS.
// codeSplitting: false keeps the single entry self-contained (the scripts' lazy
// `await import()`s are just for post-env-init ordering, not real code-splitting).
const { output } = await bundle.generate({ format: 'esm', codeSplitting: false });
await writeFile(path.resolve(root, outfile), output[0].code);
