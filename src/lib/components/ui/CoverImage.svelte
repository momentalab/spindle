<script lang="ts">
	let {
		src,
		alt = "",
		class: className = "",
		loading = "lazy",
	}: {
		/** Local `/media/…` path or remote URL; null/undefined renders the vinyl placeholder. */
		src?: string | null;
		alt?: string;
		class?: string;
		loading?: "lazy" | "eager";
	} = $props();
</script>

<div
	class={`overflow-hidden rounded-xs border border-hair bg-surface-2 ${className}`}
>
	{#if src}
		<!-- max-w-full: an img's intrinsic width feeds a parent's auto-sized grid
		     track and can inflate it past the viewport; this cap breaks the cycle. -->
		<img {src} {alt} {loading} class="h-full w-full max-w-full object-cover" />
	{:else}
		<div class="flex h-full w-full items-center justify-center p-4">
			<!-- vinyl record placeholder (currentColor = muted) -->
			<svg
				viewBox="0 0 96 96"
				class="h-3/5 w-3/5 text-faint"
				aria-hidden="true"
				fill="none"
			>
				<circle cx="48" cy="48" r="44" fill="currentColor" opacity="0.12" />
				<circle
					cx="48"
					cy="48"
					r="44"
					stroke="currentColor"
					stroke-width="1.5"
				/>
				<circle
					cx="48"
					cy="48"
					r="33"
					stroke="currentColor"
					stroke-width="1"
					opacity="0.5"
				/>
				<circle
					cx="48"
					cy="48"
					r="25"
					stroke="currentColor"
					stroke-width="1"
					opacity="0.5"
				/>
				<circle
					cx="48"
					cy="48"
					r="14"
					fill="var(--accent-dim)"
					stroke="currentColor"
					stroke-width="1.5"
				/>
				<circle
					cx="48"
					cy="48"
					r="3.5"
					fill="var(--paper)"
					stroke="currentColor"
					stroke-width="1"
				/>
			</svg>
		</div>
	{/if}
</div>
