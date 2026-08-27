<script lang="ts">
	export interface SegmentedOption<T extends string> {
		id: T;
		label: string;
		/** Optional glyph/emoji rendered before the label. */
		icon?: string;
	}

	let {
		options,
		value = $bindable(options[0]?.id),
		name,
		class: className = ''
	}: {
		options: readonly SegmentedOption<string>[];
		value?: string;
		/** When set, renders as a real radio group (form-submittable). */
		name?: string;
		class?: string;
	} = $props();

	function activate(id: string): void {
		if (!name) value = id;
	}
</script>

<!-- Editorial view toggle: plain letterspaced buttons, active one underlined in gold. -->
<div role={name ? 'radiogroup' : 'tablist'} class={`flex flex-wrap items-center gap-6 ${className}`}>
	{#each options as opt (opt.id)}
		{@const active = value === opt.id}
		<button
			type="button"
			role={name ? 'radio' : 'tab'}
			aria-checked={active ? true : undefined}
			class={`relative px-0 py-0.5 text-[12px] font-medium uppercase tracking-[.14em] transition-colors duration-300 ${
				active ? 'text-ink after:absolute after:inset-x-0 after:-bottom-1 after:h-px after:bg-accent' : 'text-faint hover:text-muted'
			}`}
			onclick={() => activate(opt.id)}
		>
			{#if opt.icon}<span aria-hidden="true" class="mr-1.5">{opt.icon}</span>{/if}
			{opt.label}
		</button>
	{/each}
</div>
