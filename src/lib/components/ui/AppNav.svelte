<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';

	// Served verbatim from static/ (copied to the build output root).
	const favicon = `${base}/favicon.svg`;

	const links = [
		{ href: '/', label: 'Collection' },
		{ href: '/stats', label: 'Stats' },
		{ href: '/value', label: 'Value' },
		{ href: '/settings', label: 'Settings' }
	] as const;

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}

	/* ---- Mobile nav: below sm the masthead collapses to wordmark + menu;
	     all destinations move into a full-height overlay drawer so nothing
	     wraps or crowds on narrow viewports. ---- */
	let menuOpen = $state(false);
	let triggerEl: HTMLButtonElement | undefined = $state();
	let panelEl: HTMLDivElement | undefined = $state();

	const closeMenu = () => (menuOpen = false);

	$effect(() => {
		if (!menuOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') closeMenu();
		};
		document.addEventListener('keydown', onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		panelEl?.focus({ preventScroll: true });
		return () => {
			document.removeEventListener('keydown', onKey);
			document.body.style.overflow = prevOverflow;
			triggerEl?.focus();
		};
	});
</script>

<!-- Masthead — like a publication header -->
<nav class="sticky top-0 z-50 border-b border-edge bg-paper/90 backdrop-blur-sm">
	<div class="mx-auto flex max-w-260 items-center px-7 py-5">
		<a href="/" class="mr-2 flex shrink-0 items-center" aria-label="mynyl — collection home">
			<img src={favicon} alt="" width="27" height="32" class="h-8 w-auto shrink-0" />
			<span class="ml-3 flex items-baseline">
				<span class="font-display text-xl font-normal tracking-[.02em] sm:text-2xl">mynyl</span>
				<!-- tagline drops below lg so the masthead fits narrow viewports -->
				<span class="ml-3 hidden text-[10px] uppercase tracking-[.2em] text-faint lg:inline"
					>est. 2026 · a vinyl index</span
				>
			</span>
		</a>

		<!-- Mobile: the whole right cluster moves into the drawer below sm,
		     so the masthead stays a single clean row at any width. -->
		<div class="ml-auto hidden items-center justify-end gap-x-8 sm:flex">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={isActive(link.href) ? 'page' : undefined}
					class={`relative whitespace-nowrap text-[12px] font-medium uppercase tracking-[.18em] transition-colors duration-300 ${
						isActive(link.href)
							? 'text-ink after:absolute after:inset-x-0 after:-bottom-1.5 after:h-px after:bg-accent'
							: 'text-muted hover:text-ink'
					}`}
				>
					{link.label}
				</a>
			{/each}
		</div>

		<!-- Hamburger — mobile only -->
		<button
			type="button"
			bind:this={triggerEl}
			class="ml-auto -mr-1.5 flex h-10 w-10 items-center justify-center text-ink transition-colors hover:text-accent sm:hidden"
			aria-expanded={menuOpen}
			aria-controls="mynyl-nav-panel"
			aria-label={menuOpen ? 'Close menu' : 'Open menu'}
			onclick={() => (menuOpen = !menuOpen)}
		>
			{#if menuOpen}
				<svg
					viewBox="0 0 16 16"
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					stroke-width="1.25"
					aria-hidden="true"
				>
					<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke-linecap="square" />
				</svg>
			{:else}
				<svg
					viewBox="0 0 16 16"
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					stroke-width="1.25"
					aria-hidden="true"
				>
					<path d="M2 4.5h12M2 8h12M2 11.5h12" stroke-linecap="square" />
				</svg>
			{/if}
		</button>
	</div>
</nav>

<!-- Mobile nav overlay — full-height drawer over a dimmed backdrop -->
{#if menuOpen}
	<div class="fixed inset-0 z-[60] sm:hidden">
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default bg-ink/25 backdrop-blur-[2px]"
			aria-label="Close menu"
			onclick={closeMenu}
		></button>
		<div
			id="mynyl-nav-panel"
			bind:this={panelEl}
			tabindex="-1"
			class="drawer-in absolute inset-y-0 right-0 flex w-[19.5rem] max-w-[85vw] flex-col overflow-y-auto border-l border-edge bg-paper px-7 focus:outline-none"
			role="dialog"
			aria-modal="true"
			aria-label="Site navigation"
		>
			<div class="flex items-center justify-between py-5">
				<span class="font-display text-xl tracking-[.02em]">mynyl</span>
				<button
					type="button"
					class="-mr-1.5 flex h-9 w-9 items-center justify-center text-muted transition-colors hover:text-accent"
					aria-label="Close menu"
					onclick={closeMenu}
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

			<div class="flex flex-col border-t border-hair">
				{#each links as link, i (link.href)}
					<a
						href={link.href}
						aria-current={isActive(link.href) ? 'page' : undefined}
						class={`group flex items-baseline gap-4 border-b border-hair py-5 ${
							isActive(link.href) ? 'text-ink' : 'text-muted'
						}`}
						onclick={closeMenu}
					>
						<span class="font-display text-[13px] italic text-faint">
							{String(i + 1).padStart(2, '0')}
						</span>
						<span
							class={`font-display text-[26px] tracking-[-.01em] transition-colors group-hover:text-accent ${
								isActive(link.href) ? '' : 'group-hover:text-ink'
							}`}
						>
							{link.label}
						</span>
					</a>
				{/each}
			</div>

			<div class="mt-auto py-8">
				<span class="text-[10px] uppercase tracking-[.2em] text-faint">est. 2026 · a vinyl index</span>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes drawer-in {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	.drawer-in {
		animation: drawer-in 0.25s ease both;
	}
</style>
