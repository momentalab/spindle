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

	const fieldClass = `w-full rounded-xl border-2 border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink focus:border-plum focus:shadow-brutal-sm focus:outline-none ${className}`;
</script>

{#if label}
	<label for={id ?? name} class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted">
		{label}{#if required}<span class="text-rust" aria-hidden="true"> *</span>{/if}
	</label>
{/if}
<select {name} {id} bind:value {required} {onchange} class={fieldClass}>
	{@render children()}
</select>
