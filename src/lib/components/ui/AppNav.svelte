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

<!-- Masthead — like a publication header -->
<nav class="sticky top-0 z-50 border-b border-edge bg-paper/90 backdrop-blur-sm">
	<div class="mx-auto flex max-w-260 items-center px-7 py-5">
		<a href="/" class="mr-2 flex shrink-0 items-baseline" aria-label="mynyl — collection home">
			<span class="font-display text-2xl font-normal tracking-[.02em]">mynyl</span>
			<span class="ml-3 text-[10px] uppercase tracking-[.2em] text-faint">est. 2026 · a vinyl index</span>
		</a>

		<div class="ml-auto flex items-center gap-8">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={isActive(link.href) ? 'page' : undefined}
					class={`relative text-[12px] font-medium uppercase tracking-[.18em] transition-colors duration-300 ${
						isActive(link.href)
							? 'text-ink after:absolute after:inset-x-0 after:-bottom-1.5 after:h-px after:bg-accent'
							: 'text-muted hover:text-ink'
					}`}
				>
					{link.label}
				</a>
			{/each}

			<Button href="/import/manual" variant="primary" size="sm" class="hidden sm:inline-flex">
				Add record
			</Button>
			<ThemeToggle />
		</div>
	</div>

	<!-- mobile: Add button below the bar (kept tappable, no cramped row) -->
	<div class="mx-auto max-w-260 px-7 pb-4 sm:hidden">
		<Button href="/import/manual" variant="primary" size="md" class="w-full">
			Add a record manually
		</Button>
	</div>
</nav>
