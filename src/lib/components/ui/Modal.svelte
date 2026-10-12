<script lang="ts">
	import type { Snippet } from 'svelte';

	const WIDTHS = {
		sm: 'max-w-md',
		md: 'max-w-lg',
		lg: 'max-w-2xl'
	} as const;

	/**
	 * Shared modal shell — the same chrome as the acquire dialog and the
	 * large-photo confirm: dimmed backdrop, centered card that becomes a bottom
	 * sheet on mobile, closed via X / Escape / backdrop. The body scrolls inside
	 * the card (header pinned) so tall panels never run off-screen.
	 */
	let {
		open,
		'aria-label': ariaLabel,
		eyebrow,
		title,
		size = 'md',
		locked = false,
		onClose,
		children
	}: {
		open: boolean;
		/** Accessible name for the dialog. */
		['aria-label']: string;
		/** Small-caps line above the title (omitted if empty). */
		eyebrow?: string;
		/** Dialog heading (omitted if empty — content then starts at the top). */
		title?: string;
		/** Card width: sm = max-w-md, md = max-w-lg, lg = max-w-2xl. */
		size?: keyof typeof WIDTHS;
		/** While true, backdrop and X are inert (e.g. a submit is in flight). */
		locked?: boolean;
		onClose: () => void;
		children: Snippet;
	} = $props();

	function handleKey(e: KeyboardEvent): void {
		if (e.key === 'Escape' && open && !locked) onClose();
	}
	$effect(() => {
		if (!open) return;
		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	});
</script>

{#if open}
	<div class="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
		<!-- dimmed backdrop -->
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default bg-ink/25 backdrop-blur-[2px]"
			aria-label="Close dialog"
			disabled={locked}
			onclick={() => !locked && onClose()}
		></button>

		<div
			role="dialog"
			aria-modal="true"
			aria-label={ariaLabel}
			class="card-pop-sm relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-y-auto border border-edge bg-paper shadow-xl {WIDTHS[
				size
			]}"
		>
			{#if eyebrow || title}
				<div
					class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-hair bg-paper px-7 pb-5 pt-6"
				>
					<div class="min-w-0">
						{#if eyebrow}
							<p class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">{eyebrow}</p>
						{/if}
						<h3 class="{eyebrow ? 'mt-1.5' : ''}truncate font-display text-xl leading-snug">{title}</h3>
					</div>
					<button
						type="button"
						class="-mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-muted transition-colors hover:text-accent"
						aria-label="Close dialog"
						disabled={locked}
						onclick={() => !locked && onClose()}
					>
						<svg
							viewBox="0 0 16 16"
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.25"
							aria-hidden="true"
						>
							<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke-linecap="square" />
						</svg>
					</button>
				</div>
			{/if}
			<div class={eyebrow || title ? 'px-7 pb-7 pt-6' : 'p-7'}>
				{@render children()}
			</div>
		</div>
	</div>
{/if}
