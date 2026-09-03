<script lang="ts">
  import { enhance } from "$app/forms";
  import { CONDITIONS } from "$lib/types";
  import Button from "./ui/Button.svelte";
  import Input from "./ui/Input.svelte";
  import Select from "./ui/Select.svelte";

  let {
    open,
    action,
    artist = "",
    title = "",
    error = null,
    onCancel,
  }: {
    open: boolean;
    /** Where the form posts (the acquire action) — e.g. "?/acquire". */
    action: string;
    /** Who it's on the shelf for — shown in the dialog head. */
    artist?: string;
    title?: string;
    error?: string | null;
    onCancel: () => void;
  } = $props();

  let submitting = $state(false);
  let date = $state("");
  let price = $state("");
  let condMedia = $state("");
  let condSleeve = $state("");
  const DATE_INPUT_ID = "acquire-date";

  // Fresh defaults each time it opens; the date field grabs focus.
  $effect(() => {
    if (open) {
      date = new Date().toISOString().slice(0, 10);
      price = "";
      condMedia = "";
      condSleeve = "";
      queueMicrotask(() => {
        const el = document.getElementById(DATE_INPUT_ID);
        if (el instanceof HTMLInputElement) el.focus();
      });
    }
  });

  function handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape" && open && !submitting) onCancel();
  }
  $effect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
</script>

{#if open}
  <div
    class="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center"
  >
    <!-- dimmed backdrop -->
    <button
      type="button"
      class="absolute inset-0 h-full w-full cursor-default bg-ink/25 backdrop-blur-[2px]"
      aria-label="Close dialog"
      disabled={submitting}
      onclick={() => !submitting && onCancel()}
    ></button>

    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Mark ${artist} — ${title} as acquired`}
      class="card-pop-sm relative w-full max-w-md border border-edge bg-paper p-7 shadow-xl"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p
            class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
          >
            Making it yours
          </p>
          <h3 class="mt-1.5 truncate font-display text-xl leading-snug">
            {artist} — {title}
          </h3>
        </div>
        <button
          type="button"
          class="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center text-muted transition-colors hover:text-accent"
          aria-label="Close dialog"
          disabled={submitting}
          onclick={() => !submitting && onCancel()}
        >
          <svg
            viewBox="0 0 16 16"
            class="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
            aria-hidden="true"
          >
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke-linecap="square" />
          </svg>
        </button>
      </div>

      {#if error}
        <p
          class="mt-4 border-l-2 border-l-rust bg-surface px-3 py-2 text-[13px] text-rust"
        >
          {error}
        </p>
      {/if}

      <form
        method="POST"
        {action}
        class="mt-6 flex flex-col gap-5"
        use:enhance={() =>
          async ({ update }) => {
            submitting = true;
            try {
              await update();
            } finally {
              // On success the 303 navigates + revalidates; the record
              // flips out of "wanted" and this dialog unmounts.
              submitting = false;
            }
          }}
      >
        <div class="grid grid-cols-2 gap-x-5">
          <Input
            id={DATE_INPUT_ID}
            name="acquired_at"
            type="date"
            label="Acquired on"
            bind:value={date}
          />
          <Input
            name="price_paid"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            label="Price paid (USD)"
            placeholder="0.00"
            bind:value={price}
          />
        </div>
        <div class="grid grid-cols-2 gap-x-5">
          <Select
            name="condition_media"
            label="Condition (media)"
            bind:value={condMedia}
          >
            <option value="">—</option>
            {#each CONDITIONS as c}<option value={c}>{c}</option>{/each}
          </Select>
          <Select
            name="condition_sleeve"
            label="Condition (sleeve)"
            bind:value={condSleeve}
          >
            <option value="">—</option>
            {#each CONDITIONS as c}<option value={c}>{c}</option>{/each}
          </Select>
        </div>

        <div class="mt-1 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onclick={onCancel}
          >
            Not yet
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Shelving…" : "On the shelf."}
          </Button>
        </div>
      </form>
    </div>
  </div>
{/if}
