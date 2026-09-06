<script lang="ts">
  import { enhance } from "$app/forms";
  import CoverImage from "./ui/CoverImage.svelte";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import type { DiscogsSeed, SearchCandidate } from "$lib/types";
  import { joinLabels } from "$lib/types";

  /**
   * Shared Discogs release picker (the candidate list behind both "Re-identify"
   * and the cover override's "pick artwork from another entry"). The caller
   * supplies the candidates and the action each row's commit form posts to;
   * both post a hidden `discogs_id` field.
   */
  let {
    candidates,
    /** Release id rendered as "Current" (re-identify) or "Current cover" (cover). */
    selectedId = null,
    /** Label for the current-selection marker. */
    selectedLabel = "Current release",
    /** Named page action the per-row commit form posts to (e.g. ?/reidentify). */
    action,
    /** Text of the per-row commit button. */
    commitLabel = "Select",
    /** Hidden field name carrying the chosen release id (discogs_id / release_id). */
    fieldName = "discogs_id",
    /**
     * Called with the committed candidate id after a successful action;
     * on failure the callback is not run (the panel stays open for retry).
     */
    onCommitted = () => {},
  }: {
    candidates: SearchCandidate[];
    selectedId?: number | null;
    selectedLabel?: string;
    action: string;
    commitLabel?: string;
    fieldName?: string;
    onCommitted?: (id: number) => void;
  } = $props();

  let committingId = $state<number | null>(null);
  let detailId = $state<number | null>(null);
  let details = $state<
    Record<number, { seed: DiscogsSeed } | { error: string }>
  >({});

  function fmtCandidate(c: SearchCandidate): string {
    return [
      c.format?.filter((f) => f && !/^(album|mixed)$/i.test(f)).join(", "),
      c.year,
      [c.label?.join(", "), c.catno].filter(Boolean).join(" · "),
      c.genre?.[0],
      c.country,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function fetchDetail(id: number): Promise<void> {
    if (details[id]) return;
    detailId = id;
    try {
      const res = await fetch(`/api/import?id=${id}`);
      const json = (await res.json().catch(() => null)) as {
        seed: DiscogsSeed;
        message?: string;
      } | null;
      if (!res.ok || !json?.seed)
        throw new Error(json?.message ?? `HTTP ${res.status}`);
      details = { ...details, [id]: { seed: json.seed } };
    } catch (e) {
      details = {
        ...details,
        [id]: {
          error: e instanceof Error ? e.message : "Could not load details.",
        },
      };
    } finally {
      detailId = null;
    }
  }
</script>

{#if candidates.length === 0}
  <!-- empty state is rendered by the caller -->
{:else}
  <ul class="mt-6 flex flex-col">
    {#each candidates as c (c.id)}
      {@const selected = selectedId !== null && selectedId === c.id}
      <li class="border-b border-hair py-4">
        <div
          class="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-5 sm:grid-cols-[64px_minmax(0,1fr)_auto]"
        >
          <span class="block h-16 w-16 shrink-0">
            <CoverImage src={c.thumb} alt="" />
          </span>
          <span class="min-w-0">
            <span class="block truncate font-display text-[19px]"
              >{c.title}</span
            >
            <span class="mt-0.5 block truncate text-[13px] text-muted">
              {fmtCandidate(c)}
            </span>
            {#if detailId === c.id}
              <span class="mt-1 block italic text-faint">Loading details…</span>
            {:else}
              {@const detail = details[c.id]}
              {#if detail && "seed" in detail}
                <span
                  class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted"
                >
                  {#if detail.seed.limited_edition === 1}
                    <Badge tone="plum">Limited edition</Badge>
                  {/if}
                  {#if detail.seed.format}
                    <span class="truncate">{detail.seed.format}</span>
                  {/if}
                  <span class="whitespace-nowrap text-faint"
                    >{detail.seed.year ?? "????"} · {joinLabels(
                      detail.seed.labels,
                    )}</span
                  >
                </span>
              {:else if detail && "error" in detail}
                <span class="mt-1 block text-[12px] text-rust"
                  >{detail.error}</span
                >
              {/if}
            {/if}
          </span>
          <span
            class="col-start-2 flex flex-col items-start gap-2 sm:col-start-3 sm:items-end"
          >
            {#if selected}
              <span
                class="text-[10.5px] font-semibold uppercase tracking-[.2em] text-accent"
              >
                {selectedLabel}
              </span>
            {:else if committingId === c.id}
              <span
                class="text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"
              >
                Saving…
              </span>
            {:else}
              <form
                method="POST"
                {action}
                class="inline-flex"
                use:enhance={() =>
                  async ({ result, update }) => {
                    committingId = c.id;
                    try {
                      if (
                        result &&
                        "type" in result &&
                        result.type === "failure"
                      )
                        return; // keep the panel open on error
                      await update(); // follow the 303 to the flash banner
                    } finally {
                      committingId = null;
                    }
                    onCommitted(c.id);
                  }}
              >
                <input type="hidden" name={fieldName} value={c.id} />
                <Button type="submit" size="sm" variant="secondary">
                  {commitLabel}
                </Button>
              </form>
            {/if}
            {#if !selected && !details[c.id] && detailId !== c.id}
              <button
                type="button"
                class="text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint underline-offset-4 transition-colors hover:text-accent"
                onclick={() => void fetchDetail(c.id)}
              >
                Details
              </button>
            {/if}
          </span>
        </div>
      </li>
    {/each}
  </ul>
{/if}
