/**
 * Stand-in for SvelteKit's `$env/dynamic/private` so scripts that (transitively)
 * import server modules bundling that alias can run under plain node via an
 * esbuild bundle. Aliased with --alias:$env/dynamic/private=./scripts/env-stub.ts
 */
export const env: Record<string, string> = {};
