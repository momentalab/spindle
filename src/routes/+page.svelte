<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const views = [
		{ id: 'cards', label: 'Cards', icon: '▦' },
		{ id: 'table', label: 'Table', icon: '☰' },
		{ id: 'list', label: 'List', icon: '≡' }
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

	function fmtPrice(cents: number | null): string {
		return cents === null ? '' : `$${(cents / 100).toFixed(2)}`;
	}

	function coverSrc(rec: { cover_filename: string | null; cover_remote_url: string | null }): string | null {
		if (rec.cover_filename) return `/media/${rec.cover_filename}`;
		return rec.cover_remote_url;
	}

	const active = data.filters.active;
	const hasActiveFilters = Boolean(active.search || active.genre || active.label || active.status);
</script>

<div class="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
	<!-- header -->
	<header class="flex flex-wrap items-center gap-3">
		<a href="/" class="text-2xl font-bold tracking-tight">
			my<span class="text-emerald-400">nyl</span>
		</a>
		<div class="ml-auto flex items-center gap-3">
			<span class="hidden text-sm opacity-60 sm:inline">
				{data.records.length} of {data.total} record{data.total === 1 ? '' : 's'}
			</span>
			<a href="/scan" class="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500">
				📷 Scan
			</a>
			<a href="/import/manual" class="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500">
				+ Add
			</a>
		</div>
	</header>

	<!-- toolbar: search + filters -->
	<form method="GET" class="flex flex-wrap items-center gap-2">
		<input
			type="search"
			name="q"
			value={active.search}
			placeholder="Search artist, title, genre, label…"
			class="min-w-[200px] flex-1 rounded-lg border border-zinc-700 bg-transparent px-3 py-2 text-sm"
		/>
		<select
			name="genre"
			value={active.genre}
			onchange={(e) => updateParam('genre', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-transparent px-3 py-2 text-sm"
		>
			<option value="">All genres</option>
			{#each data.filters.genres as g}<option value={g}>{g}</option>{/each}
		</select>
		<select
			name="label"
			value={active.label}
			onchange={(e) => updateParam('label', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-transparent px-3 py-2 text-sm"
		>
			<option value="">All labels</option>
			{#each data.filters.labels as l}<option value={l}>{l}</option>{/each}
		</select>
		<select
			name="status"
			value={active.status ?? ''}
			onchange={(e) => updateParam('status', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-transparent px-3 py-2 text-sm"
		>
			<option value="">Any status</option>
			<option value="in_collection">In collection</option>
			<option value="sold">Sold</option>
			<option value="traded_away">Traded away</option>
		</select>
		<button type="submit" class="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500">
			Apply
		</button>
		{#if hasActiveFilters}
			<a href="/?view={view}" class="text-sm opacity-60 underline hover:opacity-100">clear</a>
		{/if}
	</form>

	<!-- view toggle -->
	<div class="flex items-center gap-1 rounded-lg border border-zinc-800 p-1 w-fit">
		{#each views as v (v.id)}
			<button
				class="rounded-md px-3 py-1 text-sm {view === v.id ? 'bg-emerald-600 font-medium' : 'opacity-70 hover:opacity-100'}"
				onclick={() => setView(v.id)}
			>
				{v.icon} {v.label}
			</button>
		{/each}
	</div>

	<!-- empty state -->
	{#if data.records.length === 0}
		<div class="rounded-xl border border-dashed border-zinc-700 p-10 text-center">
			<p class="mb-2 text-lg font-medium">
				{data.total === 0 ? 'No records yet' : 'Nothing matches those filters'}
			</p>
			<p class="mb-4 text-sm opacity-60">
				{data.total === 0
					? 'Scan a barcode or add one manually to start your collection.'
					: 'Try adjusting or clearing the search and filters.'}
			</p>
			{#if data.total === 0}
				<div class="flex justify-center gap-3">
					<a href="/scan" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium">📷 Scan a record</a>
					<a href="/import/manual" class="rounded-lg border border-zinc-700 px-4 py-2 text-sm">+ Add manually</a>
				</div>
			{/if}
		</div>
	{:else if view === 'cards'}
		<!-- CARDS -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
			{#each data.records as rec (rec.id)}
				<a href="/records/{rec.id}" class="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 transition hover:border-emerald-500/60">
					<div class="relative aspect-square w-full overflow-hidden bg-zinc-800">
						{#if coverSrc(rec)}
							<img src={coverSrc(rec)} alt="" loading="lazy" class="h-full w-full object-cover transition group-hover:scale-105" />
						{:else}
							<div class="flex h-full items-center justify-center text-4xl opacity-30">💿</div>
						{/if}
						{#if rec.copies > 1}
							<span class="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs">{rec.copies}×</span>
						{/if}
					</div>
					<div class="p-3">
						<p class="truncate text-sm font-semibold">{rec.artist}</p>
						<p class="truncate text-sm opacity-70">{rec.title}</p>
						<p class="mt-1 truncate text-xs opacity-50">{[rec.year, rec.genre].filter(Boolean).join(' · ')}</p>
					</div>
				</a>
			{/each}
		</div>
	{:else if view === 'table'}
		<!-- TABLE -->
		<div class="overflow-x-auto rounded-xl border border-zinc-800">
			<table class="w-full text-sm">
				<thead class="bg-zinc-900 text-left text-xs uppercase tracking-wide opacity-70">
					<tr>
						<th class="cursor-pointer p-3" onclick={() => toggleSort('artist')}>Artist{sortIndicator('artist')}</th>
						<th class="cursor-pointer p-3" onclick={() => toggleSort('title')}>Title{sortIndicator('title')}</th>
						<th class="cursor-pointer p-3" onclick={() => toggleSort('year')}>Year{sortIndicator('year')}</th>
						<th class="cursor-pointer p-3" onclick={() => toggleSort('genre')}>Genre{sortIndicator('genre')}</th>
						<th class="cursor-pointer p-3" onclick={() => toggleSort('label')}>Label{sortIndicator('label')}</th>
						<th class="p-3">Cond.</th>
						<th class="p-3 text-right">Price</th>
						<th class="p-3">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-zinc-800">
					{#each data.records as rec (rec.id)}
						<tr class="hover:bg-zinc-900/60">
							<td class="p-3 font-medium">
								<a href="/records/{rec.id}" class="hover:text-emerald-400">{rec.artist}</a>
								{#if rec.copies > 1}<span class="text-xs opacity-50">×{rec.copies}</span>{/if}
							</td>
							<td class="p-3 opacity-80">{rec.title}</td>
							<td class="p-3 opacity-70">{rec.year ?? ''}</td>
							<td class="p-3 opacity-70">{rec.genre ?? ''}</td>
							<td class="p-3 opacity-70">{rec.label ?? ''}</td>
							<td class="p-3 text-xs opacity-70">{[rec.condition_media && `M:${rec.condition_media}`, rec.condition_sleeve && `S:${rec.condition_sleeve}`].filter(Boolean).join(' ') || '—'}</td>
							<td class="p-3 text-right opacity-70">{fmtPrice(rec.price_paid)}</td>
							<td class="p-3 text-xs">
								<span class="rounded-full bg-zinc-800 px-2 py-0.5">{rec.status.replace('_', ' ')}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<!-- LIST -->
		<ul class="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
			{#each data.records as rec (rec.id)}
				<li>
					<a href="/records/{rec.id}" class="flex items-center gap-3 p-3 hover:bg-zinc-900/60">
						<div class="h-12 w-12 shrink-0 overflow-hidden rounded bg-zinc-800">
							{#if coverSrc(rec)}
								<img src={coverSrc(rec)} alt="" loading="lazy" class="h-full w-full object-cover" />
							{:else}<div class="flex h-full items-center justify-center text-xl opacity-30">💿</div>{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{rec.artist} — {rec.title}</p>
							<p class="truncate text-xs opacity-60">
								{[rec.year, rec.genre, rec.label, rec.format].filter(Boolean).join(' · ')}
							</p>
						</div>
						<div class="shrink-0 text-right text-xs opacity-60">
							{#if rec.copies > 1}<span class="block">{rec.copies}×</span>{/if}
							<span class="block">{fmtPrice(rec.price_paid)}</span>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
