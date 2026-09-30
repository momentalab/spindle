<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		shadow = false,
		lift = false,
		class: className = '',
		children
	}: {
		/** @deprecated the editorial layout is flat; kept for API compatibility. */
		shadow?: boolean;
		/** @deprecated the editorial layout has no lift; kept for API compatibility. */
		lift?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<!-- A printed catalogue has no boxes — Card is now a neutral container. -->
<div class={className}>
	{@render children()}
</div>
