<script lang="ts">
	let {
		value = $bindable(''),
		name,
		id,
		label,
		placeholder,
		rows = 3,
		class: className = ''
	}: {
		value?: string;
		name?: string;
		id?: string;
		label?: string;
		placeholder?: string;
		rows?: number;
		class?: string;
	} = $props();

	/* Editorial field: a single hairline underline, no box. */
	const fieldClass = $derived(
		`w-full resize-y rounded-none border-0 border-b border-edge bg-transparent px-0 py-2 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:outline-none ${className}`
	);
</script>

{#if label}
	<label for={id ?? name} class="mb-1 block text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
		{label}
	</label>
{/if}
<textarea {name} {id} {placeholder} {rows} bind:value class={fieldClass}></textarea>
