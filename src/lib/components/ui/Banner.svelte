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

	/* A quiet flat callout: hairline rule + a tone-colored left rule and glyph. */
	const rules = {
		success: 'border-l-2 border-l-forest',
		warn: 'border-l-2 border-l-butter',
		error: 'border-l-2 border-l-rust',
		info: 'border-l-2 border-l-accent'
	} as const;

	const iconTones = {
		success: 'text-forest',
		warn: 'text-butter',
		error: 'text-rust',
		info: 'text-accent'
	} as const;

	const icons = { success: '✓', warn: '⚠', error: '✕', info: 'ℹ' } as const;
</script>

<div
	role="status"
	class={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xs border border-edge bg-surface px-4 py-3 text-sm ${rules[variant]} ${className}`}
>
	<span class={`text-base ${iconTones[variant]}`} aria-hidden="true">{icons[variant]}</span>
	<span class="min-w-0 flex-1">
		{@render children()}
	</span>
	{#if actions}
		<span class="flex flex-wrap items-center gap-2">
			{@render actions()}
		</span>
	{/if}
</div>
