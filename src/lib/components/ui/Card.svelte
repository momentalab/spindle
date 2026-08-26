<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		shadow = false,
		lift = false,
		class: className = '',
		children
	}: {
		/** Hard offset shadow (the signature brutal look) + pop-in animation. */
		shadow?: boolean;
		/** Hover lift + grown shadow for interactive cards. */
		lift?: boolean;
		class?: string;
		children: Snippet;
	} = $props();

	const classes = `rounded-2xl border-2 border-edge bg-surface ${
		shadow ? 'shadow-brutal card-pop' : ''
	} ${
		lift
			? 'transition-[transform,box-shadow] duration-300 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-brutal-lg'
			: ''
	} ${className}`;
</script>

<div class={classes}>
	{@render children()}
</div>
