<script lang="ts">
	import { browser } from '$app/environment';

	/** One observation on a series. x is epoch ms, y the raw value (e.g. cents). */
	export interface TrendPoint {
		x: number;
		y: number;
	}

	/** A named line drawn on the chart. All series share the same x positions. */
	export interface TrendSeries {
		id: string;
		label: string;
		color: string;
		points: TrendPoint[];
		/** Soft area fill under the line (on by default for the first series only). */
		area?: boolean;
		/** Dashed stroke — for secondary/reference lines. */
		dashed?: boolean;
	}

	let {
		series,
		height = 300,
		formatValue = (v: number) => String(v),
		formatTick = formatValue,
		formatX,
		formatTipDate,
		tipExtra,
		ariaLabel = 'Trend chart'
	}: {
		series: TrendSeries[];
		height?: number;
		/** Full-precision value for tooltips. */
		formatValue?: (v: number) => string;
		/** Compact value for the y-axis gridline labels. */
		formatTick?: (v: number) => string;
		/** x-axis tick label; defaults to month/year derived from the tick step. */
		formatX?: (ms: number, stepMs: number) => string;
		/** Tooltip date header; defaults to 'March 2024' at month resolution. */
		formatTipDate?: (ms: number) => string;
		/** Optional extra tooltip rows for the hovered point index. */
		tipExtra?: (i: number) => { label: string; value: string; tone?: 'up' | 'down' }[];
		ariaLabel?: string;
	} = $props();

	/* Fixed gutters: y labels on the left, an x-label band along the baseline. */
	const M = { top: 14, right: 16, bottom: 26, left: 56 } as const;
	const DAY_MS = 86_400_000;
	/* Coarse-to-fine time steps the axis ticks may snap to. */
	const X_STEPS = [
		DAY_MS,
		2 * DAY_MS,
		7 * DAY_MS,
		14 * DAY_MS,
		30.44 * DAY_MS,
		60.9 * DAY_MS,
		91.3 * DAY_MS,
		182.6 * DAY_MS,
		365.25 * DAY_MS,
		730.5 * DAY_MS
	];

	const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const MONTHS_FULL = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	const defaultX = (ms: number, stepMs: number): string => {
		const d = new Date(ms);
		return stepMs >= 91 * DAY_MS
			? `${MONTHS_ABBR[d.getMonth()]} ${d.getFullYear()}`
			: `${MONTHS_ABBR[d.getMonth()]} ${d.getDate()}`;
	};
	const defaultTipDate = (ms: number): string => {
		const d = new Date(ms);
		return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
	};

	/* Responsive width — measured on the wrapper; SSR renders a desktop-width
	   first pass and the ResizeObserver corrects it after hydration. */
	let wrapRef = $state<HTMLElement | null>(null);
	let width = $state(860);
	$effect(() => {
		const el = wrapRef;
		if (!el || !browser) return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w && w > 0) width = w;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	const anchor = $derived(series[0]?.points ?? []);
	const plotW = $derived(Math.max(width - M.left - M.right, 10));
	const plotH = $derived(Math.max(height - M.top - M.bottom, 10));

	/* Domain + scales. */
	const xMin = $derived(anchor.length ? anchor[0].x : 0);
	const xMax = $derived(anchor.length ? anchor[anchor.length - 1].x : 0);
	const span = $derived(Math.max(xMax - xMin, 30 * DAY_MS)); // one point: pad so it is not a singularity
	const yTopRaw = $derived(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.y))) * 1.06);
	function niceCeil(v: number): number {
		if (v <= 0) return 1;
		const exp = Math.floor(Math.log10(v));
		const f = v / 10 ** exp;
		const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
		return nf * 10 ** exp;
	}
	const yTop = $derived(niceCeil(yTopRaw));

	const xs = (ms: number): number => M.left + ((ms - xMin) / span) * plotW;
	const ys = (v: number): number => M.top + plotH - (v / yTop) * plotH;

	const yTicks = $derived([0, 1, 2, 3, 4].map((i) => (yTop * i) / 4));

	/* x ticks: the coarsest step that keeps the label count under ~width/90. */
	const { xTicks, xStep } = $derived.by(() => {
		const target = Math.min(12, Math.max(2, Math.floor(plotW / 90)));
		const step = X_STEPS.find((s) => span / s <= target) ?? X_STEPS[X_STEPS.length - 1];
		const ticks: number[] = [];
		let t = Math.ceil(xMin / step) * step;
		for (; t <= xMax; t += step) ticks.push(t);
		return { xTicks: ticks, xStep: step };
	});

	function linePath(points: TrendPoint[]): string {
		if (!points.length) return '';
		return points.map((p, i) => `${i ? 'L' : 'M'}${xs(p.x).toFixed(1)} ${ys(p.y).toFixed(1)}`).join(' ');
	}
	const areaSeries = $derived(series.find((s, i) => s.area ?? i === 0) ?? null);
	const areaPath = $derived.by(() => {
		const s = areaSeries;
		if (!s || s.points.length < 2) return '';
		const base = M.top + plotH;
		const first = s.points[0];
		const last = s.points[s.points.length - 1];
		return `M${xs(first.x).toFixed(1)} ${base} ${linePath(s.points).replace(
			'M',
			'L'
		)} L${xs(last.x).toFixed(1)} ${base} Z`;
	});

	/* Hover: snap to the nearest point of the anchor series (all series share
	   its x grid), then guide line + dots + an HTML tooltip. */
	let hoverI = $state<number | null>(null);
	function onMove(e: PointerEvent): void {
		const el = wrapRef;
		if (!el || !anchor.length) return;
		const rect = el.getBoundingClientRect();
		const px = e.clientX - rect.left - M.left;
		if (px < -10 || px > plotW + 10) {
			hoverI = null;
			return;
		}
		const ms = xMin + (px / plotW) * span;
		let best = 0;
		let bd = Number.POSITIVE_INFINITY;
		for (let i = 0; i < anchor.length; i++) {
			const d = Math.abs(anchor[i].x - ms);
			if (d < bd) {
				bd = d;
				best = i;
			}
		}
		hoverI = best;
	}
	const hoverP = $derived(hoverI === null ? null : (anchor[hoverI] ?? null));
	const tooltipLeft = $derived(hoverP ? Math.min(Math.max(xs(hoverP.x), 92), Math.max(width - 92, 92)) : 0);
