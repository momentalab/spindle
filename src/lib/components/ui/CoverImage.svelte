<script lang="ts">
	let {
		src,
		alt = '',
		class: className = '',
		loading = 'lazy'
	}: {
		/** Local `/media/…` path or remote URL; null/undefined renders the vinyl placeholder. */
		src?: string | null;
		alt?: string;
		class?: string;
		loading?: 'lazy' | 'eager';
	} = $props();
</script>

<div class={`overflow-hidden rounded-xl bg-surface-2 ${className}`}>
	{#if src}
		<img {src} {alt} {loading} class="h-full w-full object-cover" />
	{:else}
		<div class="flex h-full w-full items-center justify-center p-4">
			<!-- vinyl record placeholder (currentColor = muted ink) -->
			<svg viewBox="0 0 96 96" class="h-3/5 w-3/5 text-muted/60" aria-hidden="true" fill="none">
				<circle cx="48" cy="48" r="44" fill="currentColor" opacity="0.25" />
				<circle cx="48" cy="48" r="44" stroke="currentColor" stroke-width="3" />
				<circle cx="48" cy="48" r="33" stroke="currentColor" stroke-width="1.5" opacity="0.5" />
				<circle cx="48" cy="48" r="25" stroke="currentColor" stroke-width="1.5" opacity="0.5" />
				<circle cx="48" cy="48" r="14" fill="var(--plum)" stroke="currentColor" stroke-width="3" />
				<circle cx="48" cy="48" r="3.5" fill="currentColor" />
			</svg>
		</div>
	{/if}
</div>
