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
		sm: 'px-3 py-1.5 text-xs',
		md: 'px-4 py-2 text-sm',
		lg: 'px-6 py-3 text-base'
	} as const;

	const pressable =
		'shadow-brutal-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal active:translate-x-0.5 active:translate-y-0.5 active:shadow-none';

	const variants = {
		primary: `border-edge bg-plum text-plum-contrast ${pressable}`,
		secondary: `border-edge bg-surface text-ink ${pressable}`,
		danger: `border-rust bg-rust-soft text-rust ${pressable}`,
		ghost: 'border-transparent bg-transparent text-ink hover:bg-surface-2'
	} as const;

	const classes = `inline-flex select-none items-center justify-center gap-1.5 rounded-full border-2 font-semibold transition-all duration-300 disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`;
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
