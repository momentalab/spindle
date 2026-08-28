<script lang="ts">
  import type { PageData } from "./$types";
  import type { StatBarRow } from "$lib/server/stats";
  import Button from "$lib/components/ui/Button.svelte";
  import { STATUS_LABELS } from "$lib/types";

  let { data }: { data: PageData } = $props();
  const s = $derived(data.stats);

  /** Statuses rendered on the same bar scale as the other distributions. */
  const statusRows = $derived(
    s.statuses.map((st) => ({
      label: STATUS_LABELS[st.status] ?? st.status,
      count: st.count,
    })),
  );

  function money(cents: number | null): string {
    if (cents === null) return "—";
    return `$${(cents / 100).toFixed(2)}`;
  }
</script>

<svelte:head><title>mynyl — by the numbers</title></svelte:head>

{#snippet barRows(rows: StatBarRow[])}
  {@const max = rows.reduce((m, r) => Math.max(m, r.count), 0)}
  <ul class="flex flex-col gap-3.5">
    {#each rows as r (r.label)}
      <li
        class="grid grid-cols-[88px_1fr_auto] items-center gap-4 sm:grid-cols-[110px_1fr_auto]"
      >
        <span class="truncate text-[13px]">{r.label}</span>
        <span class="relative block h-[3px] w-full bg-surface-2">
          <span
            class="absolute inset-y-0 left-0 bg-accent transition-[width] duration-500"
            style={`width: ${max ? Math.max((r.count / max) * 100, 2) : 0}%`}
          ></span>
        </span>
        <span class="font-display text-[14px] italic text-muted">{r.count}</span
        >
      </li>
    {/each}
  </ul>
{/snippet}

<!-- page head — editorial, mirrors home -->
<header
  class="flex flex-wrap items-end justify-between gap-6 border-b border-edge pb-7"
>
  <div>
    <p
      class="mb-3.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
    >
      The Collection — Annex
    </p>
    <h1
      class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em] sm:text-[52px]"
    >
      By the numbers.
    </h1>
    <p class="mt-3 font-display text-[15px] italic text-muted">
      The index, audited — what the shelves hold, and what they cost.
    </p>
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
  <!-- headline counters — a quiet ledger strip -->
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
  </section>

  <!-- distributions -->
  <div class="grid gap-x-14 gap-y-12 border-b border-hair py-12 md:grid-cols-2">
    <section>
      <h2
        class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
      >
        By genre
      </h2>
      {#if s.by_genre.length}
        {@render barRows(s.by_genre)}
      {:else}
        <p class="font-display text-[14px] italic text-muted">
          No genres catalogued yet.
        </p>
      {/if}
    </section>

    <section>
      <h2
        class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
      >
        By label
      </h2>
      {#if s.by_label.length}
        {@render barRows(s.by_label)}
      {:else}
        <p class="font-display text-[14px] italic text-muted">
          No labels catalogued yet.
        </p>
      {/if}
    </section>

    <section>
      <h2
        class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
      >
        By decade
      </h2>
      {@render barRows(s.by_decade)}
    </section>

    <section>
      <h2
        class="mb-6 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
      >
        Status
      </h2>
      {@render barRows(statusRows)}
      <p
        class="mt-6 border-l-2 border-l-edge pl-4 font-display text-[13.5px] italic leading-relaxed text-faint"
      >
        {s.covers_local} of {s.total} covers stored locally — the rest still lean
        on remote images.{s.sold || s.traded_away
          ? ` The shelves have released ${s.sold + s.traded_away}.`
          : ""}
      </p>
    </section>
  </div>
{/if}
