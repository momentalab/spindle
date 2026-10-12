<script lang="ts">
	import type { CatalogueCover } from '$lib/server/catalogue';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The page renders the shared page model straight through — the same
	// wrapped lines and spec rows the PDF/image exports draw, so all three
	// surfaces read identically.
	const entries = $derived(data.cat.pages.flatMap((p) => p.entries));

	function coverSrc(cover: CatalogueCover): string | null {
		if (cover.kind === 'local') return `/media/${cover.filename}`;
		if (cover.kind === 'remote') return cover.url;
		return null;
	}
</script>

<svelte:head>
	<title>Catalogue — spindle</title>
</svelte:head>

<div class="cat">
	<!-- Screen-only chrome: the page itself is the artifact. -->
	<div class="toolbar no-print">
		<a href="/" class="back">← Collection</a>
		<button type="button" class="print-btn" onclick={() => window.print()}>Print / save as PDF</button>
	</div>

	<header class="masthead">
		<div class="masthead-row">
			<h1 class="wordmark">spindle</h1>
			<span class="kicker">A vinyl catalogue</span>
		</div>
		<p class="meta">{data.cat.monthYear.toUpperCase()} · {data.cat.total} RECORDS</p>
	</header>

	{#if data.cat.total === 0}
		<p class="empty">The shelf is empty — nothing to catalogue yet.</p>
	{:else}
		<ol class="grid">
			{#each entries as entry (entry.id)}
				<li class="entry">
					<span class="cover">
						{#if coverSrc(entry.cover)}
							<img src={coverSrc(entry.cover) ?? undefined} alt="" loading="lazy" />
						{:else}
							<span class="ring" aria-hidden="true"></span>
							<span class="dot" aria-hidden="true"></span>
						{/if}
					</span>
					<span class="txt">
						<span class="num">{entry.number}</span>
						<p class="title">{entry.titleLines.join('\n')}</p>
						<p class="artist">{entry.artist}</p>
						{#if entry.yearFormat}<p class="meta-line">{entry.yearFormat}</p>{/if}
						{#each entry.labelLines as line (line)}
							{#if line}<p class="meta-line">{line}</p>{/if}
						{/each}
						{#if entry.condition}<p class="meta-line faint">{entry.condition}</p>{/if}
					</span>
				</li>
			{/each}
		</ol>

		<!-- The records — the index above, then one breakdown per record,
			 sequential with a quiet rule between them. -->
		<section class="details">
			<header class="detail-head">
				<span class="d-kicker">The records</span>
			</header>
			{#each data.cat.detailPages.flatMap((p) => p.blocks) as d (d.id)}
				<article class="detail">
					<div class="detail-body">
						<span class="cover d-cover">
							{#if coverSrc(d.cover)}
								<img src={coverSrc(d.cover) ?? undefined} alt="" loading="lazy" />
							{:else}
								<span class="ring" aria-hidden="true"></span>
								<span class="dot" aria-hidden="true"></span>
							{/if}
						</span>
						<div class="d-info">
							<p class="d-title">{d.titleLines.join('\n')}</p>
							<p class="d-artist">{d.artistLines.join('\n')}</p>
							{#if d.rows.length > 0}
								<dl class="d-meta">
									{#each d.rows as row (row.label)}
										<div class="d-row">
											<dt>{row.label}</dt>
											<dd>{row.lines.join('\n')}</dd>
										</div>
									{/each}
								</dl>
							{/if}
							{#if d.notesLines.length > 0}
								<div class="d-notes">
									<p>{d.notesLines.join('\n')}</p>
								</div>
							{/if}
						</div>
					</div>
				</article>
			{/each}
		</section>
	{/if}

	<footer class="colophon">spindle · a vinyl index</footer>
</div>

<style>
	/* The catalogue is a fixed ink-on-paper artifact — its palette never follows
	   the app's dark mode / color palettes. */
	.cat {
		--paper: #f4efe5;
		--surface: #eae3d3;
		--ink: #1b1813;
		--muted: #6f675c;
		--faint: #948b7a;
		--edge: rgba(27, 24, 19, 0.2);
		--hair: rgba(27, 24, 19, 0.1);

		min-height: 100vh;
		background: var(--paper);
		color: var(--ink);
		font-family:
			'Archivo',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			sans-serif;
	}
	.cat,
	.cat * {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}

	@font-face {
		font-family: 'CatalogueSerif';
		src: url('/fonts/source-serif-4-400.ttf') format('truetype');
		font-weight: 400;
		font-style: normal;
	}
	@font-face {
		font-family: 'CatalogueSerif';
		src: url('/fonts/source-serif-4-italic-400.ttf') format('truetype');
		font-weight: 400;
		font-style: italic;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 2.5rem;
	}
	.back {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
		text-decoration: none;
		transition: color 0.2s;
	}
	.back:hover {
		color: var(--ink);
	}
	.print-btn {
		font-family: inherit;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--paper);
		background: var(--ink);
		border: 1px solid var(--ink);
		padding: 0.55rem 1.1rem;
		cursor: pointer;
		transition:
			color 0.25s,
			background-color 0.25s,
			border-color 0.25s;
	}
	.print-btn:hover {
		color: var(--paper);
		background: #8a6c33;
		border-color: #8a6c33;
	}

	.masthead-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.wordmark {
		margin: 0;
		font-family: 'CatalogueSerif', Georgia, serif;
		font-size: 40px;
		font-weight: 400;
		line-height: 1.1;
		letter-spacing: -0.01em;
	}
	.kicker {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--muted);
		white-space: nowrap;
	}
	.meta {
		margin: 0.9rem 0 0;
		padding-bottom: 1.4rem;
		border-bottom: 1px solid var(--edge);
		font-size: 11px;
		letter-spacing: 0.18em;
		color: var(--faint);
	}

	/* Two columns, column-major flow — the reading order of a printed book.
	   Entries never break across a printed page. */
	.grid {
		margin: 2rem 0 0;
		padding: 0;
		list-style: none;
		columns: 2;
		column-gap: 36px;
	}
	.entry {
		display: flex;
		gap: 14px;
		min-height: 144px; /* the 108pt PDF cell at 96dpi */
		padding: 14px 0 18px;
		border-bottom: 1px solid var(--hair);
		break-inside: avoid;
		page-break-inside: avoid;
	}
	.cover {
		position: relative;
		flex-shrink: 0;
		width: 96px;
		height: 96px;
		background: var(--surface);
		border: 1px solid var(--hair);
		overflow: hidden;
	}
	.cover img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.ring {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
		border: 1px solid var(--hair);
		border-radius: 50%;
	}
	.dot {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 8px;
		height: 8px;
		transform: translate(-50%, -50%);
		background: var(--faint);
		border-radius: 50%;
	}

	.txt {
		position: relative;
		min-width: 0;
		flex: 1;
	}
	.num {
		position: absolute;
		top: 2px;
		right: 0;
		font-size: 9.5px;
		color: var(--faint);
	}
	.artist,
	.title,
	.meta-line {
		margin: 0;
	}
	.title {
		font-family: 'CatalogueSerif', Georgia, serif;
		font-size: 15.5px;
		line-height: 1.25;
		white-space: pre-line;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.artist {
		margin-top: 3px;
		font-family: 'CatalogueSerif', Georgia, serif;
		font-style: italic;
		font-size: 14.5px;
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Spec micro-lines. Labels get their own line(s) and wrap — they are never
	   clipped mid-label. */
	.meta-line {
		margin-top: 5px;
		font-size: 10.5px;
		line-height: 1.45;
		color: var(--muted);
	}
	.meta-line.faint {
		color: var(--faint);
	}

	/* The records — sequential breakdowns; a quiet rule between siblings, and
	   a record never splits across a printed page. */
	.details {
		margin-top: 3rem;
	}
	.detail {
		break-inside: avoid;
		page-break-inside: avoid;
	}
	.detail + .detail {
		margin-top: 2.8rem;
		padding-top: 2rem;
		border-top: 1px solid var(--hair);
	}
	.detail-head {
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--edge);
		margin-bottom: 1.8rem;
	}
	.d-kicker {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.detail-body {
		display: flex;
		align-items: flex-start;
		gap: 43px; /* the 32pt PDF gutter */
	}
	.d-cover {
		width: 293px; /* the 220pt PDF cover at 96dpi */
		height: 293px;
	}
	.d-info {
		flex: 1;
		min-width: 0;
	}
	.d-title,
	.d-artist {
		margin: 0;
	}
	.d-title {
		font-family: 'CatalogueSerif', Georgia, serif;
		font-size: 24px;
		line-height: 1.25;
		white-space: pre-line;
	}
	.d-artist {
		margin-top: 6px;
		font-family: 'CatalogueSerif', Georgia, serif;
		font-style: italic;
		font-size: 16.5px;
		line-height: 1.4;
		white-space: pre-line;
		color: var(--muted);
	}
	.d-meta {
		margin: 1.3rem 0 0;
	}
	.d-row {
		margin-bottom: 9px;
	}
	.d-row dt {
		font-size: 8.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.d-row dd {
		margin: 2px 0 0;
		font-size: 13px;
		line-height: 1.4;
		white-space: pre-line;
		overflow-wrap: break-word;
	}
	.d-notes {
		margin-top: 1.3rem;
		padding: 12px 16px;
		background: var(--surface);
		border-left: 3px solid #8a6c33;
	}
	.d-notes p {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		white-space: pre-line;
	}

	.colophon {
		margin-top: 3rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--hair);
		text-align: center;
		font-size: 10px;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--faint);
	}

	.empty {
		padding: 4rem 0;
		text-align: center;
		font-family: 'CatalogueSerif', Georgia, serif;
		font-style: italic;
		font-size: 18px;
		color: var(--muted);
	}

	@media (max-width: 640px) {
		.grid {
			columns: 1;
		}
		.detail-body {
			flex-direction: column;
		}
	}

	@media print {
		.no-print {
			display: none !important;
		}
		.cat {
			min-height: 0;
		}
		.details {
			margin-top: 2rem;
		}
		.detail + .detail {
			margin-top: 1.8rem;
			padding-top: 1.4rem;
		}
		.colophon {
			margin-top: 2rem;
		}
	}
</style>
