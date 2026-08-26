<script lang="ts">
	/**
	 * Toggles the class-based dark mode and persists the choice.
	 * The initial state is applied pre-paint by the inline script in app.html,
	 * so `isDark` only needs to read the live class on mount.
	 */
	let isDark = $state(false);

	$effect(() => {
		isDark = document.documentElement.classList.contains('dark');
		return () => {}; // no cleanup
	});

	function toggle(): void {
		const next = !isDark;
		document.documentElement.classList.toggle('dark', next);
		localStorage.setItem('mynyl-theme', next ? 'dark' : 'light');
		isDark = next;
	}
</script>

<button
	type="button"
	onclick={toggle}
	aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	title={isDark ? 'Light mode' : 'Dark mode'}
	class="card-pop-sm inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-edge bg-surface text-ink shadow-brutal-sm transition-all duration-300 hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
>
	{#if isDark}
		<!-- sun -->
		<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
			<circle cx="12" cy="12" r="4" fill="var(--butter)" stroke="var(--edge)" />
			<path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
		</svg>
	{:else}
		<!-- moon -->
		<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" fill="var(--plum)" />
		</svg>
	{/if}
</button>
