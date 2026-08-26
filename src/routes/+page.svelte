<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import CoverImage from '$lib/components/ui/CoverImage.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Segmented from '$lib/components/ui/Segmented.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { STATUS_LABELS } from '$lib/types';

	let { data }: { data: PageData } = $props();

	const views = [
		{ id: 'cards', label: 'Cards', icon: '▦' },
		{ id: 'table', label: 'Table', icon: '☰' },
		{ id: 'list', label: 'List', icon: '≣' }
	] as const;
	type ViewId = (typeof views)[number]['id'];

	// View mode: initialized from ?view= (deep-linkable) but kept as local state so
	// switching is instant with no navigation.
	let view = $state<ViewId>(((page.url.searchParams.get('view') as ViewId | null) ?? 'cards'));

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
		const current = params.get('sort') ?? 'artist';
		if (current === column) {
			params.set('dir', params.get('dir') === 'desc' ? 'asc' : 'desc');
		} else {
			params.set('sort', column);
			params.set('dir', 'asc');
		}
		window.location.href = `/?${params.toString()}`;
	}

	function sortIndicator(column: string): string {
		const params = page.url.searchParams;
		if (params.get('sort') !== column) return '';
		return params.get('dir') === 'desc' ? ' ↓' : ' ↑';
	}

	const sortableColumns: [string, string][] = [
		['artist', 'Artist'],
		['title', 'Title'],
		['year', 'Year'],
		['genre', 'Genre'],
		['label', 'Label']
	];

	function fmtPrice(cents: number | null): string {
		return cents === null ? '' : `$${(cents / 100).toFixed(2)}`;
	}

	function coverSrc(rec: { cover_filename: string | null; cover_remote_url: string | null }): string | null {
		if (rec.cover_filename) return `/media/${rec.cover_filename}`;
		return rec.cover_remote_url;
	}

	const active = data.filters.active;
	const hasActiveFilters = Boolean(active.search || active.genre || active.label || active.status);

	const statusTone: Record<string, 'forest' | 'butter' | 'muted'> = {
		in_collection: 'forest',
		sold: 'butter',
		traded_away: 'muted'
	};
</script>

<svelte:head><title>mynyl — your vinyl collection</title></svelte:head>

