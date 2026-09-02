<script lang="ts">
	let {
		value = $bindable(""),
		name,
		id,
		type = "text",
		label,
		placeholder,
		inputmode,
		list,
		datalist,
		min,
		step,
		maxlength,
		required = false,
		class: className = "",
	}: {
		value?: string | number;
		name?: string;
		id?: string;
		type?: string;
		label?: string;
		placeholder?: string;
		inputmode?:
			| "text"
			| "numeric"
			| "decimal"
			| "email"
			| "tel"
			| "url"
			| "search";
		list?: string;
		/** Renders a sibling <datalist> with these values for the browser's autocomplete. */
		datalist?: readonly string[];
		min?: string | number;
		step?: string | number;
		maxlength?: number;
		required?: boolean;
		class?: string;
	} = $props();

	/* A datalist needs a stable, unique id — the caller's `list` wins when
	   given, otherwise each instance gets its own so two can coexist. */
	const generatedDlId = `dl-${Math.random().toString(36).slice(2, 8)}`;
	const dlId = $derived(list ?? generatedDlId);

	/* Editorial field: a single hairline underline, no box. */
	const fieldClass = $derived(
		`w-full rounded-none border-0 border-b border-edge bg-transparent px-0 py-2 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:shadow-none focus:outline-none ${className}`,
	);
</script>

{#if label}
	<label
		for={id ?? name}
		class="mb-1 block text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
	>
		{label}{#if required}<span class="text-rust" aria-hidden="true">
				*</span
			>{/if}
	</label>
{/if}
<input
	{type}
	{name}
	{id}
	{placeholder}
	{inputmode}
	list={datalist && datalist.length ? dlId : list}
	{min}
	{step}
	{maxlength}
	bind:value
	{required}
	class={fieldClass}
/>
{#if datalist && datalist.length}
	<datalist id={dlId}>
		{#each datalist as v (v)}<option value={v}></option>{/each}
	</datalist>
{/if}
