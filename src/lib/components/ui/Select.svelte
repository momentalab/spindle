<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		value = $bindable(''),
		name,
		id,
		label,
		required = false,
		onchange,
		class: className = '',
		children
	}: {
		value?: string;
		name?: string;
		id?: string;
		label?: string;
		required?: boolean;
		onchange?: (event: Event) => void;
		class?: string;
		children: Snippet;
	} = $props();

	/* Editorial field: a single hairline underline, no box. */
	const fieldClass = $derived(
		`w-full cursor-pointer rounded-none border-0 border-b border-edge bg-transparent px-0 py-1.5 text-sm text-muted focus:border-accent focus:outline-none ${className}`
	);
</script>

{#if label}
	<label for={id ?? name} class="mb-1 block text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
		{label}{#if required}<span class="text-rust" aria-hidden="true"> *</span>{/if}
	</label>
{/if}
<select {name} {id} bind:value {required} {onchange} class={fieldClass}>
	{@render children()}
</select>
