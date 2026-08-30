<script lang="ts">
  import type { PageData } from "./$types";
  import type { StatsMetric, StatsWindow } from "$lib/server/stats";
  import Button from "$lib/components/ui/Button.svelte";
  import CoverImage from "$lib/components/ui/CoverImage.svelte";
  import { STATUS_LABELS } from "$lib/types";

  let { data }: { data: PageData } = $props();
  const s = $derived(data.stats);
  const window: StatsWindow = $derived(data.window);
  const metric: StatsMetric = $derived(data.metric);

  /* ---- formatting helpers (ledger voice) ---- */
  function money(cents: number | null): string {
    if (cents === null) return "—";
    return `$${(cents / 100).toFixed(2)}`;
  }
  /** Compact money for bar readouts: whole dollars above $10. */
  function fmtValue(cents: number | null): string {
    if (cents === null) return "—";
    if (cents >= 1000)
      return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
    return `$${(cents / 100).toFixed(2)}`;
  }

  /** Metric-aware rows for the toggleable distributions (B4). */
  const metricRows = (
    rows: { label: string; count: number; value_cents: number }[],
  ) =>
    rows.map((r) => ({
      label: r.label,
      num: metric === "value" ? r.value_cents : r.count,
      display: metric === "value" ? fmtValue(r.value_cents) : String(r.count),
    }));

  const genreRows = $derived(metricRows(s.by_genre));
  const labelRows = $derived(metricRows(s.by_label));
  const decadeRows = $derived(metricRows(s.by_decade));
  const sourceRows = $derived(metricRows(s.by_source));

  /** Statuses rendered on the same bar scale as the other distributions. */
  const statusRows = $derived(
    s.statuses.map((st) => ({
      label: STATUS_LABELS[st.status] ?? st.status,
      num: st.count,
      display: String(st.count),
    })),
  );

  function statsHref(w: StatsWindow, m: StatsMetric): string {
    const p = new URLSearchParams();
    if (w !== "all") p.set("window", w);
    if (m !== "count") p.set("metric", m);
    const qs = p.toString();
    return qs ? `/stats?${qs}` : "/stats";
  }

  /* ---- D1 — the auto-generated abstract (one sentence, built clause by clause) ---- */
  const abstract = $derived.by(() => {
    if (!s.total) return "";
    const bits: string[] = [`A shelf of ${s.in_collection} records`];
    const genre = s.by_genre[0];
    if (genre) bits.push(`mostly ${genre.label}`);
    const artist = s.top_artists[0];
    if (artist)
      bits.push(
        artist.count > 1
          ? `leaning on ${artist.label}`
          : `anchored by ${artist.label}`,
      );
    if (s.median_year) bits.push(`with a median year of ${s.median_year}`);
    let line = bits.join(", ");
    if (s.priciest) {
      line += `. The priciest pressing still on the shelf: ${s.priciest.artist} — ${s.priciest.title}, at ${money(s.priciest.price_cents)}`;
    }
    line += ".";
    if (window !== "all" && s.window_top_genre && s.pace.windowed > 0) {
      line += ` Over ${s.pace.label}, the new arrivals leaned ${s.window_top_genre.label}.`;
    }
    return line;
  });

  /* ---- A4 — the pace sentence, ledger voice ("1.9 / month over the last year · …"),
     closed by the D5 milestone, which always has a number. ---- */
  const paceClauses = $derived.by(() => {
    const p = s.pace;
    const clauses: string[] = [];
    if (p.windowed > 0) {
      const pm =
        p.per_month % 1 === 0 ? String(p.per_month) : p.per_month.toFixed(1);
      clauses.push(`${pm} / month over ${p.label}`);
      if (p.biggest) {
        const unit = timeline[0]?.key.length === 4 ? "year" : "month";
        clauses.push(
          `biggest ${unit}: ${p.biggest.label} (${p.biggest.count})`,
        );
      }
      if (p.drought_weeks > 0)
        clauses.push(`longest drought: ${p.drought_weeks} weeks`);
      if (p.oldest_acquired)
        clauses.push(`oldest on the shelf: picked up ${p.oldest_acquired}`);
    }
    clauses.push(`${s.milestone.remaining} to ${s.milestone.next}`);
    return clauses;
  });

  /* ---- A1 / A2 — rhythm chart scale ---- */
  const timeline = $derived(s.timeline);
  const maxCount = $derived(timeline.reduce((m, b) => Math.max(m, b.count), 0));
  const finalCum = $derived(
    timeline.length ? timeline[timeline.length - 1].cumulative : 0,
  );

  /** A2 — sparkline in a 0..100 × 0..48 box (stretched; non-scaling stroke). */
  const spark = $derived.by(() => {
    if (timeline.length < 2 || finalCum <= 0) return null;
    const n = timeline.length;
    const pts = timeline.map((b, i) => {
      const x = (i / (n - 1)) * 100;
      const y = 46 - (b.cumulative / finalCum) * 42; // baseline 46, 4 units of headroom
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return {
      line: `M ${pts.join(" L ")}`,
      area: `M 0,48 L ${pts.join(" L ")} L 100,48 Z`,
    };
  });

  const windows: { id: StatsWindow; label: string }[] = [
    { id: "12m", label: "Last year" },
    { id: "24m", label: "Two years" },
    { id: "all", label: "All time" },
  ];

  /* ---- A3 — calendar heatmap (Sunday-start weeks, two-step gold fill) ---- */
  const heat = $derived.by(() => {
    const days = s.heatmap_days;
    if (!Object.keys(days).length) return null;
    const year = s.heatmap_year;
    const MS = 86400000;
    const jan1 = Date.UTC(year, 0, 1);
    const startMs = jan1 - new Date(jan1).getUTCDay() * MS; // back to the Sunday
    const dayKey = (ms: number) => {
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate(),
      ).padStart(2, "0")}`;
    };
    const cols: { cells: { key: string; n: number }[] }[] = [];
    for (let i = 0; i < 53; i++) {
      const cells: { key: string; n: number }[] = [];
      let inYear = false;
      for (let j = 0; j < 7; j++) {
        const ms = startMs + (i * 7 + j) * MS;
        if (new Date(ms).getUTCFullYear() === year) {
          inYear = true;
          const key = dayKey(ms);
          cells.push({ key, n: days[key] ?? 0 });
        } else cells.push({ key: "", n: -1 }); // outside the year — render nothing
      }
      if (inYear) cols.push({ cells });
    }
    /* month labels: one micro-cap per month, at the column that holds its 1st */
    const months: { label: string; col: number }[] = [];
    for (let m = 0; m < 12; m++) {
      const first = Date.UTC(year, m, 1);
      const col = Math.floor((first - startMs) / (7 * MS));
      if (col >= 0 && col < cols.length)
        months.push({ label: "JFMAMJJASOND"[m], col });
    }
    return { year, cols, months };
  });

  /** C5 — one hue, stepped by shade: the i-th legend genre gets the i-th opacity. */
  const crossShade = (label: string): string => {
    if (label === "Other") return "var(--hair)";
    const i = crossLegend.indexOf(label);
    const opacities = [1, 0.82, 0.64, 0.48, 0.34, 0.22];
    return `color-mix(in oklab, var(--accent) ${Math.round(
      (opacities[i] ?? 0.15) * 100,
    )}%, transparent)`;
  };

  /* ---- B5 — condition × price scatter geometry ---- */
  const scatterGeom = $derived.by(() => {
    if (!s.scatter || s.scatter.length === 0) return null;
    const W = 340;
    const H = 150;
    const padL = 10;
    const padB = 18;
    const padT = 8;
    const maxP = Math.max(...s.scatter.map((d) => d.y));
    const x = (i: number) => padL + ((i + 0.5) / 8) * (W - padL * 2);
    const y = (p: number) => H - padB - (p / maxP) * (H - padB - padT);
    return {
      W,
      H,
      padB,
      dots: s.scatter.map((d) => ({ x: x(d.x), y: y(d.y), label: d.label })),
    };
  });
  const condTicks = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"].reverse();

  /* ---- C5 — cross-tab legend (union of the top genre labels across rows) ---- */
  const crossLegend = $derived.by(() => {
    const seen = new Map<string, number>();
    for (const row of s.cross_tab)
      for (const seg of row.segments)
        if (seg.label !== "Other")
          seen.set(seg.label, Math.max(seen.get(seg.label) ?? 0, seg.count));
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label]) => label);
  });
</script>

<svelte:head><title>mynyl — by the numbers</title></svelte:head>

<!-- Hairline bar row: label left, italic serif number right (count or money). -->
{#snippet barRows(
  rows: { label: string; num: number; display: string }[],
  hrefFor: (label: string) => string | null = () => null,
)}
  {@const max = rows.reduce((m, r) => Math.max(m, r.num), 0)}
  <ul class="flex flex-col gap-3.5">
    {#each rows as r (r.label)}
      {@const href = hrefFor(r.label)}
      <li
        class="grid grid-cols-[88px_1fr_auto] items-center gap-4 sm:grid-cols-[110px_1fr_auto]"
      >
        {#if href}
          <a
            {href}
            class="truncate text-[13px] transition-colors duration-300 hover:text-accent"
            >{r.label}</a
          >
        {:else}
          <span class="truncate text-[13px]">{r.label}</span>
        {/if}
        <span class="relative block h-[3px] w-full bg-surface-2">
          <span
            class="absolute inset-y-0 left-0 bg-accent transition-[width] duration-500"
            style={`width: ${max ? Math.max((r.num / max) * 100, 2) : 0}%`}
          ></span>
        </span>
        <span class="font-display text-[14px] italic text-muted"
          >{r.display}</span
        >
      </li>
    {/each}
  </ul>
{/snippet}

<!-- page head — editorial, mirrors home -->
<header
  class="flex flex-wrap items-end justify-between gap-6 border-b border-edge pb-7"
>
  <div class="max-w-3xl">
    <h1
      class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em] sm:text-[52px]"
    >
      By the numbers.
    </h1>
    {#if abstract}
      <p
        class="mt-3 font-display text-[15px] italic leading-relaxed text-muted"
      >
        {abstract}
      </p>
    {:else}
      <p class="mt-3 font-display text-[15px] italic text-muted">
        The index, audited — what the shelves hold, and what they cost.
      </p>
    {/if}
  </div>
  <div class="hidden text-right sm:block">
    <div
      class="text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
    >
      The Index
    </div>
    <div class="mt-1 font-display text-[13px] italic text-faint">
      vol. i — by the numbers
    </div>
  </div>
</header>

{#if s.total === 0}
  <div
    class="flex flex-col items-center border-b border-hair py-20 text-center"
  >
    <p class="mb-2 font-display text-2xl font-normal">Nothing to audit yet</p>
    <p class="mb-7 max-w-sm font-display text-[15px] italic text-muted">
      These pages fill themselves as the collection grows.
    </p>
    <Button href="/scan" variant="primary">Scan a record</Button>
  </div>
{:else}
  <!-- headline counters — a quiet ledger strip, closed by the pace sentence (A4) -->
  <section
    class="grid grid-cols-2 gap-x-6 gap-y-8 border-b border-hair py-9 md:grid-cols-3 lg:grid-cols-5"
  >
    <div>
      <div class="font-display text-[40px] leading-none">{s.in_collection}</div>
      <div
        class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
      >
        in collection
      </div>
    </div>
    <div>
      <div class="font-display text-[40px] leading-none">{s.copies_total}</div>
      <div
        class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
      >
        copies total
      </div>
    </div>
    <div>
      <div class="font-display text-[40px] leading-none">
        {money(s.value_cents)}
      </div>
      <div
        class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
      >
        collection value
      </div>
    </div>
    <div>
      <div class="font-display text-[40px] leading-none">
        {money(s.avg_price_cents)}
      </div>
      <div
        class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
      >
        avg. per entry{s.priced_entries < s.in_collection
          ? ` · ${s.priced_entries} priced`
          : ""}
      </div>
    </div>
    <div>
      <div class="font-display text-[40px] leading-none">
        {s.limited_editions}
      </div>
      <div
        class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
      >
        limited editions
      </div>
    </div>

    {#if paceClauses.length}
      <p
        class="col-span-2 mt-2 border-t border-hair pt-5 font-display text-[15px] italic leading-relaxed text-muted md:col-span-3 lg:col-span-5"
      >
        {paceClauses.join(" · ")}
      </p>
    {/if}
  </section>

  <!-- ══════════════ A1 + A2 + A3 — the rhythm of the shelves ══════════════ -->
  <section class="border-b border-hair py-10">
    <div class="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <h2 class="font-display text-[26px] font-normal leading-tight">
        The rhythm of the shelves
      </h2>
      <nav aria-label="Rhythm window" class="flex flex-wrap items-center gap-6">
        {#each windows as w (w.id)}
          {@const active = window === w.id}
          <a
            href={statsHref(w.id, metric)}
            aria-current={active ? "true" : undefined}
            class={`relative px-0 py-0.5 text-[12px] font-medium uppercase tracking-[.14em] transition-colors duration-300 ${
              active
                ? "text-ink after:absolute after:inset-x-0 after:-bottom-1 after:h-px after:bg-accent"
                : "text-faint hover:text-muted"
            }`}
          >
            {w.label}
          </a>
        {/each}
      </nav>
    </div>

    {#if timeline.length}
      <!-- A1 — vertical hairline columns on a baseline rule. The track scrolls
           sideways on narrow screens so 24 months never smear together. -->
      <div class="overflow-x-auto pb-1">
        <div class="min-w-[520px]">
          <div class="flex items-end gap-[3px] border-b border-edge">
            {#each timeline as b (b.key)}
              <div
                title={`${b.label} — ${b.count}`}
                class="flex h-44 flex-1 basis-0 flex-col justify-end sm:h-52"
              >
                <span class="flex h-32 items-end sm:h-40">
                  {#if b.count > 0}
                    <span
                      class="w-full max-w-[9px] bg-accent transition-[height] duration-500"
                      style={`height: ${Math.max((b.count / maxCount) * 100, 4)}%`}
                    ></span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
          <div class="flex gap-[3px] pt-2">
            {#each timeline as b (b.key)}
              <span class="flex-1 basis-0 text-center">
                {#if b.tick}
                  <span class="text-[9px] uppercase tracking-[.08em] text-faint"
                    >{b.tick_label}</span
                  >
                {/if}
              </span>
            {/each}
          </div>
        </div>
      </div>

      <!-- A2 — cumulative growth: 1px stroke + 8% accent fill, no axes -->
      {#if spark}
        <div class="mt-8">
          <svg
            viewBox="0 0 100 48"
            preserveAspectRatio="none"
            class="h-12 w-full"
            aria-hidden="true"
          >
            <path d={spark.area} fill="var(--accent)" fill-opacity="0.08" />
            <path
              d={spark.line}
              fill="none"
              stroke="var(--accent-dim)"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <p class="mt-2 font-display text-[13px] italic text-faint">
            the shelf grew from 0 → {finalCum}.
          </p>
        </div>
      {/if}

      {#if s.undated_count > 0}
        <p
          class="mt-4 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"
        >
          {s.undated_count} undated — waiting for an acquired date
        </p>
      {/if}

      {#if window !== "all" && s.pace.windowed === 0}
        <p class="mt-4 font-display text-[13px] italic text-faint">
          nothing picked up over {s.pace.label} — the shelf kept its shape.
        </p>
      {/if}
    {:else}
      <p class="font-display text-[15px] italic text-muted">
        No dated acquisitions yet — add an acquired date to any record and the
        shelf starts telling its story.
      </p>
    {/if}

    <!-- A3 — the year in the calendar: one hairline square per day, two-step gold -->
    {#if heat}
      <div class="mt-12">
        <h3
          class="mb-4 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          {heat.year}, day by day
        </h3>
        <div class="overflow-x-auto pb-1">
          <div class="min-w-[480px]">
            <div class="mb-1 flex gap-px">
              {#each heat.cols as c, i (i)}
                {@const lbl = heat.months.find((m) => m.col === i)}
                <span
                  class="flex h-3 w-[11px] shrink-0 items-center text-[8.5px] uppercase tracking-wide text-faint"
                >
                  {lbl?.label}
                </span>
              {/each}
            </div>
            <div class="flex gap-px">
              {#each heat.cols as c, ci (ci)}
                <div class="flex flex-col gap-px">
                  {#each c.cells as cell, j (j)}
                    {#if cell.n >= 0}
                      <span
                        title={cell.n
                          ? `${cell.key} — ${cell.n} acquisition${cell.n > 1 ? "s" : ""}`
                          : cell.key}
                        class="h-[11px] w-[11px] shrink-0 border"
                        style:background-color={cell.n > 1
                          ? "var(--accent)"
                          : cell.n === 1
                            ? "var(--accent-dim)"
                            : "transparent"}
                        style:border-color={cell.n > 0
                          ? "transparent"
                          : "var(--hair)"}
                      ></span>
                    {/if}
                  {/each}
                </div>
              {/each}
            </div>
            <p class="mt-3 font-display text-[12.5px] italic text-faint">
              quiet days in hairline · a week of hunting in gold.
            </p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Fresh wax — the most recent arrivals, in cover art -->
    {#if s.fresh.length}
      <div class="mt-10">
        <h3
          class="mb-5 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          Fresh wax
        </h3>
        <div class="flex gap-5 overflow-x-auto pb-2">
          {#each s.fresh as f (f.id)}
            <a href={`/records/${f.id}`} class="group w-[84px] shrink-0">
              <CoverImage
                src={f.cover ? `/media/${f.cover}` : null}
                alt=""
                class="aspect-square w-full transition-opacity duration-300 group-hover:opacity-85"
              />
              <span
                class="mt-2 block truncate font-display text-[13px] italic leading-snug transition-colors duration-300 group-hover:text-accent"
                >{f.artist}</span
              >
              <span class="block truncate text-[11px] leading-snug text-faint">
                {f.title}
                {#if f.year}<span class="text-muted"> · {f.year}</span>{/if}
              </span>
            </a>
          {/each}
        </div>
      </div>
    {/if}
  </section>

  <!-- ══════════════ what it cost — B1, B2, B3, B5 ══════════════ -->
  <section class="border-b border-hair py-10">
    <div class="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <h2 class="font-display text-[26px] font-normal leading-tight">
        What it cost
      </h2>
      <nav aria-label="Money metric" class="flex items-center gap-6">
        {#each [{ id: "count", label: "Counts" }, { id: "value", label: "Spend" }] as m (m.id)}
          {@const active = metric === m.id}
          <a
            href={statsHref(window, m.id as StatsMetric)}
            aria-current={active ? "true" : undefined}
            class={`relative px-0 py-0.5 text-[12px] font-medium uppercase tracking-[.14em] transition-colors duration-300 ${
              active
                ? "text-ink after:absolute after:inset-x-0 after:-bottom-1 after:h-px after:bg-accent"
                : "text-faint hover:text-muted"
            }`}
          >
            {m.label}
          </a>
        {/each}
      </nav>
    </div>

    <div class="grid gap-x-14 gap-y-12 md:grid-cols-2">
      <!-- B1 — spend histogram, five readable bands -->
      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          Where the money goes
        </h3>
        {#if s.price_bands.length}
          {@const maxBand = Math.max(...s.price_bands.map((b) => b.count), 1)}
          <div class="flex h-40 items-end gap-5 border-b border-edge pb-0">
            {#each s.price_bands as b (b.label)}
              <div
                class="flex h-full flex-1 flex-col justify-end"
                title={`${b.label} — ${b.count}`}
              >
                <span
                  class="mb-1.5 text-center font-display text-[13px] italic text-muted"
                  >{b.count}</span
                >
                <span
                  class="mx-auto w-full max-w-[26px] bg-accent transition-[height] duration-500"
                  style={`height: ${Math.max((b.count / maxBand) * 100, 3)}%`}
                ></span>
              </div>
            {/each}
          </div>
          <div class="flex gap-5 pt-2">
            {#each s.price_bands as b (b.label)}
              <span
                class="flex-1 text-center text-[10px] uppercase tracking-[.1em] text-faint"
              >
                {b.label}
              </span>
            {/each}
          </div>
          {#if s.unpriced_entries > 0}
            <p class="mt-4 font-display text-[13px] italic text-faint">
              · {s.unpriced_entries} unpriced on the shelf
            </p>
          {/if}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No prices recorded yet — add them as you sort.
          </p>
        {/if}
      </section>

      <!-- B2 — the priciest ten: a wall of fame in ledger rows -->
      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          The priciest ten
        </h3>
        {#if s.priciest_ten.length}
          <ul class="flex flex-col">
            {#each s.priciest_ten as r, i (r.id)}
              <li
                class="grid grid-cols-[40px_20px_1fr_auto] items-center gap-3 border-b border-hair py-2.5"
              >
                <span class="font-display text-[13px] italic text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <a href={`/records/${r.id}`} class="block h-9 w-9 shrink-0">
                  <CoverImage
                    src={r.cover ? `/media/${r.cover}` : null}
                    alt=""
                    class="h-9 w-9"
                  />
                </a>
                <a
                  href={`/records/${r.id}`}
                  class="min-w-0 transition-colors duration-300 hover:text-accent"
                >
                  <span
                    class="block truncate font-display text-[14px] leading-snug"
                  >
                    {r.artist} — {r.title}
                  </span>
                  <span class="block text-[11px] text-faint">
                    {r.year ?? "undated"}
                  </span>
                </a>
                <span class="font-display text-[15px] italic"
                  >{money(r.price_cents)}</span
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            Nothing priced yet — the wall of fame waits.
          </p>
        {/if}
      </section>

      <!-- B3 — spend by source -->
      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          Where from
        </h3>
        {#if s.by_source.length}
          {@render barRows(sourceRows)}
          <p
            class="mt-6 font-display text-[13px] italic leading-relaxed text-faint"
          >
            name your record shops as the source and this becomes a leaderboard.
          </p>
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No sources recorded yet.
          </p>
        {/if}
      </section>

      <!-- B5 — condition vs. price (hidden unless ≥15 graded + priced) -->
      {#if scatterGeom}
        <section>
          <h3
            class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
          >
            Condition against price
          </h3>
          <svg viewBox={`0 0 ${scatterGeom.W} ${scatterGeom.H}`} class="w-full">
            <!-- hairline axes -->
            <line
              x1="6"
              y1={scatterGeom.H - scatterGeom.padB + 4}
              x2={scatterGeom.W - 4}
              y2={scatterGeom.H - scatterGeom.padB + 4}
              stroke="var(--edge)"
              stroke-width="1"
            />
            <line
              x1="6"
              y1="4"
              x2="6"
              y2={scatterGeom.H - scatterGeom.padB + 4}
              stroke="var(--edge)"
              stroke-width="1"
            />
            {#each scatterGeom.dots as d (d.label)}
              <circle
                cx={d.x}
                cy={d.y}
                r="2.2"
                fill="var(--accent)"
                opacity="0.55"
              >
                <title>{d.label}</title>
              </circle>
            {/each}
          </svg>
          <div
            class="mt-1 flex justify-between px-2 text-[9px] uppercase tracking-[.08em] text-faint"
          >
            {#each condTicks as t (t)}
              <span>{t}</span>
            {/each}
          </div>
          <p class="mt-3 font-display text-[12.5px] italic text-faint">
            most shelves pay a mint premium — check yours.
          </p>
        </section>
      {/if}
    </div>
  </section>

  <!-- ══════════════ the shelves — C1, C2, C3, C4 + the F1 spreads ══════════════ -->
  <section class="border-b border-hair py-10">
    <h2 class="mb-8 font-display text-[26px] font-normal leading-tight">
      What the shelves hold
    </h2>

    <div class="grid gap-x-14 gap-y-12 md:grid-cols-2">
      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          Most collected
        </h3>
        {#if s.top_artists.length}
          {@const maxArtist = Math.max(...s.top_artists.map((a) => a.count), 1)}
          <ul class="flex flex-col gap-3.5">
            {#each s.top_artists as r (r.label)}
              <li
                class="grid grid-cols-[88px_1fr_auto] items-center gap-4 sm:grid-cols-[110px_1fr_auto]"
              >
                <a
                  href={`/?q=${encodeURIComponent(r.label)}`}
                  class="truncate text-[13px] transition-colors duration-300 hover:text-accent"
                  >{r.label}</a
                >
                <span class="relative block h-[3px] w-full bg-surface-2">
                  <span
                    class="absolute inset-y-0 left-0 bg-accent transition-[width] duration-500"
                    style={`width: ${Math.max((r.count / maxArtist) * 100, 2)}%`}
                  ></span>
                </span>
                <span class="font-display text-[14px] italic text-muted"
                  >{r.count}</span
                >
              </li>
            {/each}
          </ul>
          {@const top = s.top_artists[0]}
          <p
            class="mt-6 border-l-2 border-l-edge pl-4 font-display text-[13.5px] italic leading-relaxed text-faint"
          >
            {#if top.count > 1}
              1 in every {Math.max(Math.round(s.total / top.count), 2)} records is
              {top.label}.
            {:else}
              {top.label} leads the shelf.
            {/if}
          </p>
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No artists catalogued yet.
          </p>
        {/if}
      </section>

      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          By genre · {metric === "value" ? "spend" : "counts"}
        </h3>
        {#if s.by_genre.length}
          {@render barRows(genreRows)}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No genres catalogued yet.
          </p>
        {/if}
      </section>

      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          By label · {metric === "value" ? "spend" : "counts"}
        </h3>
        {#if s.by_label.length}
          {@render barRows(labelRows)}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No labels catalogued yet.
          </p>
        {/if}
      </section>

      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          By decade · {metric === "value" ? "spend" : "counts"}
        </h3>
        {@render barRows(decadeRows)}
      </section>

      <!-- C2 — the format spectrum: one segmented rule, 7s vs LPs at a glance -->
      <section class="md:col-span-2">
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          The format spectrum
        </h3>
        {#if s.formats.length}
          {@const totalFormats = s.formats.reduce((t, f) => t + f.count, 0)}
          <div class="flex h-[6px] w-full overflow-hidden bg-surface-2">
            {#each s.formats as f (f.label)}
              <span
                class={f === s.formats[0] ? "bg-accent" : "bg-faint/40"}
                style={`width: ${(f.count / totalFormats) * 100}%`}
              ></span>
            {/each}
          </div>
          <div class="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            {#each s.formats as f (f.label)}
              <span class="flex items-baseline gap-2">
                <span
                  class={f === s.formats[0]
                    ? "text-[10.5px] font-semibold uppercase tracking-[.18em] text-accent"
                    : "text-[10.5px] font-semibold uppercase tracking-[.18em] text-faint"}
                >
                  {f.label}
                </span>
                <span class="font-display text-[14px] italic text-muted"
                  >{f.count}</span
                >
              </span>
            {/each}
          </div>
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No formats recorded yet.
          </p>
        {/if}
      </section>

      <!-- C3 — the condition report: media & sleeve over the Goldmine scale -->
      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          Condition report
        </h3>
        {#if s.condition_media.length || s.condition_sleeve.length}
          {@const condMax = Math.max(
            ...s.condition_media.map((c) => c.count),
            ...s.condition_sleeve.map((c) => c.count),
            1,
          )}
          {#each [{ title: "Media", rows: s.condition_media }, { title: "Sleeve", rows: s.condition_sleeve }] as c (c.title)}
            <div class="mb-6">
              <div
                class="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-muted"
              >
                {c.title}
              </div>
              <ul class="flex flex-col gap-2.5">
                {#each c.rows as r (r.label)}
                  <li class="grid grid-cols-[44px_1fr_auto] items-center gap-3">
                    <span class="text-[11px] uppercase tracking-wide"
                      >{r.label}</span
                    >
                    <span class="relative block h-[2px] w-full bg-surface-2">
                      <span
                        class="absolute inset-y-0 left-0 bg-accent"
                        style={`width: ${Math.max((r.count / condMax) * 100, 3)}%`}
                      ></span>
                    </span>
                    <span class="font-display text-[13px] italic text-muted"
                      >{r.count}</span
                    >
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
          {#if s.condition_report.nm_or_better_pct !== null}
            <p class="font-display text-[13.5px] italic text-faint">
              {s.condition_report.nm_or_better_pct}% of graded media is NM or
              better ·
              {s.condition_report.graded} graded in all.
            </p>
          {/if}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No conditions graded yet.
          </p>
        {/if}
      </section>

      <!-- C4 — styles under genres -->
      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          Styles
        </h3>
        {#if s.by_style.length}
          {@render barRows(
            s.by_style.map((r) => ({
              label: r.label,
              num: r.count,
              display: String(r.count),
            })),
          )}
          <p
            class="mt-6 font-display text-[13px] italic leading-relaxed text-faint"
          >
            the fine print under each genre — where the taste actually lives.
          </p>
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No styles recorded yet.
          </p>
        {/if}
      </section>

      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          Status
        </h3>
        {@render barRows(statusRows)}
        <!-- C7 — the covers footnote, grown into documentation coverage -->
        <p
          class="mt-6 border-l-2 border-l-edge pl-4 font-display text-[13.5px] italic leading-relaxed text-faint"
        >
          {s.covers_local} of {s.total} covers on file
          {#if s.covers_missing > 0}
            — {s.covers_missing} missing,
            <a
              href="/covers"
              class="text-muted underline underline-offset-4 transition-colors hover:text-accent"
              >repair them</a
            >
            .{/if}
          {#if s.photos_total > 0}
            {s.records_with_photos} records carry {s.photos_total} extra photos.
          {/if}{s.sold || s.traded_away
            ? ` The shelves have released ${s.sold + s.traded_away}.`
            : ""}
        </p>
      </section>

      <section class="flex flex-col justify-end">
        {#if s.hero_decade}
          <div class="font-display text-[56px] leading-none tracking-[-.01em]">
            {s.hero_decade.label}
          </div>
          <div
            class="mt-3 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
          >
            {s.hero_decade.share}% of the shelf · {s.hero_decade.count} records
          </div>
          <p class="mt-3 font-display text-[15px] italic text-muted">
            the {s.hero_decade.label} own this room.
          </p>
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No dated pressings yet.
          </p>
        {/if}
      </section>
    </div>
  </section>

  <!-- ══════════════ depth — D2, C5, C6 ══════════════ -->
  <section class="border-b border-hair py-10">
    <h2 class="mb-8 font-display text-[26px] font-normal leading-tight">
      The fine print
    </h2>

    <!-- D2 — oldest pressed / freshest wax: two display numbers -->
    {#if s.extremes.oldest || s.extremes.freshest}
      <div class="mb-12 grid gap-x-6 gap-y-8 sm:grid-cols-2">
        {#if s.extremes.oldest}
          <div>
            <a
              href={`/records/${s.extremes.oldest.id}`}
              class="font-display text-[44px] leading-none transition-colors duration-300 hover:text-accent"
            >
              {s.extremes.oldest.year}
            </a>
            <div
              class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
            >
              oldest on the shelf
            </div>
            <a
              href={`/records/${s.extremes.oldest.id}`}
              class="mt-1 block truncate font-display text-[14px] italic text-muted transition-colors duration-300 hover:text-accent"
            >
              {s.extremes.oldest.artist} — {s.extremes.oldest.title}
            </a>
          </div>
        {/if}
        {#if s.extremes.freshest}
          <div>
            <a
              href={`/records/${s.extremes.freshest.id}`}
              class="font-display text-[44px] leading-none transition-colors duration-300 hover:text-accent"
            >
              {s.extremes.freshest.year}
            </a>
            <div
              class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
            >
              freshest wax
            </div>
            <a
              href={`/records/${s.extremes.freshest.id}`}
              class="mt-1 block truncate font-display text-[14px] italic text-muted transition-colors duration-300 hover:text-accent"
            >
              {s.extremes.freshest.artist} — {s.extremes.freshest.title}
            </a>
          </div>
        {/if}
      </div>
    {/if}

    <div class="grid gap-x-14 gap-y-12 md:grid-cols-2">
      <!-- C5 — how taste moved: one spectrum row per decade -->
      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          How taste moved
        </h3>
        {#if s.cross_tab.length}
          <ul class="flex flex-col gap-4">
            {#each s.cross_tab as row (row.decade)}
              <li class="grid grid-cols-[56px_1fr_auto] items-center gap-4">
                <span class="text-[12px] uppercase tracking-wide text-muted">
                  {row.decade}
                </span>
                <div class="flex h-1 w-full overflow-hidden bg-surface-2">
                  {#each row.segments as seg (seg.label)}
                    <span
                      style:background-color={crossShade(seg.label)}
                      style:width={`${(seg.count / row.total) * 100}%`}
                      title={`${row.decade} · ${seg.label} — ${seg.count}`}
                    ></span>
                  {/each}
                </div>
                <span class="font-display text-[13px] italic text-faint"
                  >{row.total}</span
                >
              </li>
            {/each}
          </ul>
          {#if crossLegend.length}
            <div class="mt-5 flex flex-wrap gap-x-6 gap-y-2">
              {#each crossLegend as g (g)}
                <span class="flex items-center gap-1.5">
                  <span
                    class="h-[7px] w-[7px]"
                    style:background-color={crossShade(g)}
                  ></span>
                  <span
                    class="text-[10px] uppercase tracking-[.14em] text-faint"
                    >{g}</span
                  >
                </span>
              {/each}
            </div>
          {/if}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            Needs dated, genred records to chart the drift.
          </p>
        {/if}
      </section>

      <!-- C6 — duplicate watch -->
      <section>
        <h3
          class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
        >
          Duplicate watch
        </h3>
        {#if s.duplicates}
          <ul class="flex flex-col">
            {#each s.duplicates.rows as r (r.id)}
              <li class="border-b border-hair py-2.5">
                <a
                  href={`/records/${r.id}`}
                  class="group flex items-baseline justify-between gap-4 transition-colors duration-300 hover:text-accent"
                >
                  <span
                    class="min-w-0 truncate font-display text-[14px] leading-snug"
                  >
                    {r.artist} — {r.title}
                  </span>
                  <span
                    class="shrink-0 font-display text-[14px] italic text-muted"
                  >
                    ×{r.copies}
                  </span>
                </a>
              </li>
            {/each}
          </ul>
          <p
            class="mt-5 font-display text-[13.5px] italic leading-relaxed text-faint"
          >
            {s.duplicates.entries} titles kept in more than one copy — the biggest
            stack runs to {s.duplicates.biggest_copies}.
          </p>
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            Every title once — a clean shelf.
          </p>
        {/if}
      </section>
    </div>

    <!-- closing footnote, ledger voice -->
    <p
      class="mt-12 border-l-2 border-l-edge pl-4 font-display text-[13.5px] italic leading-relaxed text-faint"
    >
      Audited {s.total} records · {s.priced_entries} priced · {s.formats.length
        ? `${s.formats[0].label.toLowerCase()}s lead the format mix`
        : "formats unrecorded"}
      {#if s.hero_decade}· the {s.hero_decade.label} own this room{/if}.
    </p>
  </section>
{/if}
