<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		tone = 'muted',
		class: className = '',
		children
	}: {
		tone?: 'forest' | 'plum' | 'rust' | 'butter' | 'muted';
		class?: string;
		children: Snippet;
	} = $props();

	const tones = {
		forest: 'border-forest bg-forest-soft text-ink',
		plum: 'border-plum bg-plum-soft text-ink',
		rust: 'border-rust bg-rust-soft text-ink',
		butter: 'border-butter bg-butter-soft text-ink',
		muted: 'border-muted/50 bg-surface-2 text-muted'
	} as const;
</script>

<span
	class={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 px-2.5 py-0.5 text-xs font-bold ${tones[tone]} ${className}`}
>
	{@render children()}
</span>
