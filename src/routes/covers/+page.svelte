<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ActionData, PageData } from "./$types";
  import Banner from "$lib/components/ui/Banner.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import CoverImage from "$lib/components/ui/CoverImage.svelte";
  import { appTitle } from "$lib/index";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /* This kit types `form` as a union of action results — discriminate by shape,
   * then normalize to concrete shapes for the template. */
  interface RepairAll {
    ok: boolean;
    fixed: number;
    failed: number;
  }
  interface RepairFail {
    ok: false;
    recordId: number;
    message: string;
  }
  const repairAll = $derived(
    form && "fixed" in form ? (form as unknown as RepairAll) : null,
  );
  const repairFail = $derived(
    form && form.ok === false && "recordId" in form
      ? (form as unknown as RepairFail)
      : null,
  );
</script>

<svelte:head><title>{appTitle("Missing covers")}</title></svelte:head>

<!-- page head -->
<header
  class="flex flex-wrap items-end justify-between gap-6 border-b border-edge pb-7"
>
  <div>
    <h1
      class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em]"
    >
      Missing covers.
    </h1>
    <p class="mt-3 max-w-xl font-display text-[15px] italic text-muted">
      Records missing cover artwork — a retry re-pulls it from Discogs.
    </p>
  </div>
  {#if data.rows.length > 0}
    <div class="shrink-0 text-right">
      <form method="POST" action="?/repair_all" class="inline" use:enhance>
        <Button type="submit" variant="secondary">Recover all</Button>
      </form>
    </div>
  {/if}
</header>

{#if repairAll && repairAll.fixed > 0}
  <div class="mt-8">
    <Banner variant="success"
      >{repairAll.fixed} cover{repairAll.fixed === 1 ? "" : "s"} recovered
      {repairAll.failed > 0
        ? ` · ${repairAll.failed} still unreachable`
        : ""}</Banner
    >
  </div>
{/if}

{#if data.rows.length === 0}
  <div
    class="flex flex-col items-center border-b border-hair py-20 text-center"
  >
    <p class="mb-2 font-display text-2xl font-normal">Nothing missing</p>
    <p class="max-w-sm font-display text-[15px] italic text-muted">
      Every record in the index has its cover on file.
    </p>
  </div>
{:else}
  <div class="mt-2 flex flex-col">
    {#each data.rows as rec, i (rec.id)}
      {@const err =
        repairFail && repairFail.recordId === rec.id
          ? repairFail.message
          : null}
      <div
        class="group grid grid-cols-[32px_48px_minmax(0,1fr)_auto] items-center gap-3 border-b border-hair py-5 sm:grid-cols-[56px_72px_minmax(0,1fr)_auto] sm:gap-6"
        style="animation-delay: {Math.min(i * 30, 300)}ms"
      >
        <span class="font-display text-[15px] italic text-faint"
          >{String(i + 1).padStart(2, "0")}</span
        >
        <span class="block h-12 w-12 shrink-0 sm:h-[72px] sm:w-[72px]">
          <CoverImage
            src={rec.cover_remote_url ?? null}
            alt=""
            loading="lazy"
          />
        </span>
        <span class="min-w-0">
          <a
            href="/records/{rec.id}"
            class="block truncate font-display text-[19px] tracking-[.005em] transition-colors group-hover:text-accent sm:text-[21px]"
          >
            {rec.title}
          </a>
          <span class="mt-0.5 block truncate text-[13px] text-muted">
            {rec.artist}{rec.year ? ` · ${rec.year}` : ""}
          </span>
          <span
            class="mt-1 block text-[10px] font-medium uppercase tracking-[.18em] text-faint"
          >
            {rec.reason === "remote_fallback"
              ? "Remote image on file — download it"
              : "No saved URL — will look up via Discogs ID"}
          </span>
          {#if err}<span class="mt-1.5 block text-[12.5px] text-rust"
              >{err}</span
            >{/if}
        </span>
        <form method="POST" action="?/repair" class="inline" use:enhance>
          <input type="hidden" name="record_id" value={rec.id} />
          <Button type="submit" variant="secondary" size="sm"
            >Download cover</Button
          >
        </form>
      </div>
    {/each}

    {#if repairAll && repairAll.fixed === 0}
      <p class="mt-10 font-display text-[15px] italic text-muted">
        {repairAll.failed > 0
          ? `None recovered — ${repairAll.failed} source${repairAll.failed === 1 ? "" : "s"} unreachable. Try again once the network is back.`
          : "Nothing to recover."}
      </p>
    {/if}
  </div>
{/if}
