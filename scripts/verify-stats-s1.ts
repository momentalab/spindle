/**
 * Throwaway verification for the stats graph suite — bundles like smoke:db,
 * prints the aggregates against the real (read-only) database.
 * Run: ./node_modules/.bin/esbuild scripts/verify-stats-s1.ts --bundle --platform=node \
 *        --format=cjs "--alias:$lib=./src/lib" --external:better-sqlite3 --outfile=.verify.cjs \
 *        && node .verify.cjs; rm -f .verify.cjs
 */
import { collectionStats } from '$lib/server/stats';

function show(label: string, v: unknown) {
	console.log(`\n=== ${label} ===`);
	console.log(JSON.stringify(v, null, 1));
}

for (const w of ['all', '24m', '12m'] as const) {
	const s = collectionStats(w);
	show(`window=${w}`, {
		total: s.total,
		in_collection: s.in_collection,
		timeline_len: s.timeline.length,
		timeline_first: s.timeline[0] ?? null,
		timeline_last: s.timeline[s.timeline.length - 1] ?? null,
		cum_matches_sum:
			s.timeline[s.timeline.length - 1]?.cumulative ===
			s.timeline.reduce((a, b) => a + b.count, 0),
		windowed_sum: s.pace.windowed,
		undated_count: s.undated_count,
		pace: s.pace,
		top_artists: s.top_artists.slice(0, 3),
		fresh: s.fresh.length,
		priciest: s.priciest ? `${s.priciest.artist} — ${s.priciest.title} @${s.priciest.price_cents}` : null,
		median_year: s.median_year,
		window_top_genre: s.window_top_genre,
		hero_decade: s.hero_decade,
		milestone: s.milestone,
		price_bands: s.price_bands,
		unpriced_entries: s.unpriced_entries,
		priciest_ten: s.priciest_ten.length,
		by_source: s.by_source.slice(0, 3),
		scatter_dots: s.scatter?.length ?? null,
		heatmap_year: s.heatmap_year,
		heatmap_days_shown: Object.keys(s.heatmap_days).length,
		formats: s.formats,
		condition_media: s.condition_media,
		condition_sleeve: s.condition_sleeve,
		condition_report: s.condition_report,
		by_style: s.by_style.slice(0, 3),
		cross_tab: s.cross_tab.map((r) => ({
			decade: r.decade,
			total: r.total,
			top: r.segments[0] ?? null
		})),
		duplicates: s.duplicates,
		photos_total: s.photos_total,
		records_with_photos: s.records_with_photos,
		extremes: s.extremes,
		by_genre_val: s.by_genre.slice(0, 2)
	});
}
