<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import ThemeToggle from "./ThemeToggle.svelte";

	// Served verbatim from static/ (copied to the build output root).
	const favicon = `${base}/favicon.svg`;

	const links = [
		{ href: "/", label: "Collection" },
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

			<!-- Scan is an action, not a destination — styled as one (mirrors how
			     "Add manually" links read on the Scan page itself). -->
			<a
				href="/scan"
				class="group inline-flex items-center gap-2 whitespace-nowrap text-[11px] font-medium uppercase tracking-[.18em] text-muted transition-colors duration-300 hover:text-accent sm:text-[11.5px]"
			>
				<svg
					viewBox="0 0 16 16"
					class="h-3.5 w-3.5 shrink-0 transition-transform duration-300 group-hover:scale-110"
					fill="none"
					stroke="currentColor"
					stroke-width="1.25"
					aria-hidden="true"
				>
					<path d="M2.5 4V2.5h1.5M12 2.5h1.5V4M13.5 12v1.5H12M4 13.5H2.5V12" />
					<path d="M6.5 5.5v5M8.5 5.5v5M10.5 6.5v3" stroke-linecap="square" />
				</svg>
				Scan
			</a>
			<ThemeToggle />
		</div>
	</div>
</nav>
