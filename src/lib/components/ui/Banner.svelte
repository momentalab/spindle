<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'info',
		class: className = '',
		children,
		actions
	}: {
		variant?: 'success' | 'warn' | 'error' | 'info';
		class?: string;
		children: Snippet;
		actions?: Snippet;
	} = $props();

	const variants = {
		success: 'border-forest bg-forest-soft',
		warn: 'border-butter bg-butter-soft',
		error: 'border-rust bg-rust-soft',
		info: 'border-plum bg-plum-soft'
	} as const;

	const icons = { success: '✓', warn: '⚠', error: '✕', info: 'ℹ' } as const;
</script>

<div
	role="status"
	class={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-2 p-3 text-sm font-medium shadow-brutal-sm card-pop-sm ${variants[variant]} ${className}`}
>
	<span class="text-base" aria-hidden="true">{icons[variant]}</span>
	<span class="min-w-0 flex-1">
		{@render children()}
	</span>
	{#if actions}
		<span class="flex flex-wrap items-center gap-2">
			{@render actions()}
		</span>
	{/if}
</div>
