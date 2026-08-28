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

<!-- Editorial: a bare letterspaced micro-link, not a boxed button. -->
<button
	type="button"
	onclick={toggle}
	class="group relative shrink-0 whitespace-nowrap px-0 text-[11px] font-medium uppercase tracking-[.2em] text-faint transition-colors duration-300 hover:text-ink"
>
	{#if isDark}
		<span class="mr-1.5 inline-block align-middle transition-colors group-hover:text-accent">☀</span>
		<span>Light</span>
	{:else}
		<span class="mr-1.5 inline-block align-middle transition-colors group-hover:text-accent">☾</span>
		<span>Dark</span>
	{/if}
</button>
