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

	/* Editorial "status": a letterspaced micro-label, no pill. */
	const tones = {
		forest: 'text-accent-dim' /* in collection — quiet gold */,
		plum: 'text-accent',
		rust: 'text-rust',
		butter: 'text-faint',
		muted: 'text-faint'
	} as const;
</script>

<span
	class={`inline-flex items-center whitespace-nowrap text-[9px] font-semibold uppercase tracking-[.14em] sm:text-[10.5px] sm:tracking-[.2em] ${tones[tone]} ${className}`}
>
	{@render children()}
</span>
