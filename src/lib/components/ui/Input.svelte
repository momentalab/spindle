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

	const fieldClass = `w-full rounded-xl border-2 border-edge bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-plum focus:shadow-brutal-sm focus:outline-none ${className}`;
</script>

{#if label}
	<label for={id ?? name} class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted">
		{label}{#if required}<span class="text-rust" aria-hidden="true"> *</span>{/if}
	</label>
{/if}
<input {type} {name} {id} {placeholder} {inputmode} {min} {step} {maxlength} bind:value {required} class={fieldClass} />
