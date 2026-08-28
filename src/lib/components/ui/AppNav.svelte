<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import Button from "./Button.svelte";
	import ThemeToggle from "./ThemeToggle.svelte";

	// Served verbatim from static/ (copied to the build output root).
	const favicon = `${base}/favicon.svg`;

	const links = [
		{ href: "/", label: "Collection" },
		{ href: "/scan", label: "Scan" },
		{ href: "/stats", label: "Stats" },
	] as const;

	function isActive(href: string): boolean {
		if (href === "/") return page.url.pathname === "/";
		return page.url.pathname.startsWith(href);
	}
</script>

<!-- Masthead — like a publication header -->
<nav
	class="sticky top-0 z-50 border-b border-edge bg-paper/90 backdrop-blur-sm"
>
	<div class="mx-auto flex max-w-260 items-center px-7 py-5">
		<a
			href="/"
			class="mr-2 flex shrink-0 items-center"
			aria-label="mynyl — collection home"
		>
			<img
				src={favicon}
				alt=""
				width="27"
				height="32"
				class="h-8 w-auto shrink-0"
			/>
			<span class="ml-3 flex items-baseline">
				<span
					class="font-display text-xl font-normal tracking-[.02em] sm:text-2xl"
					>mynyl</span
				>
				<!-- tagline drops below lg so the masthead fits narrow viewports -->
				<span
					class="ml-3 hidden text-[10px] uppercase tracking-[.2em] text-faint lg:inline"
					>est. 2026 · a vinyl index</span
				>
			</span>
		</a>

		<div
			class="ml-auto flex flex-wrap items-center justify-end gap-x-5 gap-y-2.5 sm:gap-x-8"
		>
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={isActive(link.href) ? "page" : undefined}
					class={`relative whitespace-nowrap text-[11px] font-medium uppercase tracking-[.14em] transition-colors duration-300 sm:text-[12px] sm:tracking-[.18em] ${
						isActive(link.href)
							? "text-ink after:absolute after:inset-x-0 after:-bottom-1.5 after:h-px after:bg-accent"
							: "text-muted hover:text-ink"
					}`}
				>
					{link.label}
				</a>
			{/each}

			<Button
				href="/import/manual"
				variant="primary"
				size="sm"
				class="hidden sm:inline-flex"
			>
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
