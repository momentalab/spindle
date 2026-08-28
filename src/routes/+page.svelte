<script lang="ts">
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import CoverImage from "$lib/components/ui/CoverImage.svelte";
	import { DISCOGS_LINK_ATTRS, discogsReleaseUrl } from "$lib/discogs";
	import Segmented from "$lib/components/ui/Segmented.svelte";
	import Select from "$lib/components/ui/Select.svelte";
	import { STATUS_LABELS } from "$lib/types";

	let { data }: { data: PageData } = $props();

	const views = [
		{ id: "cards", label: "Cards" },
		{ id: "index", label: "Index" },
		{ id: "table", label: "Table" },
	] as const;
	type ViewId = (typeof views)[number]["id"];

	// View mode: initialized from ?view= (deep-linkable) but kept as local state so
	// switching is instant with no navigation.
	let view = $state<ViewId>(
		(page.url.searchParams.get("view") as ViewId | null) ?? "cards",
	);

	function setView(v: ViewId): void {
		view = v;
	}

	function updateParam(key: string, value: string): void {
		const params = new URLSearchParams(page.url.searchParams);
		if (value) params.set(key, value);
		else params.delete(key);
		window.location.href = `/?${params.toString()}`;
	}

	function toggleSort(column: string): void {
		const params = new URLSearchParams(page.url.searchParams);
		const current = params.get("sort") ?? "artist";
		if (current === column) {
			params.set("dir", params.get("dir") === "desc" ? "asc" : "desc");
		} else {
			params.set("sort", column);
			params.set("dir", "asc");
		}
		window.location.href = `/?${params.toString()}`;
	}

	function sortIndicator(column: string): string {
		const params = page.url.searchParams;
		if (params.get("sort") !== column) return "";
		return params.get("dir") === "desc" ? " ↓" : " ↑";
	}

	const sortableColumns: [string, string][] = [
		["artist", "Artist"],
		["title", "Title"],
		["year", "Year"],
		["genre", "Genre"],
		["label", "Label"],
	];

	function fmtPrice(cents: number | null): string {
		return cents === null ? "" : `$${(cents / 100).toFixed(2)}`;
	}

	function coverSrc(rec: {
		cover_filename: string | null;
		cover_remote_url: string | null;
	}): string | null {
		if (rec.cover_filename) return `/media/${rec.cover_filename}`;
		return rec.cover_remote_url;
	}

	const active = $derived(data.filters.active);
	const hasActiveFilters = $derived(
		Boolean(active.search || active.genre || active.label || active.status),
	);

	const statusTone: Record<string, "forest" | "butter" | "muted"> = {
		in_collection: "forest",
		sold: "butter",
		traded_away: "muted",
	};
</script>

<svelte:head><title>mynyl: your vinyl collection</title></svelte:head>

<!-- Hover-reveal micro-link for the table view only (index/cards are whole-row anchors). -->
{#snippet discogsMicroLink(rec: {
	discogs_id: number | string | null;
	artist: string | null;
	title: string;
})}
	{@const du = discogsReleaseUrl(rec.discogs_id)}
	{#if du}
		<a
			href={du}
			{...DISCOGS_LINK_ATTRS}
			title="View on Discogs"
			aria-label={`View ${rec.artist ?? rec.title} — ${rec.title} on Discogs`}
			class="text-[11px] leading-none text-faint opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
		>
			↗
		</a>
	{/if}
{/snippet}

<!-- page head — editorial, big and quiet -->
<header
	class="flex flex-wrap items-end justify-between gap-6 border-b border-edge pb-7"
>
	<div>
		<p
			class="mb-3.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
		>
			The Collection — No. 01
		</p>
		<h1
			class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em] sm:text-[52px]"
		>
			Your records,<br />catalogued.
		</h1>
		<p class="mt-3 font-display text-[15px] italic text-muted">
			{data.total}
			{data.total === 1 ? "album" : "albums"}, scanned and shelved.
		</p>
	</div>
	<div class="shrink-0 text-right">
		<div class="font-display text-[44px] leading-none">{data.total}</div>
		<div
			class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
		>
			records in index
		</div>
	</div>
</header>

