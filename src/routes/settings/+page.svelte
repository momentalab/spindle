<script lang="ts">
  import { browser } from "$app/environment";
  import { invalidateAll } from "$app/navigation";
  import type { PageData } from "./$types";
  import BackupSection from "$lib/components/BackupSection.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Segmented from "$lib/components/ui/Segmented.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import { appTitle } from "$lib/index";

  let { data }: { data: PageData } = $props();

  /* ------------------------------------------------------------------ */
  /* Preferences — client-owned, in localStorage (never the database).   */
  /* The theme key is the same `mynyl-theme` the masthead ThemeToggle    */
  /* and the app.html boot script use, so all three stay in agreement.   */
  /* ------------------------------------------------------------------ */

  type ThemeId = "light" | "dark" | "system";
  const themeOptions = [
    { id: "light", label: "Light", icon: "☀" },
    { id: "dark", label: "Dark", icon: "☾" },
    { id: "system", label: "System" },
  ] as const;

  function readStoredTheme(): ThemeId {
    if (!browser) return "light"; // SSR stand-in; the effect corrects it on hydration
    const s = localStorage.getItem("mynyl-theme");
    return s === "dark" ? "dark" : s === "light" ? "light" : "system";
  }

  let theme = $state<ThemeId>(browser ? readStoredTheme() : "light");

  function applyTheme(t: ThemeId): void {
    if (t === "system") {
      // No stored key → the app.html boot script falls through to the OS preference.
      localStorage.removeItem("mynyl-theme");
      document.documentElement.classList.toggle(
        "dark",
        window.matchMedia("(prefers-color-scheme: dark)").matches,
      );
    } else {
      localStorage.setItem("mynyl-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }
  }

  // Applies the live theme choice to the document + storage. Runs on mount
  // (re-asserts what the app.html boot script already painted — harmless) and
  // re-runs on every change: a segmented-control click, or the observer below
  // mirroring a masthead ThemeToggle flip back into `theme`.
  $effect(() => {
    if (!browser) return;
    applyTheme(theme);
  });

  $effect(() => {
    if (!browser) return;
    theme = readStoredTheme();

    // OS can flip under a "system" preference; the boot script only covers load.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = (e: MediaQueryListEvent) => {
      if (theme === "system")
        document.documentElement.classList.toggle("dark", e.matches);
    };
    mq.addEventListener("change", onMq);

    // The masthead toggle can change the class from here — mirror it back.
    const mo = new MutationObserver(() => {
      const next = readStoredTheme();
      if (next !== theme) theme = next;
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      mq.removeEventListener("change", onMq);
      mo.disconnect();
    };
  });

  type ViewId = "cards" | "index" | "table";
  const VIEW_IDS: ViewId[] = ["cards", "index", "table"];
  const viewOptions = [
    { id: "cards", label: "Cards" },
    { id: "index", label: "Index" },
    { id: "table", label: "Table" },
  ] as const;

  function readStoredView(): ViewId {
    if (!browser) return "cards"; // SSR stand-in
    const stored = localStorage.getItem("mynyl-default-view");
    return stored && (VIEW_IDS as string[]).includes(stored)
      ? (stored as ViewId)
      : "cards";
  }

  let defaultView = $state<ViewId>(readStoredView());

  // Writes the key on every change (and once with the hydrated value on mount —
  // harmless, and it makes a freshly-set preference visible to other tabs' home loads).
  $effect(() => {
    if (browser && VIEW_IDS.includes(defaultView))
      localStorage.setItem("mynyl-default-view", defaultView);
  });

  /* ------------------------------------------------------------------ */
  /* Artist names — this one is NOT browser-local: it shapes stored data,*/
  /* so it lives in the DB (rides along in backups, and a phone scan     */
  /* obeys the same rule as a desktop save). Toggling only affects future*/
  /* saves; the button below rewrites what's already on the shelf.       */
  /* ------------------------------------------------------------------ */

  // svelte-ignore state_referenced_locally
  let leadword = $state<"on" | "off">(data.summary.normalize_artist_leadword);
  let leadwordSaving = $state(false);
  const affectedRecords = $derived(data.summary.affected_records);

  // Keep the control in step with the server's source of truth — on mount and
  // after any invalidateAll (e.g. following a successful "apply" action).
  $effect(() => {
    leadword = data.summary.normalize_artist_leadword;
  });

  // Divergent sync: clicking the segmented control flips `leadword`; this
  // effect then sees it disagree with the server summary and pushes a PUT.
  $effect(() => {
    const server = data.summary.normalize_artist_leadword;
    if (leadword === server || leadwordSaving) return;
    leadwordSaving = true;
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ normalize_artist_leadword: leadword }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await invalidateAll(); // summary re-renders with the fresh value
      })
      .catch(() => {
        leadword = data.summary.normalize_artist_leadword; // revert the optimistic flip
      })
      .finally(() => {
        leadwordSaving = false;
      });
  });

  async function applyLeadword(): Promise<void> {
    if (leadwordSaving) return;
    const ok = confirm(
      `Rewrite the artist name on ${affectedRecords} existing ${
        affectedRecords === 1 ? "record" : "records"
      }?\n\nExample: "Beatles, The" becomes "The Beatles". Names already in that form are left untouched.`,
    );
    if (!ok) return;
    leadwordSaving = true;
    try {
      const res = await fetch("/api/settings/apply-lead-word", {
        method: "POST",
      });
      const j = (await res.json().catch(() => null)) as {
        changed?: number;
      } | null;
      if (!res.ok || !j) throw new Error(`HTTP ${res.status}`);
      await invalidateAll(); // the summary's affected count refreshes
    } catch (e) {
      alert(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      leadwordSaving = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Export — the same /api/export endpoint the old home links used.     */
  /* CSV defaults to records; JSON's "all tables" is its no-param default.*/
  /* ------------------------------------------------------------------ */

  let format = $state<"csv" | "json">("csv");
  let table = $state<string>("records");

  const tableOptions = $derived(
    format === "json"
      ? [
          { id: "all", label: "All tables" },
          { id: "records", label: "Records" },
          { id: "photos", label: "Photos" },
          { id: "plays", label: "Plays" },
        ]
      : [
          { id: "records", label: "Records" },
          { id: "photos", label: "Photos" },
          { id: "plays", label: "Plays" },
        ],
  );

  $effect(() => {
    if (format === "csv" && table === "all") table = "records";
  });

  const exportUrl = $derived.by(() => {
    const p = new URLSearchParams();
    p.set("format", format);
    if (!(format === "json" && table === "all")) p.set("table", table);
    return `/api/export?${p.toString()}`;
  });

  /* ------------------------------------------------------------------ */
  /* Connection & storage — read-only summary from the server load,     */
  /* plus an on-demand probe of the Discogs credentials.                */
  /* ------------------------------------------------------------------ */

  let checkBusy = $state(false);
  let checkNote: { ok: boolean; message: string } | null = $state(null);

  async function checkNow(): Promise<void> {
    if (checkBusy) return;
    checkBusy = true;
    checkNote = null;
    try {
      const res = await fetch("/api/discogs-check");
      const j = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      if (!res.ok || !j) throw new Error(`HTTP ${res.status}`);
      checkNote = {
        ok: Boolean(j.ok),
        message: j.message ?? "Unknown result.",
      };
    } catch (e) {
      checkNote = {
        ok: false,
        message: e instanceof Error ? e.message : "Check failed.",
      };
    } finally {
      checkBusy = false;
    }
  }
</script>

<svelte:head><title>{appTitle("Settings")}</title></svelte:head>

<header
  class="flex flex-wrap items-end justify-between gap-6 border-b border-edge pb-7"
>
  <div class="max-w-3xl">
    <h1
      class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em] sm:text-[52px]"
    >
      Settings.
    </h1>
    <p class="mt-3 font-display text-[15px] italic text-muted">
      Edit preferences, application behavior, appearance, and more.
    </p>
  </div>
</header>

<!-- ══════════════ preferences ══════════════ -->
<section class="border-b border-hair py-10">
  <h2 class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
    Preferences
  </h2>
  <p
    class="mt-2.5 max-w-md font-display text-[14.5px] italic leading-snug text-muted"
  >
    Theme and view live in the browser; artist names live in the database — they
    shape what gets saved, so they travel with the collection.
  </p>

  <div class="mt-8 grid gap-x-16 gap-y-8 sm:grid-cols-2">
    <div class="flex flex-col gap-3">
      <span
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
        >Theme</span
      >
      <Segmented options={themeOptions} bind:value={theme} />
      <p class="text-[11px] italic leading-relaxed text-faint">
        System follows the OS color scheme by default.
      </p>
    </div>
    <div class="flex flex-col gap-3">
      <span
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
        >Default view</span
      >
      <Segmented options={viewOptions} bind:value={defaultView} />
      <p class="text-[11px] italic leading-relaxed text-faint">
        The default view for the Collection page.
      </p>
    </div>
  </div>

  <!-- Artist names: a DB-backed preference (unlike the two above), because it
       rewrites stored data at save time. -->
  <div
    class="mt-10 flex flex-wrap items-start justify-between gap-x-10 gap-y-5 border-t border-hair pt-8"
  >
    <div class="max-w-md">
      <h3
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
      >
        Artist names
      </h3>
      <p class="mt-2.5 text-[13px] leading-relaxed text-muted">
        Move a trailing leading word to the front on save —
        <span class="font-display italic">“Beatles, The”</span> is stored as
        <span class="font-display italic">“The Beatles”</span>. Applies to every
        new save and edit while on; already-stored names are untouched until you
        apply it.
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-4">
      <Segmented
        options={[
          { id: "on", label: "On" },
          { id: "off", label: "Off" },
        ]}
        bind:value={leadword}
      />
      {#if leadword === "on" && affectedRecords > 0}
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={leadwordSaving}
          onclick={() => void applyLeadword()}
        >
          {leadwordSaving
            ? "Applying…"
            : `Apply to ${affectedRecords} ${affectedRecords === 1 ? "record" : "records"}`}
        </Button>
      {/if}
    </div>
  </div>
</section>

<!-- ══════════════ export ══════════════ -->
<section class="border-b border-hair py-10">
  <h2 class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
    Export
  </h2>
  <p
    class="mt-2.5 max-w-md font-display text-[14.5px] italic leading-snug text-muted"
  >
    Export any tables in the database in CSV or JSON formats.
  </p>

  <div class="mt-8 flex flex-wrap items-end gap-x-10 gap-y-6">
    <div class="flex flex-col gap-3">
      <span
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
        >Format</span
      >
      <Segmented
        options={[
          { id: "csv", label: "CSV" },
          { id: "json", label: "JSON" },
        ]}
        bind:value={format}
      />
    </div>

    <label class="flex flex-col gap-1.5">
      <span
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
        >Table</span
      >
      <Select bind:value={table} class="w-36 py-1.5">
        {#each tableOptions as t (t.id)}<option value={t.id}>{t.label}</option
          >{/each}
      </Select>
    </label>

    <Button href={exportUrl} variant="primary" size="sm">Download</Button>
  </div>

  <p class="mt-4 text-[11px] italic leading-relaxed text-faint">
    {#if format === "csv"}
      CSV renders prices in dollars and covers as local URLs; “records” is the
      whole index, “photos” and “plays” are their own tables.
    {:else}
      JSON exports every column raw — “All tables” bundles records, photos and
      plays in one file.
    {/if}
  </p>
</section>

<!-- ══════════════ backup & restore (moved from the home page) ══════════════ -->
<BackupSection />

<!-- ══════════════ connection & storage ══════════════ -->
<section class="py-10">
  <h2 class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
    Connection & storage
  </h2>

  <div class="mt-8">
    <!-- row: Discogs -->
    <div
      class="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-hair py-4"
    >
      <span
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
        >Discogs</span
      >
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span class="text-[13px] text-muted">
          {data.summary.discogs_configured
            ? "Configured — high tier (60 req/min)"
            : "Unauthenticated — low tier (25 req/min)"}
        </span>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={checkBusy}
          onclick={() => void checkNow()}
        >
          {checkBusy ? "Checking…" : "Check now"}
        </Button>
      </div>
    </div>
    {#if checkNote}
      <p
        class={`-mt-2 pb-4 pt-1 text-[12.5px] italic ${checkNote.ok ? "text-forest" : "text-rust"}`}
      >
        {checkNote.message}
      </p>
    {/if}

    <!-- row: storage location -->
    <div
      class="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-hair py-4"
    >
      <span
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
        >Data directory</span
      >
      <span class="break-all text-[13px] text-muted"
        >{data.summary.data_dir}</span
      >
    </div>

    <!-- row: what's stored -->
    <div
      class="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-hair py-4"
    >
      <span
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
        >Stored</span
      >
      <span class="text-[13px] text-muted">
        {data.summary.counts.records}
        {data.summary.counts.records === 1 ? "record" : "records"} ·
        {data.summary.counts.photos}
        {data.summary.counts.photos === 1 ? "photo" : "photos"} ·
        {data.summary.counts.plays}
        {data.summary.counts.plays === 1 ? "play" : "plays"}
      </span>
    </div>
  </div>
</section>