<div class="space-y-6">
	<header class="flex flex-wrap items-end justify-between gap-3 pt-2">
		<div class="space-y-1">
			<h1 class="font-display text-3xl font-black tracking-tight sm:text-4xl">Your collection</h1>
			<p class="text-sm text-muted">
				{data.total} {data.total === 1 ? 'record' : 'records'} — scanned, bought, loved.
			</p>
		</div>
	</header>

	<!-- toolbar: search (row 1) + filters (row 2) -->
	<Card class="space-y-3 p-3 sm:p-4">
		<form method="GET" class="flex flex-col gap-3">
			<Input
				type="search"
				name="q"
				value={active.search}
				placeholder="Search artist, title, genre, label…"
				class="py-2.5"
			/>
			<div class="flex flex-wrap items-center gap-2">
				<div class="w-40 max-w-full">
					<Select name="genre" value={active.genre} onchange={(e) => updateParam('genre', (e.target as HTMLSelectElement).value)}>
						<option value="">All genres</option>
						{#each data.filters.genres as g}<option value={g}>{g}</option>{/each}
					</Select>
				</div>
				<div class="w-40 max-w-full">
					<Select name="label" value={active.label} onchange={(e) => updateParam('label', (e.target as HTMLSelectElement).value)}>
						<option value="">All labels</option>
						{#each data.filters.labels as l}<option value={l}>{l}</option>{/each}
					</Select>
				</div>
				<div class="w-40 max-w-full">
					<Select name="status" value={active.status ?? ''} onchange={(e) => updateParam('status', (e.target as HTMLSelectElement).value)}>
						<option value="">Any status</option>
						{#each Object.entries(STATUS_LABELS) as [value, label]}<option value={value}>{label}</option>{/each}
					</Select>
				</div>
				<Button type="submit" variant="primary" size="sm">Apply</Button>
				{#if hasActiveFilters}
					<a href="/?view={view}" class="text-sm font-semibold text-muted underline underline-offset-4 hover:text-rust">
						clear
					</a>
				{/if}
			</div>
		</form>
	</Card>

	<!-- view toggle + count -->
	<div class="flex flex-wrap items-center gap-3">
		<Segmented options={views} bind:value={view} />
		<Badge tone="plum" class="ml-auto">{data.records.length} of {data.total} shown</Badge>
	</div>

	<!-- empty state -->
	{#if data.records.length === 0}
		<div class="rounded-2xl border-2 border-dashed border-muted/60 bg-surface/50 p-10 text-center">
			<div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border-2 border-edge bg-surface-2">
				<!-- vinyl placeholder -->
				<svg viewBox="0 0 96 96" class="h-12 w-12 text-muted" aria-hidden="true" fill="none">
					<circle cx="48" cy="48" r="44" stroke="currentColor" stroke-width="3" />
					<circle cx="48" cy="48" r="30" stroke="currentColor" stroke-width="1.5" opacity="0.5" />
					<circle cx="48" cy="48" r="14" fill="var(--plum)" stroke="var(--edge)" stroke-width="3" />
					<circle cx="48" cy="48" r="3.5" fill="var(--paper)" />
				</svg>
			</div>
			<p class="mb-2 font-display text-xl font-black tracking-tight">
				{data.total === 0 ? 'No records yet' : 'Nothing matches those filters'}
			</p>
			<p class="mb-5 text-sm text-muted">
				{data.total === 0
					? 'Scan a barcode or add one manually to start your collection.'
					: 'Try adjusting or clearing the search and filters.'}
			</p>
			{#if data.total === 0}
				<div class="flex flex-wrap justify-center gap-3">
					<Button href="/scan">📷 Scan a record</Button>
					<Button href="/import/manual" variant="secondary">+ Add manually</Button>
				</div>
			{/if}
		</div>
	{:else if view === 'cards'}
		<!-- CARDS -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
			{#each data.records as rec, i (rec.id)}
				<a href="/records/{rec.id}" class="group block" style="animation-delay: {Math.min(i * 30, 300)}ms" aria-label={`${rec.artist} — ${rec.title}`}>
					<Card lift class="h-full overflow-hidden p-0">
						<div class="relative aspect-square w-full border-b-2 border-edge bg-surface-2">
							<CoverImage src={coverSrc(rec)} class="rounded-none border-0" loading="lazy" />
							{#if rec.copies > 1}
								<span class="card-pop-sm absolute right-2 top-2 rounded-full border-2 border-edge bg-paper px-2 py-0.5 text-xs font-black shadow-brutal-sm">
									{rec.copies}×
								</span>
							{/if}
						</div>
						<div class="space-y-1 p-3">
							<p class="truncate font-display text-base font-black tracking-tight group-hover:text-plum">{rec.artist}</p>
							<p class="truncate text-sm text-muted">{rec.title}</p>
							<div class="flex flex-wrap items-center gap-1 pt-1">
								{#if rec.year || rec.genre}
									<span class="text-xs font-semibold text-muted">
										{[rec.year, rec.genre].filter(Boolean).join(' · ')}
									</span>
								{/if}
								<Badge tone={statusTone[rec.status]} class="ml-auto">{STATUS_LABELS[rec.status]}</Badge>
							</div>
						</div>
					</Card>
				</a>
			{/each}
		</div>
	{:else if view === 'table'}
		<!-- TABLE -->
		<Card shadow class="overflow-hidden p-0">
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="border-b-2 border-edge bg-surface-2 text-left">
						<tr>
							{#each sortableColumns as [col, colLabel] (col)}
								<th class="p-3">
									<button type="button" onclick={() => toggleSort(col)} class="text-xs font-black uppercase tracking-wider hover:text-plum">
										{colLabel}{sortIndicator(col)}
									</button>
								</th>
							{/each}
							<th class="p-3 text-xs font-black uppercase tracking-wider">Cond.</th>
							<th class="p-3 text-right text-xs font-black uppercase tracking-wider">Price</th>
							<th class="p-3 text-xs font-black uppercase tracking-wider">Status</th>
						</tr>
					</thead>
					<tbody>
						{#each data.records as rec (rec.id)}
							<tr class="border-b border-edge/10 last:border-b-0 hover:bg-surface-2/60">
								<td class="p-3 font-bold">
									<a href="/records/{rec.id}" class="hover:text-plum hover:underline underline-offset-4">{rec.artist}</a>
									{#if rec.copies > 1}<span class="ml-1 text-xs font-black text-muted">×{rec.copies}</span>{/if}
								</td>
								<td class="p-3">{rec.title}</td>
								<td class="p-3 text-muted">{rec.year ?? ''}</td>
								<td class="p-3 text-muted">{rec.genre ?? ''}</td>
								<td class="p-3 text-muted">{rec.label ?? ''}</td>
								<td class="p-3 font-mono text-xs">
									{[rec.condition_media && `M:${rec.condition_media}`, rec.condition_sleeve && `S:${rec.condition_sleeve}`].filter(Boolean).join(' ') || '—'}
								</td>
								<td class="p-3 text-right font-mono">{fmtPrice(rec.price_paid)}</td>
								<td class="p-3"><Badge tone={statusTone[rec.status]}>{STATUS_LABELS[rec.status]}</Badge></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{:else}
		<!-- LIST -->
		<Card shadow class="divide-y-2 divide-edge/10 overflow-hidden p-0">
			<ul>
				{#each data.records as rec (rec.id)}
					<li>
						<a href="/records/{rec.id}" class="group flex items-center gap-3 p-3 transition-colors hover:bg-surface-2/60">
							<CoverImage src={coverSrc(rec)} alt="" class="h-14 w-14 shrink-0 rounded-xl" loading="lazy" />
							<div class="min-w-0 flex-1">
								<p class="truncate font-bold group-hover:text-plum">{rec.artist} — {rec.title}</p>
								<p class="truncate text-xs text-muted">
									{[rec.year, rec.genre, rec.label, rec.format].filter(Boolean).join(' · ')}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if rec.copies > 1}<span class="font-mono text-xs font-black text-muted">{rec.copies}×</span>{/if}
								<span class="hidden font-mono text-sm sm:inline">{fmtPrice(rec.price_paid)}</span>
								<Badge tone={statusTone[rec.status]} class="hidden sm:inline-flex">{STATUS_LABELS[rec.status]}</Badge>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</div>

<style>
	/* staggered pop-in for the card grid (delay comes from the inline style attr) */
	.group {
		animation: shadow-pop 0.35s cubic-bezier(0.3, 1.4, 0.5, 1) both;
	}
</style>