</script>

<div
	bind:this={wrapRef}
	role="presentation"
	class="relative w-full select-none"
	style:height="{height}px"
	style:touch-action="pan-y"
	onpointermove={onMove}
	onpointerleave={() => (hoverI = null)}
>
	<svg {width} {height} role="img" aria-label={ariaLabel} class="block">
		{#if anchor.length}
			{#each yTicks as v (v)}
				<line x1={M.left} x2={width - M.right} y1={ys(v)} y2={ys(v)} stroke="var(--hair)" />
				<text x={M.left - 8} y={ys(v)} dy="0.32em" text-anchor="end" class="fill-faint text-[9.5px]">
					{formatTick(v)}
				</text>
			{/each}
			<!-- baseline: the one structural rule of the chart -->
			<line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--edge)" />
			{#each xTicks as t (t)}
				<line x1={xs(t)} x2={xs(t)} y1={M.top + plotH} y2={M.top + plotH + 4} stroke="var(--edge)" />
				<text x={xs(t)} y={height - 7} text-anchor="middle" class="fill-faint text-[9px] uppercase tracking-[.08em]">
					{(formatX ?? defaultX)(t, xStep)}
				</text>
			{/each}

			{#if areaPath}
				<path d={areaPath} fill={areaSeries!.color} fill-opacity="0.07" />
			{/if}
			{#each series as s (s.id)}
				<path
					d={linePath(s.points)}
					fill="none"
					stroke={s.color}
					stroke-width={s.dashed ? 1.4 : 1.8}
					stroke-dasharray={s.dashed ? '3 4' : undefined}
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			{/each}

			<!-- resting dot on each series' latest point -->
			{#each series as s (s.id)}
				{@const lp = s.points[s.points.length - 1]}
				{#if lp}
					<circle cx={xs(lp.x)} cy={ys(lp.y)} r="2.6" fill={s.color} stroke="var(--paper)" stroke-width="1.2" />
				{/if}
			{/each}

			{#if hoverP}
				{@const hx = xs(hoverP.x)}
				<line x1={hx} x2={hx} y1={M.top} y2={M.top + plotH} stroke="var(--edge)" stroke-dasharray="2 3" />
				{#each series as s (s.id)}
					{@const p = hoverI === null ? null : s.points[hoverI]}
					{#if p}
						<circle cx={hx} cy={ys(p.y)} r="3" fill={s.color} stroke="var(--paper)" stroke-width="1.4" />
					{/if}
				{/each}
			{/if}
		{/if}
	</svg>

	{#if hoverP && hoverI !== null}
		<div
			class="pointer-events-none absolute top-2 z-10 -translate-x-1/2 border border-edge bg-surface px-3.5 py-2.5"
			style:left="{tooltipLeft}px"
			aria-hidden="true"
		>
			<div class="mb-2 text-[9.5px] font-semibold uppercase tracking-[.18em] text-faint">
				{(formatTipDate ?? defaultTipDate)(hoverP.x)}
			</div>
			{#each series as s (s.id)}
				{@const p = s.points[hoverI]}
				{#if p}
					<div class="flex items-center justify-between gap-5 py-0.5">
						<span class="flex items-center gap-1.5 text-[11px] text-muted">
							<span class="h-[7px] w-[7px] shrink-0" style:background-color={s.color}></span>
							{s.label}
						</span>
						<span class="font-display text-[13.5px] tabular-nums">{formatValue(p.y)}</span>
					</div>
				{/if}
			{/each}
			{#if tipExtra}
				{@const extra = tipExtra(hoverI)}
				{#if extra.length}
					<div class="mt-1.5 border-t border-hair pt-1.5">
						{#each extra as row (row.label)}
							<div class="flex items-center justify-between gap-5 py-0.5">
								<span class="text-[11px] text-faint">{row.label}</span>
								<span
									class={`text-[12.5px] tabular-nums ${row.tone === 'up' ? 'text-forest' : row.tone === 'down' ? 'text-rust' : 'text-muted'}`}
								>
									{row.value}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
