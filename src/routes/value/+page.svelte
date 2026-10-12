<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import CoverImage from '$lib/components/ui/CoverImage.svelte';
	import DecadeLabel from '$lib/components/ui/DecadeLabel.svelte';
	import TrendChart, { type TrendSeries } from '$lib/components/TrendChart.svelte';
	import { appTitle } from '$lib/index';
	import type { MoverRow, QuotePoint, ValueBarRow, ValueRow } from '$lib/server/value';

	let { data }: { data: PageData } = $props();
	const s = $derived(data.stats);
	const pf = $derived(data.portfolio);

	/* ---- formatting (ledger voice — same conventions as /stats) ---- */
	function money(cents: number | null): string {
		if (cents === null) return '—';
		const neg = cents < 0;
		return `${neg ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
	}
	/** Compact money for readouts: whole dollars above $10. */
	function fmtValue(cents: number | null): string {
		if (cents === null) return '—';
		const neg = cents < 0;
		const v = Math.abs(cents);
		return `${neg ? '−' : ''}$${v >= 1000 ? Math.round(v / 100).toLocaleString('en-US') : (v / 100).toFixed(2)}`;
	}
	function pct(p: number | null): string {
		if (p === null) return '—';
		return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%`;
	}

	/* ---- the portfolio chart (front and center) ---- */
	/** Full-precision money for the chart's tooltips. */
	function pfMoney(cents: number): string {
		return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}
	/** Compact money for the chart's y-axis: $840 → $840, $1.2k, $3.4M. */
	function pfTick(cents: number): string {
		const d = cents / 100;
		const trim = (v: number) => v.toFixed(1).replace(/\.0$/, '');
		if (d >= 1_000_000) return `$${trim(d / 1_000_000)}M`;
		if (d >= 1_000) return `$${trim(d / 1_000)}k`;
		return `$${Math.round(d)}`;
	}
	const pfSeries = $derived.by<TrendSeries[]>(() => {
		const out: TrendSeries[] = [
			{
				id: 'worth',
				label: 'Value',
				color: 'var(--accent)',
				points: pf.points.map((p) => ({ x: p.ms, y: p.worth_cents }))
			}
		];
		if (pf.has_quotes) {
			out.push({
				id: 'invested',
				label: 'Invested',
				color: 'var(--chart-slate)',
				dashed: true,
				points: pf.points.map((p) => ({ x: p.ms, y: p.invested_cents }))
			});
		}
		return out;
	});
	const pfLegend = $derived(
		pf.has_quotes
			? [
					{ label: 'Value', color: 'var(--accent)' },
					{ label: 'Invested', color: 'var(--chart-slate)' }
				]
			: [{ label: 'Value', color: 'var(--accent)' }]
	);
	function pfTipExtra(i: number): { label: string; value: string; tone?: 'up' | 'down' }[] {
		const p = pf.points[i];
		if (!p) return [];
		const rows: { label: string; value: string; tone?: 'up' | 'down' }[] = [
			{ label: 'On the shelf', value: `${p.count} ${p.count === 1 ? 'record' : 'records'}` }
		];
		if (pf.has_quotes) {
			const net = p.worth_cents - p.invested_cents;
			rows.push({
				label: 'Net position',
				value: `${net < 0 ? '-' : '+'}${pfMoney(Math.abs(net))}`,
				tone: net >= 0 ? 'up' : 'down'
			});
		}
		return rows;
	}
	const pfHasValue = $derived(pf.points.length > 0 && pf.current_worth_cents > 0);

	const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
	/** Deterministic 'Sep 5, 2026' from a 'YYYY-MM-DD…' stamp (no locale drift). */
	function fmtStamp(stamp: string | null): string {
		if (!stamp) return '';
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(stamp.trim());
		if (!m) return '';
		const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
		return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
	}

	/* ---- abstract lines (muted italic, key figures upright) ---- */
	type Part = { t: string; h: boolean };
	const seg = (t: string, h = false): Part => ({ t, h });
	const abstractLines = $derived.by((): Part[][] => {
		if (!s.shelf_count) return [];
		const lines: Part[][] = [];
		const l1: Part[] = [
			seg(`${s.shelf_count} records on the shelf`, true),
			seg(' cost '),
			seg(money(s.cost_basis_cents), true),
			seg('.')
		];
		lines.push(l1);
		if (s.quoted_count > 0) {
			const l2: Part[] = [seg('Quoted market value: '), seg(money(s.market_value_cents), true)];
			lines.push(l2);
			if (s.unrealized_pct !== null) {
				lines.push([
					seg(
						`The ${s.priced_count} record${s.priced_count === 1 ? '' : 's'} with a known cost and a live price ${s.priced_count === 1 ? 'is' : 'are'} `
					),
					seg(`${s.unrealized_pct >= 0 ? 'up' : 'down'} `),
					seg(`${Math.abs(s.unrealized_pct).toFixed(1)}%`, true),
					seg(` against what ${s.priced_count === 1 ? 'it' : 'they'} cost.`)
				]);
			} else {
				lines.push([seg('Add a purchase price to start measuring gain or loss.')]);
			}
		} else {
			l1.push(seg(' The market ledger is still empty — take a snapshot to start it.'));
		}
		if (s.sales_count > 0) {
			lines.push([
				seg(`${s.sales_count} record${s.sales_count === 1 ? '' : 's'} have left for `),
				seg(money(s.realized_cents), true),
				seg(' versus what they cost.')
			]);
		}
		return lines;
	});

	/* ---- money-by-… groups: the cost-vs-market comparison per group ---- */
	const groupDelta = (r: ValueBarRow): number | null =>
		r.cost_cents > 0 ? ((r.market_cents - r.cost_cents) / r.cost_cents) * 100 : null;

	/* ---- sparkline geometry: last ≤30 PRICED observations as a hairline path ---- */
	function sparkline(series: QuotePoint[]): string | null {
		const priced = series.filter((p) => p.price_cents !== null).slice(-30);
		if (priced.length < 2) return null;
		const W = 64,
			H = 18,
			pad = 2;
		const vals = priced.map((p) => p.price_cents as number);
		const min = Math.min(...vals),
			max = Math.max(...vals);
		const span = max - min || 1;
		const pts = priced.map((p, i) => {
			const x = pad + (i / (priced.length - 1)) * (W - pad * 2);
			const y = H - pad - (((p.price_cents as number) - min) / span) * (H - pad * 2);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return pts.join(' ');
	}
	const sparkTone = (series: QuotePoint[]): string => {
		const priced = series.filter((p) => p.price_cents !== null);
		if (priced.length < 2) return 'var(--accent)';
		return (priced[priced.length - 1].price_cents as number) >= (priced[0].price_cents as number)
			? 'var(--forest)'
			: 'var(--rust)';
	};

	/* ---- market snapshot (client action → POST /api/value/snapshot) ---- */
	let busy = $state(false);
	let resetting = $state(false);
	let note = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function takeSnapshot(): Promise<void> {
		if (busy) return;
		busy = true;
		note = null;
		error = null;
		try {
			const res = await fetch('/api/value/snapshot', { method: 'POST' });
			const j = (await res.json().catch(() => null)) as {
				ok?: boolean;
				recorded?: number;
				no_listing?: number;
				errors?: string[];
				message?: string;
			} | null;
			if (!res.ok || !j?.ok) throw new Error(j?.message ?? `HTTP ${res.status}`);
			const bits = [`Recorded ${j.recorded ?? 0} quote${(j.recorded ?? 0) === 1 ? '' : 's'}`];
			if ((j.no_listing ?? 0) > 0) bits.push(`${j.no_listing} with no live listings`);
			note = bits.join(' · ') + '.';
			if (j.errors?.length) note += ` (${j.errors.length} release${j.errors.length === 1 ? '' : 's'} unreachable.)`;
			await invalidateAll(); // the page re-renders with fresh quotes + history
		} catch (e) {
			error = e instanceof Error ? e.message : 'Snapshot failed.';
		} finally {
			busy = false;
		}
	}

	/** Destructive: the append-only price log is the only history, so a reset
	 *  asks first (the count is on the button's section, not the dialog). */
	async function resetHistory(): Promise<void> {
		if (resetting) return;
		const ok = confirm(
			`Delete all ${s.history_rows} price observation${s.history_rows === 1 ? '' : 's'} from the market ledger?\n\n` +
				`Sparklines, movers and “market at sale” are read from this log — resetting starts the history from the next snapshot. Records, prices and sales are not touched.`
		);
		if (!ok) return;
		resetting = true;
		note = null;
		error = null;
		try {
			const res = await fetch('/api/value/history', { method: 'DELETE' });
			const j = (await res.json().catch(() => null)) as {
				ok?: boolean;
				deleted?: number;
				message?: string;
			} | null;
			if (!res.ok || !j?.ok) throw new Error(j?.message ?? `HTTP ${res.status}`);
			note = `History reset — ${j.deleted ?? 0} observation${(j.deleted ?? 0) === 1 ? '' : 's'} removed.`;
			await invalidateAll(); // the ledger, sparklines and counters re-render empty
		} catch (e) {
			error = e instanceof Error ? e.message : 'Reset failed.';
		} finally {
			resetting = false;
		}
	}

	const gainerTone = $derived(s.unrealized_cents !== null && s.unrealized_cents >= 0 ? 'text-forest' : 'text-rust');
	const realizedTone = $derived(s.realized_cents >= 0 ? 'text-forest' : 'text-rust');
</script>

<svelte:head><title>{appTitle('Value')}</title></svelte:head>

<!-- Quiet ledger table: one row per group — cost, market, the delta between.
     The numbers read better in a table than a chart here; no graph needed. -->
{#snippet moneyTable(rows: ValueBarRow[], decadeLabels: boolean)}
	<!-- The wrapper is the floor: on the narrowest phones the table scrolls
       inside itself instead of pushing the page sideways. At ≥360 px the
       tightened mobile columns (group width, no Records count) fit without it. -->
	<div class="overflow-x-auto">
		<table class="w-full border-collapse text-left">
			<thead>
				<tr class="border-b border-edge text-[10px] uppercase tracking-[.18em] text-faint">
					<th class="py-2 pr-3 font-semibold sm:pr-4">{decadeLabels ? 'Decade' : 'Group'}</th>
					<th class="hidden py-2 pr-4 font-semibold sm:table-cell">Records</th>
					<th class="py-2 pr-3 text-right font-semibold sm:pr-4">Cost</th>
					<th class="py-2 pr-3 text-right font-semibold sm:pr-4">Market</th>
					<th class="py-2 text-right font-semibold">Δ</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.label)}
					{@const d = groupDelta(r)}
					<tr class="border-b border-hair">
						<td
							class="max-w-[120px] truncate py-2.5 pr-3 font-display text-[14.5px] tracking-[.005em] sm:max-w-[220px] sm:pr-4"
							title={r.label}
						>
							{#if decadeLabels}
								<DecadeLabel label={r.label} />
							{:else}
								{r.label}
							{/if}
						</td>
						<td class="hidden py-2.5 pr-4 text-[12px] tabular-nums text-muted sm:table-cell">
							{r.count}
						</td>
						<td class="py-2.5 pr-3 text-right text-[13px] tabular-nums text-muted sm:pr-4">
							{money(r.cost_cents)}
						</td>
						<td class="py-2.5 pr-3 text-right font-display text-[14.5px] tabular-nums sm:pr-4">
							{money(r.market_cents)}
						</td>
						<td
							class={`py-2.5 text-right font-display text-[13.5px] tabular-nums ${
								d === null ? 'text-faint' : d >= 0 ? 'text-forest' : 'text-rust'
							}`}
						>
							{pct(d)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

<!-- Sparkline: the record's priced history as one hairline (green rising / rust falling).
     Only renders with ≥2 priced observations; a flat line is still drawn. -->
{#snippet spark(series: QuotePoint[])}
	{@const pts = sparkline(series)}
	{#if pts}
		<svg viewBox="0 0 64 18" class="hidden h-[18px] w-16 shrink-0 sm:block" aria-hidden="true">
			<polyline
				points={pts}
				fill="none"
				stroke={sparkTone(series)}
				stroke-width="1.5"
				stroke-linejoin="round"
				stroke-linecap="round"
				opacity="0.9"
			/>
		</svg>
	{/if}
{/snippet}

<!-- One row of the gainers/losers ledger: rank, cover, name, cost→quote, Δ%, sparkline -->
{#snippet rankRow(r: ValueRow, i: number)}
	<li class="flex items-center gap-3 border-b border-hair py-2.5 sm:gap-4">
		<span class="w-5 shrink-0 text-right font-display text-[15px] italic text-faint">{i + 1}</span>
		<a href={`/records/${r.id}`} class="block h-10 w-10 shrink-0" title={r.artist}>
			<CoverImage src={r.cover ? `/media/${r.cover}` : null} alt="" loading="lazy" />
		</a>
		<div class="min-w-0 flex-1">
			<a
				href={`/records/${r.id}`}
				class="block truncate font-display text-[15px] tracking-[.005em] transition-colors duration-300 hover:text-accent sm:text-[16px]"
			>
				{r.artist} — {r.title}
			</a>
			<div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] uppercase tracking-[.12em] text-faint">
				{#if r.year}<span>{r.year}</span>{/if}
				<span class="text-muted">
					{money(r.paid_cents)} → {money(r.quote_cents)}
				</span>
				{#if r.num_for_sale !== null}<span>{r.num_for_sale} for sale</span>{/if}
			</div>
		</div>
		{@render spark(r.series)}
		<span
			class={`w-[72px] shrink-0 text-right font-display text-[15px] tabular-nums sm:text-[16px] ${
				(r.delta_pct ?? 0) >= 0 ? 'text-forest' : 'text-rust'
			}`}
		>
			{pct(r.delta_pct)}
		</span>
	</li>
{/snippet}

<!-- page head — editorial, mirrors /stats -->
<header class="flex flex-wrap items-end justify-between gap-6 border-b border-edge pb-7">
	<div class="max-w-3xl">
		<h1 class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em] sm:text-[52px]">
			What it&rsquo;s worth.
		</h1>
		{#if abstractLines.length}
			<div class="mt-5 flex max-w-3xl flex-col gap-1.5">
				{#each abstractLines as line, i (i)}
					<p class="font-display text-[17px] italic leading-relaxed text-muted sm:text-[18px]">
						{#each line as part, j (j)}
							{#if part.h}
								<span class="not-italic font-semibold tracking-normal text-ink sm:text-[20px]">{part.t}</span>
							{:else}
								{part.t}
							{/if}
						{/each}
					</p>
				{/each}
			</div>
		{:else}
			<p class="mt-3 font-display text-[15px] italic text-muted">
				The collection as a portfolio — what it cost, what the market says, what has already left.
			</p>
		{/if}
	</div>
	<div class="hidden text-right sm:block">
		<div class="text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">The Index</div>
		<div class="mt-1 font-display text-[13px] italic text-faint">vol. ii — the money</div>
	</div>
</header>

{#if s.shelf_count === 0}
	<div class="flex flex-col items-center border-b border-hair py-20 text-center">
		<p class="mb-2 font-display text-2xl font-normal">No shelf, no portfolio</p>
		<p class="mb-7 max-w-sm font-display text-[15px] italic text-muted">
			Value fills itself out as records are acquired — cost basis first, market quotes after.
		</p>
		<Button href="/scan" variant="primary">Scan a record</Button>
	</div>
{:else}
	<!-- ══════════════ the portfolio — what the shelves have been worth ══════════════
	     Front and center: monthly best-estimate value against cost basis, with
	     hover readouts. Offline-safe — quotes only appear once snapshots exist. -->
	<section class="border-b border-hair py-10">
		<div class="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
			<div>
				<h2 class="font-display text-[26px] font-normal leading-tight">The portfolio</h2>
				<p class="mt-2 max-w-md font-display text-[13.5px] italic leading-relaxed text-faint">
					What the shelves have carried, month by month — worth against what it cost to build.
				</p>
			</div>
			{#if pf.points.length}
				<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
					{#each pfLegend as l (l.label)}
						<span class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.16em] text-faint">
							<span class="h-[3px] w-4" style:background-color={l.color}></span>
							{l.label}
						</span>
					{/each}
					<span class="text-[10px] font-semibold uppercase tracking-[.16em] text-faint/70">
						as of {pf.points[pf.points.length - 1].label}
					</span>
				</div>
			{/if}
		</div>

		{#if pfHasValue}
			<TrendChart
				series={pfSeries}
				height={320}
				formatValue={pfMoney}
				formatTick={pfTick}
				tipExtra={pfTipExtra}
				ariaLabel="Portfolio value over time"
			/>
			<div class="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
				<div>
					<div class="font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px]">
						{pfMoney(pf.current_worth_cents)}
					</div>
					<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">current value</div>
				</div>
				<div>
					<div class="font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px]">
						{pfMoney(pf.current_invested_cents)}
					</div>
					<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">invested</div>
				</div>
				<div>
					<div
						class={`font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px] ${pf.net_cents >= 0 ? 'text-forest' : 'text-rust'}`}
					>
						{pf.net_cents < 0 ? '-' : '+'}{pfMoney(Math.abs(pf.net_cents))}
					</div>
					<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">net position</div>
				</div>
				<div>
					<div class="font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px]">
						{pf.records}
					</div>
					<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">on the shelf</div>
				</div>
			</div>
		{:else if pf.points.length}
			<p class="font-display text-[15px] italic text-muted">
				The line draws itself as prices come in — {s.quoted_count} of {s.shelf_count} records
				{s.quoted_count === 1 ? 'is' : 'are'} priced so far.
			</p>
		{/if}
	</section>

	<!-- headline counters — a quiet ledger strip -->
	<section class="grid grid-cols-2 gap-x-6 gap-y-8 border-b border-hair py-9 md:grid-cols-3 lg:grid-cols-5">
		<div>
			<div class="font-display text-[28px] leading-none sm:text-[40px]">
				{money(s.cost_basis_cents)}
			</div>
			<div class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">cost basis</div>
		</div>
		<div>
			<div class="font-display text-[28px] leading-none sm:text-[40px]">
				{money(s.market_value_cents)}
			</div>
			<div class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
				market value{s.quoted_count > 0 ? ` · ${s.quoted_count} quoted` : ''}
			</div>
		</div>
		<div>
			<div class={`font-display text-[28px] leading-none sm:text-[40px] ${gainerTone}`}>
				{s.unrealized_cents !== null ? money(s.unrealized_cents) : '—'}
			</div>
			<div class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
				unrealized{s.unrealized_pct !== null
					? ` · ${pct(s.unrealized_pct)} · ${s.priced_count} priced`
					: ' · no priced records yet'}
			</div>
		</div>
		<div>
			<div class={`font-display text-[28px] leading-none sm:text-[40px] ${realizedTone}`}>
				{money(s.realized_cents)}
			</div>
			<div class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
				realized · {s.sales_count} sale{s.sales_count === 1 ? '' : 's'}
			</div>
		</div>
		<div>
			<div class="font-display text-[28px] leading-none sm:text-[40px]">
				{s.history_rows}
			</div>
			<div class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
				price observations{s.last_snapshot_at ? ` · ${fmtStamp(s.last_snapshot_at)}` : ''}
			</div>
		</div>
	</section>

	{#if s.gainers.length || s.losers.length}
		<!-- gainer/loser ledger — cost vs the latest live quote, with the trend tucked in -->
		<section class="border-b border-hair py-10">
			<h3 class="stat-section-title">The movers</h3>
			<div class="mt-6 grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-2">
				<div>
					<div class="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-forest">
						Top gainers — vs what they cost
					</div>
					{#if s.gainers.length}
						<ul>
							{#each s.gainers as r, i (r.id)}{@render rankRow(r, i)}{/each}
						</ul>
					{:else}
						<p class="font-display text-[14px] italic text-faint">No gains on the books yet.</p>
					{/if}
				</div>
				<div>
					<div class="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-rust">
						Top losers — vs what they cost
					</div>
					{#if s.losers.length}
						<ul>
							{#each s.losers as r, i (r.id)}{@render rankRow(r, i)}{/each}
						</ul>
					{:else}
						<p class="font-display text-[14px] italic text-faint">Nothing under water.</p>
					{/if}
				</div>
			</div>
		</section>
	{/if}

	<!-- since-first-watched — the market's own drift, cost-agnostic -->
	{#if s.movers.length}
		<section class="border-b border-hair py-10">
			<h3 class="stat-section-title">Since first watched</h3>
			<p class="mt-2 font-display text-[14px] italic text-faint">
				The market&rsquo;s drift since the first observation — whether or not it has ever been quoted against cost.
			</p>
			<ul class="mt-5 flex flex-col">
				{#each s.movers as m (m.id)}
					{@const mrow = m as MoverRow}
					<li class="flex items-center gap-3 border-b border-hair py-2.5 sm:gap-4">
						<a href={`/records/${mrow.id}`} class="block h-10 w-10 shrink-0" title={mrow.artist}>
							<CoverImage src={mrow.cover ? `/media/${mrow.cover}` : null} alt="" loading="lazy" />
						</a>
						<div class="min-w-0 flex-1">
							<a
								href={`/records/${mrow.id}`}
								class="block truncate font-display text-[15px] tracking-[.005em] transition-colors duration-300 hover:text-accent sm:text-[16px]"
							>
								{mrow.artist} — {mrow.title}
							</a>
							<div class="mt-0.5 text-[11px] uppercase tracking-[.12em] text-faint">
								first {money(mrow.first_cents)} on {fmtStamp(mrow.first_at)} → now
								{money(mrow.quote_cents)}
							</div>
						</div>
						{@render spark(mrow.series)}
						<span
							class={`w-[72px] shrink-0 text-right font-display text-[15px] tabular-nums sm:text-[16px] ${
								mrow.change_pct >= 0 ? 'text-forest' : 'text-rust'
							}`}
						>
							{pct(mrow.change_pct)}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- where the money sits — cost vs market per genre / label / decade -->
	<section class="border-b border-hair py-10">
		<h3 class="stat-section-title">Where the money sits</h3>
		<p class="mt-2 font-display text-[14px] italic text-faint">
			Cost basis against current market value, group by group.
		</p>
		{#if s.by_genre.length}
			<div class="mt-8">
				<div class="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-muted">By genre</div>
				{@render moneyTable(s.by_genre, false)}
			</div>
		{/if}
		{#if s.by_label.length}
			<div class="mt-10">
				<div class="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-muted">By label</div>
				{@render moneyTable(s.by_label, false)}
			</div>
		{/if}
		{#if s.by_decade.length}
			<div class="mt-10">
				<div class="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-muted">By decade</div>
				{@render moneyTable(s.by_decade, true)}
			</div>
		{/if}
	</section>

	<!-- the sales ledger — realized, with the missed-the-bus check -->
	{#if s.sales.length}
		<section class="border-b border-hair py-10">
			<h3 class="stat-section-title">The sales ledger</h3>
			<p class="mt-2 font-display text-[14px] italic text-faint">
				What has left the shelf, and what Discogs was paying for it at the time.
			</p>
			<ul class="mt-5 flex flex-col">
				{#each s.sales as sale (sale.id)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hair py-2.5 sm:gap-x-6">
						<div class="min-w-0 flex-1 basis-52">
							<a
								href={`/records/${sale.id}`}
								class="block truncate font-display text-[15px] tracking-[.005em] transition-colors duration-300 hover:text-accent sm:text-[16px]"
							>
								{sale.artist} — {sale.title}
							</a>
						</div>
						<div class="text-[12px] tabular-nums text-muted">
							paid {money(sale.paid_cents)}
						</div>
						<div class="text-[12px] tabular-nums text-muted">
							sold {money(sale.sale_cents)}
						</div>
						<div
							class={`w-[72px] text-right font-display text-[15px] tabular-nums ${sale.delta_cents >= 0 ? 'text-forest' : 'text-rust'}`}
						>
							{money(sale.delta_cents)}
						</div>
						<div class="w-[92px] text-right text-[11px] uppercase tracking-[.12em] text-faint">
							{sale.sold_at ? fmtStamp(sale.sold_at) : ''}
						</div>
						<div class="flex w-full items-center justify-end gap-2 sm:w-auto">
							{#if sale.market_at_sale}
								{@const diff = (sale.sale_cents ?? 0) - sale.market_at_sale.price_cents}
								<span class="text-[11px] uppercase tracking-[.12em] text-faint">
									discogs that day: {money(sale.market_at_sale.price_cents)} ·
								</span>
								<span
									class={`text-[11px] font-semibold uppercase tracking-[.12em] ${diff >= 0 ? 'text-forest' : 'text-rust'}`}
								>
									{diff >= 0 ? `beat the market by ${money(diff)}` : `missed ${money(Math.abs(diff))}`}
								</span>
							{:else}
								<span class="text-[11px] uppercase tracking-[.12em] text-faint">unwatched at sale</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- market snapshot — coverage + the append-only price log -->
	<section class="py-10">
		<div class="flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
			<div class="max-w-md">
				<h2 class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">Market snapshot</h2>
				<p class="mt-2.5 font-display text-[14.5px] italic leading-snug text-muted">
					{#if s.linked_count === 0}
						No shelf records are linked to Discogs yet — a snapshot needs a discogs_id on each record.
					{:else if s.history_rows === 0}
						Take the first snapshot to start the price ledger: one observation per linked record, appended to the
						history every time.
					{:else}
						{s.watched_count} of {s.linked_count} linked records have been priced{#if s.no_listing_count > 0}
							(
							{s.no_listing_count} currently with no live listings){/if}. First observation
						{fmtStamp(s.first_snapshot_at)}; latest {fmtStamp(s.last_snapshot_at)}.
					{/if}
				</p>
			</div>

			<div class="flex flex-col items-start gap-3">
				<Button
					variant="secondary"
					size="sm"
					type="button"
					disabled={busy || s.linked_count === 0}
					onclick={() => void takeSnapshot()}
				>
					{busy ? 'Asking Discogs…' : 'Take a snapshot'}
				</Button>
				{#if s.history_rows > 0}
					<Button
						variant="danger"
						size="sm"
						type="button"
						disabled={resetting || busy}
						onclick={() => void resetHistory()}
					>
						{resetting ? 'Clearing…' : 'Reset history'}
					</Button>
				{/if}
				{#if note}
					<Banner variant="success">{note}</Banner>
				{/if}
				{#if error}
					<Banner variant="error">{error}</Banner>
				{/if}
			</div>
		</div>
	</section>
{/if}
