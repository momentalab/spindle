<script lang="ts">
  /**
   * Renders a decade ("2010s") without the `uppercase` transforms flattening
   * the trailing "s" into a full-size "S": the digits keep the inherited text
   * transform, the "s" is forced back to lowercase at a smaller size.
   * Non-decade labels (e.g. "Undated") pass through untouched.
   */
  let { label }: { label: string } = $props();

  const m = $derived(/^(\d{4})s$/.exec(label));
</script>

{#if m}
  <span aria-label={label}>
    {m[1]}<span class="text-[0.62em] lowercase">s</span>
  </span>
{:else}
  {label}
{/if}
