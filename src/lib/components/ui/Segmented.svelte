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

<div
	role={name ? 'radiogroup' : 'tablist'}
	class={`inline-flex w-fit items-center gap-1 rounded-full border-2 border-edge bg-surface p-1 ${className}`}
>
	{#each options as opt (opt.id)}
		{@const active = value === opt.id}
		<button
			type="button"
			role={name ? 'radio' : 'tab'}
			aria-checked={active ? true : undefined}
			class={`rounded-full px-3 py-1.5 text-sm font-semibold transition-all duration-300 ${
				active
					? 'card-pop-sm bg-plum text-plum-contrast shadow-brutal-sm'
					: 'text-muted hover:bg-surface-2 hover:text-ink'
			}`}
			onclick={() => activate(opt.id)}
		>
			{#if opt.icon}<span aria-hidden="true">{opt.icon}</span>{/if}
			{opt.label}
		</button>
	{/each}
</div>