<!-- search — a single elegant line -->
<form method="GET" class="border-b border-hair py-6">
	<div class="flex flex-col gap-5 lg:flex-row lg:items-end">
		<input
			type="search"
			name="q"
			value={active.search}
			placeholder="Search the index — artist, title, genre…"
			class="min-w-0 flex-1 border-0 bg-transparent p-0 font-display text-[19px] italic text-ink placeholder:text-faint focus:outline-none"
		/>

		<div class="flex flex-wrap items-end gap-x-6 gap-y-4">
			<label class="flex flex-col gap-1.5">
				<span
					class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
					>Genre</span
				>
				<Select
					name="genre"
					value={active.genre}
					onchange={(e) =>
						updateParam("genre", (e.target as HTMLSelectElement).value)}
					class="w-32 py-1.5"
				>
					<option value="">All</option>
					{#each data.filters.genres as g}<option value={g}>{g}</option>{/each}
				</Select>
			</label>
			<label class="flex flex-col gap-1.5">
				<span
					class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
					>Label</span
				>
				<Select
					name="label"
					value={active.label}
					onchange={(e) =>
						updateParam("label", (e.target as HTMLSelectElement).value)}
					class="w-32 py-1.5"
				>
					<option value="">All</option>
					{#each data.filters.labels as l}<option value={l}>{l}</option>{/each}
				</Select>
			</label>
			<label class="flex flex-col gap-1.5">
				<span
					class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
					>Status</span
				>
				<Select
					name="status"
					value={active.status ?? ""}
					onchange={(e) =>
						updateParam("status", (e.target as HTMLSelectElement).value)}
					class="w-36 py-1.5"
				>
					<option value="">Any</option>
					{#each Object.entries(STATUS_LABELS) as [value, label]}<option {value}
							>{label}</option
						>{/each}
				</Select>
			</label>

			<div class="flex items-center gap-5 border-l border-hair pb-1.5 pl-6">
				<Segmented options={views} bind:value={view} />
				<span
					class="hidden text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint md:inline"
				>
					{data.records.length} of {data.total} shown
				</span>
			</div>
		</div>
	</div>

	{#if hasActiveFilters}
		<div class="mt-4">
			<a
				href="/?view={view}"
				class="text-[11px] font-medium uppercase tracking-[.2em] text-faint underline underline-offset-4 transition-colors hover:text-accent"
			>
				Clear filters
			</a>
		</div>
	{/if}
</form>

<!-- empty state -->
{#if data.records.length === 0}
	<div
		class="flex flex-col items-center border-b border-hair py-20 text-center"
	>
		<div
			class="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-edge"
		>
			<!-- vinyl placeholder -->
			<svg
				viewBox="0 0 96 96"
				class="h-14 w-14 text-faint"
				aria-hidden="true"
				fill="none"
			>
				<circle cx="48" cy="48" r="44" stroke="currentColor" stroke-width="2" />
				<circle
					cx="48"
					cy="48"
					r="30"
					stroke="currentColor"
					stroke-width="1"
					opacity="0.5"
				/>
				<circle
					cx="48"
					cy="48"
					r="14"
					fill="var(--accent-dim)"
					stroke="currentColor"
					stroke-width="2"
				/>
				<circle
					cx="48"
					cy="48"
					r="3.5"
					fill="var(--paper)"
					stroke="currentColor"
					stroke-width="1"
				/>
			</svg>
		</div>
		<p class="mb-2 font-display text-2xl font-normal">
			{data.total === 0 ? "No records yet" : "Nothing matches those filters"}
		</p>
		<p class="mb-7 max-w-sm font-display text-[15px] italic text-muted">
			{data.total === 0
				? "Scan a barcode or add one manually to start your collection."
				: "Try adjusting or clearing the search and filters."}
		</p>
		{#if data.total === 0}
			<div class="flex flex-wrap justify-center gap-4">
				<Button href="/scan" variant="primary">Scan a record</Button>
				<Button href="/import/manual" variant="secondary">Add manually</Button>
			</div>
		{/if}
	</div>
{:else if view === "index"}
	<!-- the catalogue: numbered entries, no cards -->
	<div class="mt-2 flex flex-col">
		{#each data.records as rec, i (rec.id)}
			<a
				href="/records/{rec.id}"
				class="entry group grid grid-cols-[40px_56px_1fr_auto] items-center gap-4 border-b border-hair py-5 transition-[padding] duration-200 hover:pl-2 sm:grid-cols-[56px_72px_1fr_auto] sm:gap-6"
				style="animation-delay: {Math.min(i * 30, 300)}ms"
			>
				<span class="font-display text-[15px] italic text-faint"
					>{String(i + 1).padStart(2, "0")}</span
				>
				<span class="block h-14 w-14 shrink-0 sm:h-[72px] sm:w-[72px]">
					<CoverImage src={coverSrc(rec)} alt="" loading="lazy" />
				</span>
				<span class="min-w-0">
					<span
						class="block truncate font-display text-[19px] tracking-[.005em] transition-colors group-hover:text-accent sm:text-[21px]"
						>{rec.artist}</span
					>
					<span
						class="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-muted"
					>
						<span class="truncate">{rec.title}</span>
						{#if rec.year || rec.genre}<span class="text-faint"
								>{[rec.year, rec.genre].filter(Boolean).join(" · ")}</span
							>{/if}
					</span>
				</span>
				<span class="flex shrink-0 flex-col items-end gap-1.5 text-right">
					<Badge tone={statusTone[rec.status]}
						>{STATUS_LABELS[rec.status]}</Badge
					>
					{#if rec.copies > 1}<span
							class="font-display text-[13px] italic text-faint"
							>{rec.copies} copies</span
						>{/if}
				</span>
			</a>
		{/each}
	</div>
{:else if view === "table"}
	<!-- TABLE — hairlines only, no box -->
	<div class="mt-6 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-edge text-left">
					{#each sortableColumns as [col, colLabel], ci (col)}
						<th class={`pb-3 pr-4 ${ci === 0 ? "pl-3" : ""}`}>
							<button
								type="button"
								onclick={() => toggleSort(col)}
								class="text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint transition-colors hover:text-ink"
							>
								{colLabel}{sortIndicator(col)}
							</button>
						</th>
					{/each}
					<th
						class="pb-3 pr-4 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"
						>Cond.</th
					>
					<th
						class="pb-3 pr-4 text-right text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"
						>Price</th
					>
					<th
						class="pb-3 pr-1 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"
						>Status</th
					>
					<th class="w-8 pr-3 pb-3" aria-hidden="true"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.records as rec (rec.id)}
					<tr
						class="group border-b border-hair transition-colors hover:bg-surface"
					>
						<td class="py-3 pl-3 pr-4">
							<a
								href="/records/{rec.id}"
								class="font-display text-[15px] transition-colors hover:text-accent"
								>{rec.artist}</a
							>
							{#if rec.copies > 1}<span
									class="ml-1.5 font-display text-xs italic text-faint"
									>×{rec.copies}</span
								>{/if}
						</td>
						<td class="py-3 pr-4 text-muted">{rec.title}</td>
						<td class="py-3 pr-4 text-muted">{rec.year ?? ""}</td>
						<td class="py-3 pr-4 text-muted">{rec.genre ?? ""}</td>
						<td class="py-3 pr-4 text-muted">{rec.label ?? ""}</td>
						<td class="py-3 pr-4 font-mono text-xs text-faint">
							{[
								rec.condition_media && `M:${rec.condition_media}`,
								rec.condition_sleeve && `S:${rec.condition_sleeve}`,
							]
								.filter(Boolean)
								.join(" ") || "—"}
						</td>
						<td class="py-3 pr-4 text-right font-mono text-xs text-muted"
							>{fmtPrice(rec.price_paid)}</td
						>
						<td class="py-3 pr-4"
							><Badge tone={statusTone[rec.status]}
								>{STATUS_LABELS[rec.status]}</Badge
							></td
						>
						<!-- end-of-row slot: hover-reveal Discogs link, kept in its own gutter -->
						<td class="w-8 pr-3 py-3 text-right"
							>{@render discogsMicroLink(rec)}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<!-- CARDS — quiet cover tiles, no boxes -->
	<div
		class="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4"
	>
		{#each data.records as rec, i (rec.id)}
			<a
				href="/records/{rec.id}"
				class="group block"
				style="animation-delay: {Math.min(i * 30, 300)}ms"
				aria-label={`${rec.artist} — ${rec.title}`}
			>
				<div class="relative">
					<CoverImage
						src={coverSrc(rec)}
						class="aspect-square w-full transition-colors duration-300 group-hover:border-accent"
						loading="lazy"
					/>
					{#if rec.copies > 1}
						<span
							class="absolute right-2 top-2 border border-hair bg-paper/90 px-2 py-0.5 font-display text-xs italic text-muted backdrop-blur-sm"
						>
							{rec.copies}×
						</span>
					{/if}
				</div>
				<div class="mt-3.5 flex items-baseline justify-between gap-3">
					<p
						class="min-w-0 truncate font-display text-[17px] transition-colors group-hover:text-accent"
					>
						{rec.artist}
					</p>
					<Badge tone={statusTone[rec.status]} class="shrink-0"
						>{STATUS_LABELS[rec.status]}</Badge
					>
				</div>
				<p class="mt-0.5 truncate text-[13px] text-muted">{rec.title}</p>
				{#if rec.year || rec.genre}
					<p class="mt-0.5 text-[11px] uppercase tracking-[.16em] text-faint">
						{[rec.year, rec.genre].filter(Boolean).join(" · ")}
					</p>
				{/if}
			</a>
		{/each}
	</div>
{/if}

<style>
	/* staggered rise-in for the catalogue rows (delay comes from the inline style attr) */
	.entry {
		animation: rise-in 0.4s ease both;
	}
</style>
