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

	const fieldClass = `w-full rounded-xl border-2 border-edge bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-plum focus:shadow-brutal-sm focus:outline-none ${className}`;
</script>

{#if label}
	<label for={id ?? name} class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted">
		{label}
	</label>
{/if}
<textarea {name} {id} {placeholder} {rows} bind:value class={fieldClass}></textarea>
