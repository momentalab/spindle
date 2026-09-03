<script lang="ts">
  import type { PageData } from "./$types";
  import type { StatsMetric, StatsWindow } from "$lib/server/stats";
  import Button from "$lib/components/ui/Button.svelte";
  import CoverImage from "$lib/components/ui/CoverImage.svelte";
  import DecadeLabel from "$lib/components/ui/DecadeLabel.svelte";
  import { appTitle } from "$lib/index";
  import { CONDITIONS, STATUS_LABELS } from "$lib/types";

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

  const MONTHS_SHORT = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ] as const;
  /** Deterministic 'Aug 30, 2026' from an ISO datetime (no locale drift). */
  function fmtPlayedAt(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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

  /* By-genre bars carry one stable hue per genre (rank order) — the same mapping
     the C5 cross-tab uses, so a genre reads the same color in both places. */
  const genreRows = $derived(
    metricRows(s.by_genre).map((r) => ({ ...r, color: catColor(r.label) })),
  );
  /* One hue per chart family so neighbors in the grid never read the same color;
     time (rhythm/decades) keeps the house gold. */
  const labelRows = $derived(
    metricRows(s.by_label).map((r) => ({ ...r, color: CATEGORICAL[2] })),
  );
  /* Decades step one gold hue light (oldest) → dark (newest); "Undated" stays
     neutral so it doesn't read as part of the chronology. */
  const decadeRows = $derived(
    s.by_decade.map((r, i) => ({
      label: r.label,
      num: metric === "value" ? r.value_cents : r.count,
      display: metric === "value" ? fmtValue(r.value_cents) : String(r.count),
      color:
        r.label === "Undated"
          ? "var(--faint)"
          : stepShade("var(--accent)", i, s.by_decade.length),
    })),
  );
  const sourceRows = $derived(
    metricRows(s.by_source).map((r) => ({ ...r, color: CATEGORICAL[3] })),
  );

  /* Status keeps its existing semantic tones (matches the collection badges);
     wanted is plum — the pre-ownership end of the shelf (F5). */
  const STATUS_COLORS: Record<string, string> = {
    in_collection: "var(--forest)",
    sold: "var(--butter)",
    traded_away: "var(--faint)",
    wanted: "var(--plum)",
  };
  /** Statuses rendered on the same bar scale as the other distributions. */
  const statusRows = $derived(
    s.statuses.map((st) => ({
      label: STATUS_LABELS[st.status] ?? st.status,
      num: st.count,
      display: String(st.count),
      color: STATUS_COLORS[st.status] ?? "var(--faint)",
    })),
  );

  function statsHref(w: StatsWindow, m: StatsMetric): string {
    const p = new URLSearchParams();
    if (w !== "all") p.set("window", w);
    if (m !== "count") p.set("metric", m);
    const qs = p.toString();
    return qs ? `/stats?${qs}` : "/stats";
  }

  /* ---- D1 — the abstract: one line per idea. The key figures break out of
     the muted italic voice (upright, heavier, a touch larger) so the data leads. ---- */
  type Part = { t: string; h: boolean };
  const seg = (t: string, h = false): Part => ({ t, h });
  const abstractLines = $derived.by((): Part[][] => {
    if (!s.total) return [];
    const lines: Part[][] = [];
    const genre = s.by_genre[0];
    const artist = s.top_artists[0];

    // line one — what the shelf holds
    const l1: Part[] = [
      seg(String(s.in_collection), true),
      seg(" records on the shelf"),
    ];
    if (genre) l1.push(seg(", mostly "), seg(genre.label, true));
    // F5 — the wishlist is off-shelf, but part of the story.
    if (s.wanted > 0)
      l1.push(seg(", and "), seg(String(s.wanted), true), seg(" still wanted"));
    l1.push(seg("."));
    lines.push(l1);

    // line two — the artist it leans on, and the median pressing year
    if (artist) {
      const l2: Part[] = [
        seg(
          artist.count > 1
            ? "The shelf leans on "
            : "The shelf is anchored by ",
        ),
        seg(artist.label, true),
      ];
      if (s.median_year)
        l2.push(
          seg(", with a median pressing year of "),
          seg(String(s.median_year), true),
        );
      l2.push(seg("."));
      lines.push(l2);
    } else if (s.median_year) {
      lines.push([
        seg("Median pressing year "),
        seg(String(s.median_year), true),
        seg("."),
      ]);
    }

    // line three — the priciest pressing
    if (s.priciest) {
      lines.push([
        seg("The priciest pressing on the shelf is "),
        seg(`${s.priciest.artist} — ${s.priciest.title}`, true),
        seg(", at "),
        seg(money(s.priciest.price_cents), true),
        seg("."),
      ]);
    }

    // line four — where the new arrivals leaned (windowed view only)
    if (window !== "all" && s.window_top_genre && s.pace.windowed > 0) {
      lines.push([
        seg(`Over ${s.pace.label}, new arrivals leaned `),
        seg(s.window_top_genre.label, true),
        seg("."),
      ]);
    }

    // line five — the record that keeps coming back
    if (s.most_played[0]) {
      const top = s.most_played[0];
      lines.push([
        seg("Most spun on the shelf: "),
        seg(`${top.artist} — ${top.title}`, true),
        seg(
          `, with ${top.plays} ${top.plays === 1 ? "spin" : "spins"} logged.`,
        ),
      ]);
    }
    return lines;
  });

  /* ---- A4 — the pace strip, ledger voice: one number per stat, each with
     its own label so nothing smears into a dense run-on sentence. ---- */
  const paceStats = $derived.by((): { value: string; label: string }[] => {
    const p = s.pace;
    if (p.windowed > 0) {
      const pm =
        p.per_month % 1 === 0 ? String(p.per_month) : p.per_month.toFixed(1);
      const stats: { value: string; label: string }[] = [
        { value: pm, label: `per month · ${p.label}` },
      ];
      if (p.biggest) {
        const unit = timeline[0]?.key.length === 4 ? "year" : "month";
        stats.push({
          value: String(p.biggest.count),
          label: `in ${p.biggest.label} · biggest ${unit}`,
        });
      }
      if (p.drought_weeks > 0)
        stats.push({
          value: String(p.drought_weeks),
          label:
            p.drought_weeks === 1
              ? "week, longest drought"
              : "weeks, longest drought",
        });
      if (p.oldest_acquired)
        stats.push({
          value: p.oldest_acquired,
          label: "oldest on the shelf",
        });
      return stats;
    }
    return [];
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

  /* ---- Chart color system: one hue per chart family so neighboring charts
     never read the same color. Time stays the house gold; ordinal charts
     (price bands, conditions, decades) step a single hue light → dark. ---- */
  const CATEGORICAL = [
    "var(--accent)",
    "var(--chart-moss)",
    "var(--chart-clay)",
    "var(--chart-slate)",
    "var(--chart-mauve)",
  ] as const;

  /** Stable hue per legend genre (rank order) — shared by the genre bars and C5. */
  const catColor = (label: string): string => {
    if (label === "Other") return "var(--hair)";
    const i = crossLegend.indexOf(label);
    return CATEGORICAL[i % CATEGORICAL.length] ?? "var(--hair)";
  };

  /** Ordinal shade: rank i of total → 38% (lightest) up to full strength of the hue. */
  const stepShade = (token: string, rank: number, total: number): string => {
    const t = total <= 1 ? 1 : 0.38 + (rank / (total - 1)) * 0.62;
    return `color-mix(in oklab, ${token} ${Math.round(t * 100)}%, transparent)`;
  };

  /* C3/B5 — Goldmine scale shared mapping: best grade (M) is the deepest moss,
     worst (P) the lightest; fixed 8-step scale so a lone "P" still reads faint. */
  const condColor = (label: string): string => {
    const idx = (CONDITIONS as readonly string[]).indexOf(label);
    if (idx === -1) return "var(--chart-moss)";
    return stepShade(
      "var(--chart-moss)",
      CONDITIONS.length - 1 - idx,
      CONDITIONS.length,
    );
  };

  /** Content-aware bar column width: fits its uppercase label (~7.2px/char at
      10.5px + tracking), clamped so one long name can't stretch the track. */
  const barColWidth = (label: string): number =>
    Math.min(150, Math.max(58, Math.round(label.length * 7.2) + 18));

  /* Right-edge fade on the horizontally scrollable tracks, so a cut-off chart
     announces that it continues. Re-runs when the sections owning the tracks
     mount or unmount (data changes with window/metric/total). */
  $effect(() => {
    void s.total;
    void window;
    void metric;
    const update = () => {
      document
        .querySelectorAll<HTMLElement>("[data-scroll-fade]")
        .forEach((el) =>
          el.toggleAttribute(
            "data-fade",
            el.scrollWidth - el.clientWidth - el.scrollLeft > 4,
          ),
        );
    };
    const els = document.querySelectorAll<HTMLElement>("[data-scroll-fade]");
    els.forEach((el) =>
      el.addEventListener("scroll", update, { passive: true }),
    );
    globalThis.addEventListener("resize", update);
    return () => {
      els.forEach((el) => el.removeEventListener("scroll", update));
      globalThis.removeEventListener("resize", update);
    };
  });

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

<svelte:head><title>{appTitle("Stats")}</title></svelte:head>

<!-- Vertical bar chart: value above, bar rising from a baseline rule, label
below. Bars stay legible instead of crushing: every column is at least as wide
as its (uppercased) label — no truncation anywhere — and long rows scroll
sideways inside their own box with an edge fade hinting at more content. -->
{#snippet barChart(
  rows: {
    label: string;
    num: number;
    display: string;
    color?: string;
  }[],
  hrefFor: (label: string) => string | null = () => null,
)}
  {@const max = rows.reduce((m, r) => Math.max(m, r.num), 0)}
  <div class="relative">
    <div class="chart-scroll pb-1" data-scroll-fade>
      <div class="flex items-end gap-x-3 sm:gap-x-4">
        {#each rows as r (r.label)}
          {@const href = hrefFor(r.label)}
          <!-- grow to fill short rows, but never shrink below the label's width
               — the track scrolls instead of crushing the label -->
          <div
            class="flex flex-col grow shrink-0"
            style={`width: ${barColWidth(r.label)}px`}
            title={`${r.label} — ${r.display}`}
          >
            <span
              class="mb-1.5 truncate text-center font-display text-[13px] italic leading-none text-muted"
              >{r.display}</span
            >
            <div
              class="flex h-28 items-end justify-center border-b border-edge"
            >
              <span
                class="w-full max-w-[22px] transition-[height] duration-500"
                style={`height: ${max ? Math.max((r.num / max) * 100, 3) : 0}%; background-color: ${r.color ?? "var(--accent)"}`}
              ></span>
            </div>
            <div
              class="pt-2 text-center text-[10.5px] uppercase leading-[1.5] tracking-[.08em]"
            >
              {#if href}
                <a
                  {href}
                  class="transition-colors duration-300 hover:text-accent"
                >
                  <DecadeLabel label={r.label} />
                </a>
              {:else}
                <span class="text-muted">
                  <DecadeLabel label={r.label} />
                </span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
    <div class="chart-fade" aria-hidden="true"></div>
  </div>
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
    {#if abstractLines.length}
      <div class="mt-5 flex max-w-3xl flex-col gap-1.5">
        {#each abstractLines as line, i (i)}
          <p
            class="font-display text-[17px] italic leading-relaxed text-muted sm:text-[18px]"
          >
            {#each line as part, j (j)}
              {#if part.h}
                <span
                  class="not-italic font-semibold tracking-normal text-ink sm:text-[20px]"
                  >{part.t}</span
                >
              {:else}
                {part.t}
              {/if}
            {/each}
          </p>
        {/each}
      </div>
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
  <!-- headline counters — a quiet ledger strip, closed by the pace stats (A4) -->
  <section
    class="grid grid-cols-2 gap-x-6 gap-y-8 border-b border-hair py-9 md:grid-cols-3 lg:grid-cols-5"
  >
    <div>
      <div class="font-display text-[40px] leading-none">{s.in_collection}</div>
      <div
        class="mt-2 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
      >
        in collection
        <!-- F5 — the wishlist readout, quiet and off-shelf. -->
        {#if s.wanted > 0}
          <a
            href="/?status=wanted"
            class="ml-2 font-display italic tracking-normal normal-case text-plum underline decoration-hair underline-offset-4 hover:decoration-plum"
          >
            {s.wanted} wanted
          </a>
        {/if}
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

    <!-- A4 — the pace: quiet mini stats across the strip's full width -->
    <div
      class="col-span-2 mt-7 border-t border-hair pt-6 md:col-span-3 lg:col-span-5"
    >
      {#if paceStats.length}
        <div class="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
          {#each paceStats as st, i (i)}
            <div>
              <div
                class="font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px]"
              >
                {st.value}
              </div>
              <div
                class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"
              >
                {st.label}
              </div>
            </div>
          {/each}
        </div>
      {/if}
      <!-- D5 — the next milestone, on its own row so it reads as a goal,
           not another acquisition stat -->
      <div
        class="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-hair pt-5"
      >
        <span
          class="shrink-0 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"
          >Next milestone</span
        >
        <span class="font-display text-[16px] italic leading-snug text-muted">
          <span class="not-italic font-semibold text-ink"
            >{s.milestone.remaining}</span
          >
          records to {s.milestone.next}
        </span>
      </div>
    </div>
  </section>

  <!-- ══════════════ the spin log — what actually gets played ══════════════ -->
  {#if s.plays_total > 0}
    <section class="border-b border-hair py-10">
      <div
        class="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4"
      >
        <h2 class="font-display text-[26px] font-normal leading-tight">
          The spin log
        </h2>
        <p
          class="max-w-md text-right font-display text-[13.5px] italic leading-relaxed text-faint"
        >
          {s.plays_total}
          {s.plays_total === 1 ? "spin" : "spins"} logged across
          {s.records_played}
          {s.records_played === 1 ? "record" : "records"} — what actually gets played.
        </p>
      </div>

      <!-- the most-played five: ranked ledger rows, quiet and clickable -->
      <div class="flex flex-col">
        {#each s.most_played as p, i (p.id)}
          <a
            href="/records/{p.id}"
            class="group grid grid-cols-[20px_48px_minmax(0,1fr)_auto] items-center gap-3 border-b border-hair py-3.5 transition-[padding] duration-200 hover:pl-2 sm:grid-cols-[28px_64px_1fr_auto] sm:gap-5 sm:py-4"
          >
            <span
              class="font-display text-[13px] italic text-faint sm:text-[15px]"
              >{String(i + 1).padStart(2, "0")}</span
            >
            <span class="block h-12 w-12 shrink-0 sm:h-16 sm:w-16">
              <CoverImage src={p.cover} alt="" loading="lazy" />
            </span>
            <span class="min-w-0">
              <span
                title={p.artist}
                class="block truncate font-display text-[16px] tracking-[.005em] transition-colors group-hover:text-accent sm:text-[20px]"
              >
                {p.artist}
              </span>
              <span
                title={p.title}
                class="mt-0.5 block truncate text-[13px] text-muted sm:text-[13.5px]"
              >
                {p.title}
              </span>
            </span>
            <span class="flex shrink-0 flex-col items-end gap-1 text-right">
              <span
                class="font-display text-[19px] leading-none sm:text-[21px]"
              >
                {p.plays}
              </span>
              <!-- the last-played date is desktop-only: on a 360px row it would
                   steal the width artist/title need (full date stays in `title`). -->
              <span
                title={p.last_played_at
                  ? fmtPlayedAt(p.last_played_at)
                  : undefined}
                class="text-[10px] font-semibold uppercase tracking-[.2em] text-faint"
              >
                {p.plays === 1 ? "spin" : "spins"}
                {#if p.last_played_at}
                  <span class="hidden sm:inline"
                    >· last {fmtPlayedAt(p.last_played_at)}</span
                  >
                {/if}
              </span>
            </span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ══════════════ A1 + A2 + A3 — the rhythm of the shelves ══════════════ -->
  <section class="border-b border-hair py-10">
    <div class="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <h2 class="font-display text-[26px] font-normal leading-tight">
        The rhythm of the shelves
      </h2>
      <!-- data-sveltekit-noscroll: toggling the window re-fetches in place;
           keep the reader where they are instead of jumping to the top. -->
      <nav
        aria-label="Rhythm window"
        data-sveltekit-noscroll
        class="flex flex-wrap items-center gap-6"
      >
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
      <!-- A1 — vertical hairline columns on a baseline rule. The track is at
           least wide enough that each column keeps its tick label and scrolls
           sideways beyond that, so 24 months never smear together. -->
      <div class="relative">
        <div class="chart-scroll pb-1" data-scroll-fade>
          <div style={`min-width: ${Math.max(timeline.length * 34, 520)}px`}>
            <div class="flex items-end gap-[3px] border-b border-edge">
              {#each timeline as b, i (b.key)}
                <div
                  title={`${b.label} — ${b.count}`}
                  class="flex h-44 flex-1 basis-0 flex-col justify-end sm:h-52"
                >
                  <span class="flex h-32 items-end sm:h-40">
                    {#if b.count > 0}
                      <span
                        class="w-full max-w-[9px] transition-[height] duration-500"
                        style={`height: ${Math.max((b.count / maxCount) * 100, 4)}%; background-color: ${stepShade("var(--accent)", i, timeline.length)}`}
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
                    <span
                      class="whitespace-nowrap text-[9px] uppercase tracking-[.08em] text-faint"
                      >{b.tick_label}</span
                    >
                  {/if}
                </span>
              {/each}
            </div>
          </div>
        </div>
        <div class="chart-fade" aria-hidden="true"></div>
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
        <div class="relative">
          <div class="chart-scroll pb-1" data-scroll-fade>
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
            </div>
          </div>
          <div class="chart-fade" aria-hidden="true"></div>
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
      <!-- data-sveltekit-noscroll: same as above for the metric toggle. -->
      <nav
        aria-label="Money metric"
        data-sveltekit-noscroll
        class="flex items-center gap-6"
      >
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

    <!-- grid-cols-1 (minmax(0,1fr)) gives the track a zero floor; without it
         an implicit auto track sizes to a child's min-content and blows the
         page width past the viewport. -->
    <div class="grid grid-cols-1 gap-x-14 gap-y-12 md:grid-cols-2">
      <!-- B1 — spend histogram, five readable bands -->
      <section>
        <h3 class="stat-section-title">Where the money goes</h3>
        {#if s.price_bands.length}
          {@render barChart(
            s.price_bands.map((b, i) => ({
              label: b.label,
              num: b.count,
              display: String(b.count),
              color: stepShade("var(--accent)", i, s.price_bands.length),
            })),
          )}
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
        <h3 class="stat-section-title">The priciest ten</h3>
        {#if s.priciest_ten.length}
          <ul class="flex flex-col">
            {#each s.priciest_ten as r, i (r.id)}
              <li
                class="grid grid-cols-[40px_32px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-hair py-2.5"
              >
                <span class="font-display text-[13px] italic text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <a href={`/records/${r.id}`} class="block h-8 w-8 shrink-0">
                  <CoverImage
                    src={r.cover ? `/media/${r.cover}` : null}
                    alt=""
                    class="h-8 w-8"
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
                  <span class="block truncate text-[11px] text-faint">
                    {r.year ?? "undated"}
                  </span>
                </a>
                <span
                  class="shrink-0 whitespace-nowrap font-display text-[15px] italic"
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
        <h3 class="stat-section-title">Where from</h3>
        {#if s.by_source.length}
          {@render barChart(sourceRows)}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No sources recorded yet.
          </p>
        {/if}
      </section>

      <!-- B5 — condition vs. price (hidden unless ≥15 graded + priced). Dots
           step moss light (P, worst) → dark (M, best): better grade, deeper fill. -->
      {#if scatterGeom}
        <section>
          <h3 class="stat-section-title">Condition against price</h3>
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
                fill={stepShade("var(--chart-moss)", d.x, CONDITIONS.length)}
                opacity="0.75"
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
        </section>
      {/if}
    </div>
  </section>

  <!-- ══════════════ the shelves — C1, C2, C3, C4 + the F1 spreads ══════════════ -->
  <section class="border-b border-hair py-10">
    <h2 class="mb-8 font-display text-[26px] font-normal leading-tight">
      What the shelves hold
    </h2>

    <div class="grid grid-cols-1 gap-x-14 gap-y-12 md:grid-cols-2">
      <section>
        <h3 class="stat-section-title">Most collected</h3>
        {#if s.top_artists.length}
          {@render barChart(
            s.top_artists.map((r) => ({
              label: r.label,
              num: r.count,
              display: String(r.count),
              color: CATEGORICAL[1],
            })),
            (label) => `/?q=${encodeURIComponent(label)}`,
          )}
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
        <h3 class="stat-section-title">
          By genre · {metric === "value" ? "spend" : "counts"}
        </h3>
        {#if s.by_genre.length}
          {@render barChart(genreRows)}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No genres catalogued yet.
          </p>
        {/if}
      </section>

      <section>
        <h3 class="stat-section-title">
          By label · {metric === "value" ? "spend" : "counts"}
        </h3>
        {#if s.by_label.length}
          {@render barChart(labelRows)}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No labels catalogued yet.
          </p>
        {/if}
      </section>

      <section>
        <h3 class="stat-section-title">
          By decade · {metric === "value" ? "spend" : "counts"}
        </h3>
        {@render barChart(decadeRows)}
      </section>

      <!-- C2 — the format spectrum: one segmented rule, 7s vs LPs at a glance -->
      <section class="md:col-span-2">
        <h3 class="stat-section-title">The format spectrum</h3>
        {#if s.formats.length}
          {@render barChart(
            s.formats.map((f) => ({
              label: f.label,
              num: f.count,
              display: String(f.count),
              color: CATEGORICAL[3],
            })),
          )}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No formats recorded yet.
          </p>
        {/if}
      </section>

      <!-- C3 — the condition report: media & sleeve over the Goldmine scale -->
      <section>
        <h3 class="stat-section-title">Condition report</h3>
        {#if s.condition_media.length || s.condition_sleeve.length}
          {#each [{ title: "Media", rows: s.condition_media }, { title: "Sleeve", rows: s.condition_sleeve }] as c (c.title)}
            <div class="mb-8">
              <div
                class="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-muted"
              >
                {c.title}
              </div>
              {@render barChart(
                c.rows.map((r) => ({
                  label: r.label,
                  num: r.count,
                  display: String(r.count),
                  color: condColor(r.label),
                })),
              )}
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
        <h3 class="stat-section-title">Styles</h3>
        {#if s.by_style.length}
          {@render barChart(
            s.by_style.map((r) => ({
              label: r.label,
              num: r.count,
              display: String(r.count),
              color: CATEGORICAL[4],
            })),
          )}
        {:else}
          <p class="font-display text-[14px] italic text-muted">
            No styles recorded yet.
          </p>
        {/if}
      </section>

      <section>
        <h3 class="stat-section-title">Status</h3>
        {@render barChart(statusRows)}
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
            <DecadeLabel label={s.hero_decade.label} />
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
      <div class="mb-12 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2">
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

    <div class="grid grid-cols-1 gap-x-14 gap-y-12 md:grid-cols-2">
      <!-- C5 — how taste moved: one spectrum row per decade -->
      <section>
        <h3 class="stat-section-title">How taste moved</h3>
        {#if s.cross_tab.length}
          <ul class="flex flex-col gap-4">
            {#each s.cross_tab as row (row.decade)}
              <li class="grid grid-cols-[72px_1fr_auto] items-center gap-4">
                <span class="text-[12px] uppercase tracking-wide text-muted">
                  <DecadeLabel label={row.decade} />
                </span>
                <div class="flex h-1 w-full overflow-hidden bg-surface-2">
                  {#each row.segments as seg (seg.label)}
                    <span
                      style:background-color={catColor(seg.label)}
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
                    style:background-color={catColor(g)}
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
        <h3 class="stat-section-title">Duplicate watch</h3>
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
        : "formats unrecorded"}.
    </p>
  </section>
{/if}
