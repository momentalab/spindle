<script lang="ts">
	import { page } from '$app/state';
	import Button from './Button.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	const links = [
		{ href: '/', label: 'Collection' },
		{ href: '/scan', label: 'Scan' }
	] as const;

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}
</script>

<nav class="nav sticky top-0 z-50 border-b-2 border-edge bg-paper">
	<div class="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:px-6">
		<a href="/" class="mr-1 flex shrink-0 items-center gap-2" aria-label="mynyl — collection home">
			<!-- vinyl brand mark -->
			<svg viewBox="0 0 40 40" class="h-9 w-9" aria-hidden="true" fill="none">
				<rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="var(--surface)" stroke="var(--edge)" stroke-width="3" />
				<circle cx="20" cy="20" r="11.5" stroke="var(--edge)" stroke-width="2.5" />
				<circle cx="20" cy="20" r="6" fill="var(--plum)" />
				<circle cx="20" cy="20" r="1.8" fill="var(--paper)" />
			</svg>
			<span class="font-display text-2xl font-black tracking-tight">my<span class="text-plum">nyl</span></span>
		</a>

		<div class="ml-auto flex items-center gap-2">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={isActive(link.href) ? 'page' : undefined}
					class={`rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition-all duration-300 sm:px-4 ${
						isActive(link.href)
							? 'card-pop-sm border-edge bg-plum text-plum-contrast shadow-brutal-sm'
							: 'border-transparent text-muted hover:border-edge hover:bg-surface hover:text-ink'
					}`}
				>
					{link.label}
				</a>
			{/each}

			<Button href="/import/manual" variant="secondary" size="sm" class="hidden sm:inline-flex">
				+ Add
			</Button>
			<ThemeToggle />
		</div>
	</div>

	<!-- mobile: Add button below the bar (kept tappable, no cramped row) -->
	<div class="mx-auto max-w-6xl px-4 pb-3 sm:hidden">
		<Button href="/import/manual" variant="secondary" size="md" class="w-full">
			+ Add a record manually
		</Button>
	</div>
</nav>
