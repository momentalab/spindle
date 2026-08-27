<script lang="ts">
	let {
		value = $bindable(''),
		name,
		id,
		type = 'text',
		label,
		placeholder,
		inputmode,
		min,
		step,
		maxlength,
		required = false,
		class: className = ''
	}: {
		value?: string | number;
		name?: string;
		id?: string;
		type?: string;
		label?: string;
		placeholder?: string;
		inputmode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'url' | 'search';
		min?: string | number;
		step?: string | number;
		maxlength?: number;
		required?: boolean;
		class?: string;
	} = $props();

	/* Editorial field: a single hairline underline, no box. */
	const fieldClass = $derived(
		`w-full rounded-none border-0 border-b border-edge bg-transparent px-0 py-2 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:shadow-none focus:outline-none ${className}`
	);
</script>

{#if label}
	<label for={id ?? name} class="mb-1 block text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
		{label}{#if required}<span class="text-rust" aria-hidden="true"> *</span>{/if}
	</label>
{/if}
<input {type} {name} {id} {placeholder} {inputmode} {min} {step} {maxlength} bind:value {required} class={fieldClass} />
