<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'primary',
		size = 'md',
		href,
		target,
		type = 'submit',
		disabled = false,
		onclick,
		class: className = '',
		children
	}: {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		href?: string;
		target?: string;
		type?: 'submit' | 'button' | 'reset';
		disabled?: boolean;
		onclick?: (event: MouseEvent) => void;
		class?: string;
		children: Snippet;
	} = $props();

	const sizes = {
		sm: 'px-4 py-2 text-[11px]',
		md: 'px-[22px] py-3 text-xs',
		lg: 'px-7 py-3.5 text-[13px]'
	} as const;

	/* Editorial buttons: one hairline, letterspaced caps, no offset shadow. */
	const variants = {
		/* solid ink — the mock's masthead "addbtn" */
		primary: 'border border-ink bg-ink text-paper hover:border-accent hover:bg-accent',
		/* hairline outline — the mock's "btnline" */
		secondary: 'border border-edge bg-transparent text-ink hover:border-accent hover:text-accent',
		danger: 'border border-edge bg-transparent text-rust hover:border-rust',
		ghost: 'border border-transparent bg-transparent text-faint hover:text-ink'
	} as const;

	const classes = $derived(
		`inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium uppercase tracking-[.18em] transition-colors duration-300 disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`
	);
</script>

{#if href}
	<a {href} {target} rel={target === '_blank' ? 'noopener noreferrer' : undefined} {onclick} class={classes}>
		{@render children()}
	</a>
{:else}
	<button {type} {disabled} {onclick} class={classes}>
		{@render children()}
	</button>
{/if}
