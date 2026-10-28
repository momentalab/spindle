<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import AcquireDialog from '$lib/components/AcquireDialog.svelte';
	import type { ActionData, PageData } from './$types';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import CoverImage from '$lib/components/ui/CoverImage.svelte';
	import { appTitle } from '$lib/index';
	import { DISCOGS_LINK_ATTRS, discogsReleaseUrl } from '$lib/discogs';
	import Segmented from '$lib/components/ui/Segmented.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { STATUS_LABELS, joinLabels, type RecordRow, type SortColumn } from '$lib/types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	/* -------------------------------------------------------------- */
	/* Shelf split: Collection vs Wishlist. The server load resolves   */
	/* ?tab= (with ?status=wanted kept as a legacy alias) for first    */
	/* paint; after hydration the full /api/list dataset holds both,   */
	/* so switching is pure local state - no navigation.               */
	/* -------------------------------------------------------------- */

	const shelves = [
		{ id: 'collection', label: 'Collection' },
		{ id: 'wishlist', label: 'Wishlist' }
	] as const;
	type ShelfId = (typeof shelves)[number]['id'];

	// Initialized from the URL, like `view` (?tab=wishlist; the server load
	// also honors the legacy ?status=wanted alias for first paint). After
	// hydration, switching is pure local state — no navigation.
	let shelf = $state<ShelfId>(
		page.url.searchParams.get('tab') === 'wishlist' || page.url.searchParams.get('status') === 'wanted'
			? 'wishlist'
			: 'collection'
	);

	// The "N still wanted" pointer is a real navigation (/?tab=wishlist). Same-
	// route navigations don't remount this component, so the one-shot init above
	// would go stale — mirror the URL into the shelf after hydration. Local tab
	// clicks change no URL, so they stay ephemeral between navigations.
	$effect(() => {
		shelf =
			page.url.searchParams.get('tab') === 'wishlist' || page.url.searchParams.get('status') === 'wanted'
				? 'wishlist'
				: 'collection';
	});

	const views = [
		{ id: 'cards', label: 'Cards' },
		{ id: 'index', label: 'Index' },
		{ id: 'table', label: 'Table' }
	] as const;
	type ViewId = (typeof views)[number]['id'];

	// View mode: initialized from ?view= (deep-linkable), falling back to the
	// user's saved default (set on /settings), then "cards". Kept as local state
	// so switching is instant with no navigation. The localStorage read happens
	// once post-mount — it would break SSR to run it during hydration of first
	// paint — and must NOT re-apply on later same-route navigations, which used
	// to snap the view back to the saved default mid-session.
	let view = $state<ViewId>((page.url.searchParams.get('view') as ViewId | null) ?? 'cards');

	onMount(() => {
		// `?? mynyl-default-view` migrates the preference across the app rename (one-time read fallback).
		const saved = localStorage.getItem('spindle-default-view') ?? localStorage.getItem('mynyl-default-view');
		if (page.url.searchParams.get('view') === null && saved && views.some((v) => v.id === saved)) {
			view = saved as ViewId;
		}
	});

	/* -------------------------------------------------------------- */
	/* Client-owned filter / sort / search state.                      */
	/* The SSR load paints the initial (deep-linkable) filtered view;  */
	/* after hydration every change is pure local state, so touching a  */
	/* control never re-renders anything outside the result grid — no  */
	/* navigation, no full-page reload.                                */
	/* -------------------------------------------------------------- */

	let qInput = $state(page.url.searchParams.get('q') ?? '');
	let genreF = $state(page.url.searchParams.get('genre') ?? '');
	let labelF = $state(page.url.searchParams.get('label') ?? '');
	let statusF = $state(page.url.searchParams.get('status') ?? '');
	let localOnly = $state(page.url.searchParams.get('local') === '1');
	// Starred filter (?fav=1): records with at least one favorited track. The
	// server load honors it for first paint; after hydration it's local state.
	let favF = $state(page.url.searchParams.get('fav') === '1');
	let sort = $state<SortColumn>((page.url.searchParams.get('sort') as SortColumn | null) ?? 'artist');
	let dir = $state<'asc' | 'desc'>(page.url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc');

	function toggleSort(column: string): void {
		if (sort === column) dir = dir === 'asc' ? 'desc' : 'asc';
		else {
			sort = column as SortColumn;
			dir = 'asc';
		}
	}

	function sortIndicator(column: string): string {
		if (sort !== column) return '';
		return dir === 'desc' ? ' ↓' : ' ↑';
	}

	function clearFilters(): void {
		qInput = '';
		genreF = '';
		labelF = '';
		statusF = '';
		favF = false;
	}

	// Per-record track counts. SSR hands us a Map; /api/list refills the same
	// shape (JSON object → Map). Absent record = no tracks (read 0).
	let trackCounts = $state<Map<number, { total: number; fav: number }>>(new Map());

	// The working copy: null until /api/list lands, then the client filters
	// and sorts it locally (the SSR `data.records` stand in for first paint).
	let localRecords = $state<RecordRow[] | null>(null);
	let listAbort: AbortController | undefined;

	async function refreshLocal(): Promise<void> {
		listAbort?.abort();
		const ctrl = new AbortController();
		listAbort = ctrl;
		try {
			const res = await fetch('/api/list', { signal: ctrl.signal });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as {
				records: RecordRow[];
				track_counts?: Record<string, { total: number; fav: number }>;
			};
			if (!ctrl.signal.aborted) {
				localRecords = json.records;
				const counts = new Map<number, { total: number; fav: number }>();
				for (const [k, v] of Object.entries(json.track_counts ?? {})) counts.set(Number(k), v);
				trackCounts = counts;
			}
		} catch {
			// Offline / hiccups: keep whatever we have (SSR data at first).
		}
	}

	// The shelf split is the first filter — server and client apply the same
	// rule, so first paint (the SSR list) and post-hydration (the full
	// /api/list set) never disagree. Wanted rows live only on the wishlist.
	const shelfRecords = $derived.by((): RecordRow[] => {
		const base = localRecords ?? data.records;
		return base.filter((r) => (shelf === 'wishlist' ? r.status === 'wanted' : r.status !== 'wanted'));
	});

	// Filter + sort in one pass — the single derived every view renders from.
	const displayRecords = $derived.by((): RecordRow[] => {
		if (!localRecords) return data.records;
		const q = qInput.trim().toLowerCase();
		let out: RecordRow[] = shelfRecords;
		if (q)
			out = out.filter(
				(r) =>
					r.artist.toLowerCase().includes(q) ||
					r.title.toLowerCase().includes(q) ||
					r.genres.some((g) => g.toLowerCase().includes(q)) ||
					r.labels.some((l) => l.name.toLowerCase().includes(q))
			);
		if (genreF) out = out.filter((r) => r.genres.includes(genreF));
		if (labelF) out = out.filter((r) => r.labels.some((l) => l.name === labelF));
		// The wishlist shelf is pinned to wanted; the status filter applies to
		// the collection shelf only (wanted can't match there - it's excluded).
		if (shelf === 'collection' && statusF) out = out.filter((r) => r.status === statusF);
		if (favF) out = out.filter((r) => favCountOf(r) > 0);
		const mul = dir === 'asc' ? 1 : -1;
		const value = (r: RecordRow): string | number => {
			switch (sort) {
				case 'title':
					return r.title.toLowerCase();
				case 'year':
					return r.year ?? '\uffff'; // missing years last, either direction
				case 'genre':
					return r.genres[0]?.toLowerCase() ?? '\uffff';
				case 'label':
					return r.labels[0]?.name.toLowerCase() ?? '\uffff';
				case 'favorite_tracks':
					return favCountOf(r);
				case 'acquired_at':
					return r.acquired_at ?? '\uffff'; // missing dates last
				case 'updated_at':
					return r.updated_at ?? '\uffff';
				default:
					return r.artist.toLowerCase();
			}
		};
		return [...out].sort((a, b) => {
			const va = value(a);
			const vb = value(b);
			if (va < vb) return -mul;
			if (va > vb) return mul;
			return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
		});
	});

	const sortableColumns: [string, string][] = [
		['title', 'Title'],
		['artist', 'Artist'],
		['year', 'Year'],
		['genre', 'Genre'],
		['label', 'Label'],
		['favorite_tracks', 'Starred']
	];

	// Sort dropdown options (all SortColumn values, human-readable labels).
	const sortOptions: [SortColumn, string][] = [
		['artist', 'Artist'],
		['title', 'Title'],
		['year', 'Year'],
		['genre', 'Genre'],
		['label', 'Label'],
		['favorite_tracks', 'Starred'],
		['acquired_at', 'Acquired'],
		['updated_at', 'Updated']
	];

	/** How many tracks on this record are favorited (0 when none tracked).
	     SSR map until /api/list lands — same parity as playCount(). */
	function favCountOf(rec: { id: number }): number {
		return (localRecords ? trackCounts.get(rec.id) : data.track_counts.get(rec.id))?.fav ?? 0;
	}

	function fmtPrice(cents: number | null): string {
		return cents === null ? '' : `$${(cents / 100).toFixed(2)}`;
	}

	function coverSrc(rec: { cover_filename: string | null; cover_remote_url: string | null }): string | null {
		if (rec.cover_filename) return `/media/${rec.cover_filename}`;
		return rec.cover_remote_url;
	}

	const hasActiveFilters = $derived(
		Boolean(qInput.trim() || genreF || labelF || favF || (shelf === 'collection' && statusF))
	);

	// How many records are on the current shelf (before search/filters) — drives
	// the header count and the "X of Y shown" line.
	const shelfCount = $derived(shelfRecords.length);

	/* -------------------------------------------------------------- */
	/* Name lookup — the search bar doubles as a Discogs release finder */
	/* -------------------------------------------------------------- */

	/** A remote (Discogs) search hit, as returned by /api/search. */
	interface RemoteHit {
		id: number;
		title: string;
		type?: string;
		year?: string;
		catno?: string;
		barcode?: string[];
		thumb?: string;
		format?: string[];
		label?: string[];
		country?: string;
		community?: { want?: number; have?: number };
	}

	// The query the remote results below belong to. Only in sync with the bar
	// after a fetch resolves — mid-typing the bar may say something newer.
	let remoteQ = $state('');
	let remoteHits = $state<RemoteHit[]>([]);
	let remoteTotal = $state(0);
	let remoteBusy = $state(false);
	let remoteError = $state<string | null>(null);
	// One save at a time; `kind` distinguishes the "+ Add" button from the heart.
	let saving = $state<{ id: number; kind: 'add' | 'wish' } | null>(null);
	let addedFlash = $state<string | null>(null); // brief confirmation line
	let searchAbort: AbortController | undefined;

	async function runRemoteSearch(query: string): Promise<void> {
		searchAbort?.abort();
		const ctrl = new AbortController();
		searchAbort = ctrl;
		remoteBusy = true;
		remoteError = null;
		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
				signal: ctrl.signal
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(body?.message ?? `Discogs error ${res.status}`);
			}
			const json = (await res.json()) as {
				candidates?: RemoteHit[];
				total?: number;
			};
			if (ctrl.signal.aborted) return; // a newer keystroke superseded this one
			remoteHits = json.candidates ?? [];
			remoteTotal = json.total ?? 0;
			remoteQ = query;
		} catch (e) {
			if (ctrl.signal.aborted) return;
			remoteError = e instanceof Error ? e.message : 'Discogs lookup failed.';
			remoteHits = [];
			remoteTotal = 0;
			remoteQ = query;
		} finally {
			if (!ctrl.signal.aborted) remoteBusy = false;
		}
	}

	/**
	 * Actions on a Discogs hit. "+ Add" hands the release to the record editor
	 * at /import/release/[id] — the same page the barcode flow uses — so the
	 * user can review and fill in details before anything is committed. "wish"
	 * stays a one-tap save onto the wishlist; the local dataset is refetched so
	 * the fresh row appears in the grid.
	 */
	async function addRemote(hit: RemoteHit, kind: 'add' | 'wish'): Promise<void> {
		if (saving) return;
		if (kind === 'add') {
			goto(`/import/release/${hit.id}`);
			return;
		}
		saving = { id: hit.id, kind };
		try {
			const res = await fetch('/api/search', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					id: hit.id,
					status: kind === 'wish' ? 'wanted' : 'in_collection'
				})
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(body?.message ?? `HTTP ${res.status}`);
			}
			const json = (await res.json()) as {
				recordId?: number | null;
				duplicate?: {
					id: number;
					artist: string;
					title: string;
					status?: string;
				};
			};
			if (json.recordId === null && json.duplicate) {
				addedFlash = `Already saved — ${json.duplicate.artist} · ${json.duplicate.title}`;
			} else if (json.recordId) {
				addedFlash = kind === 'wish' ? `Added to the wishlist — ${hit.title}` : `Saved to the index — ${hit.title}`;
			}
			await refreshLocal();
		} catch (e) {
			remoteError = e instanceof Error ? e.message : 'Could not save that release.';
		} finally {
			saving = null;
		}
	}

	// Hydrate the full local dataset once, client-side — after this, search and
	// filters are pure state (no navigation). Refetch after a save so the new
	// row joins the grid.
	onMount(() => {
		void refreshLocal();
	});

	// Live search: one Discogs round-trip per pause of typing — the window is
	// long enough that a normal micro-pause mid-word doesn't fire it, but once
	// you've genuinely stopped typing the results appear. The query is read
	// DIRECTLY below (not through a boolean derived) so the effect re-runs on
	// every keystroke and reschedules; as soon as the query can no longer match
	// remotely (emptied, back-spaced below two chars, or local-only on) the
	// remote section is retracted at once — never showing results for a stale
	// query. Local results filter instantly as you type (pure derived).
	const REMOTE_DEBOUNCE_MS = 700;
	$effect(() => {
		const q = qInput.trim();
		if (!localOnly && q.length >= 2) {
			const t = setTimeout(() => void runRemoteSearch(q), REMOTE_DEBOUNCE_MS);
			return () => clearTimeout(t);
		}
		searchAbort?.abort();
		remoteHits = [];
		remoteTotal = 0;
		remoteQ = '';
		remoteError = null;
		remoteBusy = false;
	});

	// The "saved" flash is quiet and self-dismissing.
	$effect(() => {
		if (!addedFlash) return;
		const t = setTimeout(() => (addedFlash = null), 5000);
		return () => clearTimeout(t);
	});

	// wanted → plum: the pre-ownership end of the status axis (F5).
	const statusTone: Record<string, 'forest' | 'plum' | 'butter' | 'muted'> = {
		in_collection: 'forest',
		sold: 'butter',
		traded_away: 'muted',
		wanted: 'plum'
	};

	// Play log from the index: quick +1 (and −) on every row without leaving
	// the page. Optimistic local increment, reconciled from the server's
	// authoritative count; a failed request reverts.
	let playCountOverrides = $state<Record<number, number>>({});
	const playCount = (rec: { id: number }): number => playCountOverrides[rec.id] ?? data.play_counts?.[rec.id] ?? 0;

	let busyPlays = $state<Record<number, boolean>>({});

	// Acquire dialog (F5): the "→ acquired" chip opens this instead of flipping
	// the row at once — the just-bought-it details (date, price, conditions)
	// belong in a modal. The form inside posts to ?/acquire with use:enhance;
	// a plain success closes it and revalidates, so the row leaves the shelf
	// in place without any navigation.
	let acquireFor = $state<RecordRow | null>(null);

	interface PlayResponse {
		ok?: boolean;
		play_count?: number;
		message?: string;
	}

	async function quickLog(rec: { id: number }): Promise<void> {
		if (busyPlays[rec.id]) return;
		busyPlays[rec.id] = true;
		const prev = playCountOverrides[rec.id];
		playCountOverrides[rec.id] = playCount(rec) + 1;
		try {
			const res = await fetch(`/api/records/${rec.id}/plays`, {
				method: 'POST'
			});
			const json = (await res.json().catch(() => null)) as PlayResponse | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			playCountOverrides[rec.id] = json.play_count ?? 0;
		} catch {
			if (prev === undefined) delete playCountOverrides[rec.id];
			else playCountOverrides[rec.id] = prev;
		} finally {
			const b = { ...busyPlays };
			delete b[rec.id];
			busyPlays = b;
		}
	}

	async function quickUndo(rec: { id: number }): Promise<void> {
		if (busyPlays[rec.id] || playCount(rec) <= 0) return;
		busyPlays[rec.id] = true;
		const prev = playCountOverrides[rec.id];
		playCountOverrides[rec.id] = Math.max(0, playCount(rec) - 1);
		try {
			const res = await fetch(`/api/records/${rec.id}/plays`, {
				method: 'DELETE'
			});
			const json = (await res.json().catch(() => null)) as PlayResponse | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			playCountOverrides[rec.id] = json.play_count ?? 0;
		} catch {
			if (prev === undefined) delete playCountOverrides[rec.id];
			else playCountOverrides[rec.id] = prev;
		} finally {
			const b = { ...busyPlays };
			delete b[rec.id];
			busyPlays = b;
		}
	}
</script>

<!-- One-tap play log per row: − (undo latest) + count + +1. Rendered as a
     SIBLING of the row anchor in every view (never nested inside it). Quiet
     chip: hidden until row hover on desktop, always visible on touch. -->
<!-- Acquire: sits where the play chip sits, but only on wanted rows (i.e. the
     wishlist shelf). Opens the acquire dialog for the just-bought-it details;
     its enhanced form stays on the page — on success the row flips to the
     collection shelf in place and the counts update with it. -->
{#snippet acquireChip(rec: RecordRow)}
	{#if rec.status === 'wanted'}
		<button
			type="button"
			class="pointer-events-auto inline-flex items-center gap-1 rounded-xs border border-hair bg-paper/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[.14em] text-accent shadow-sm backdrop-blur-sm transition-colors duration-200 hover:border-accent disabled:pointer-events-none disabled:opacity-50"
			disabled={acquireFor !== null}
			title="Move to the collection"
			aria-label={`Mark ${rec.artist} — ${rec.title} as acquired`}
			onclick={() => (acquireFor = rec)}
		>
			→ acquired
		</button>
	{/if}
{/snippet}

{#snippet playControl(rec: { id: number; artist: string; title: string })}
	<div
		class="pointer-events-auto inline-flex items-center gap-1 rounded-xs border border-hair bg-paper/90 px-2 py-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100 hover:opacity-100 pointer-coarse:opacity-100"
	>
		{#if playCount(rec) > 0}
			<button
				type="button"
				class="min-w-5 text-center text-sm leading-none text-faint transition-colors hover:text-rust disabled:pointer-events-none disabled:opacity-40"
				disabled={!!busyPlays[rec.id]}
				title="Undo last play"
				aria-label={`Undo last play of ${rec.artist} — ${rec.title}`}
				onclick={() => void quickUndo(rec)}
			>
				−
			</button>
		{/if}
		<span
			class={`min-w-5 text-center font-display text-[13px] italic leading-none ${playCount(rec) > 0 ? 'text-muted' : 'text-faint'}`}
			aria-label={`${playCount(rec)} plays`}
		>
			{playCount(rec)}
		</span>
		<button
			type="button"
			class="min-w-5 text-center text-sm leading-none text-faint transition-colors hover:text-accent disabled:pointer-events-none disabled:opacity-40"
			disabled={!!busyPlays[rec.id]}
			title="Log a play"
			aria-label={`Log a play of ${rec.artist} — ${rec.title}`}
			onclick={() => void quickLog(rec)}
		>
			+
		</button>
	</div>
{/snippet}

<svelte:head>
	<title>{appTitle(shelf === 'wishlist' ? 'Wishlist' : 'Collection')}</title>
</svelte:head>

<!-- Hover-reveal micro-link for the table view only (index/cards are whole-row anchors). -->
{#snippet discogsMicroLink(rec: { discogs_id: number | string | null; artist: string | null; title: string })}
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

<!-- Starred-tracks badge: gold star + count, shown only when the record has at
     least one favorited track. Renders as a sibling of row anchors everywhere. -->
{#snippet starBadge(rec: { id: number; artist: string; title: string })}
	{#if favCountOf(rec) > 0}
		<span
			class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[.14em] text-accent"
			title={`${favCountOf(rec)} starred track${favCountOf(rec) === 1 ? '' : 's'}`}
			aria-label={`${favCountOf(rec)} starred tracks on ${rec.title}`}
		>
			<svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true">
				<path d="M8 1.8l1.9 3.9 4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6z" fill="currentColor" />
			</svg>
			{favCountOf(rec)}
		</span>
	{/if}
{/snippet}

<!-- page head — editorial, big and quiet -->
<header class="flex flex-wrap items-end justify-between gap-6 pb-7">
	<div class="min-w-0">
		<h1 class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em] sm:text-[52px]">
			{#if shelf === 'wishlist'}The wishlist.{:else}Your records,<br />catalogued.{/if}
		</h1>
	</div>
	<!-- max-sm:w-full: below sm this block wraps to its own line — full width makes
	     text-right pin the count, button and pointers to the right edge (title stays
	     top-left, stats bottom-right) instead of hugging left under the title. -->
	<div class="shrink-0 text-right max-sm:w-full">
		<div class="font-display text-[44px] leading-none {shelf === 'wishlist' ? 'text-plum' : ''}">
			{shelfCount}
		</div>
		<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
			{shelf === 'wishlist' ? 'records wanted' : 'records on the shelf'}
		</div>
		<!-- Scan: the primary way in — visible at every width so a new record
		     is one tap away without hunting for it (empty shelf included). -->
		<div class="mt-5">
			<Button href="/scan" variant="primary" size="sm">Scan a record</Button>
		</div>
		{#if data.total > 0}
			<!-- export & backup live in Settings now — the header keeps one quiet pointer -->
			<div class="mt-4 flex items-center justify-end gap-3">
				<a
					href="/print"
					title="The collection as a bound catalogue — print it, or export a PDF / image"
					class="text-[10.5px] font-semibold uppercase tracking-[.18em] text-muted underline decoration-hair underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
				>
					Catalogue
				</a>
				<span class="ml-1 text-[9.5px] font-semibold uppercase tracking-[.2em] text-faint">data</span>
				<a
					href="/settings"
					title="Export, backup & restore — all in Settings"
					class="text-[10.5px] font-semibold uppercase tracking-[.18em] text-muted underline decoration-hair underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
				>
					Settings
				</a>
			</div>
		{/if}
	</div>
</header>

<!-- the shelf split: the wishlist is its own tab, not a filter. The server
     load resolves it for first paint (deep-linkable via ?tab=wishlist, with
     the legacy ?status=wanted kept as an alias); switching after hydration
     is pure local state — no navigation, nothing outside the grid re-renders. -->
<div class="border-b border-edge">
	<div class="flex items-center gap-7 px-1 pt-4">
		<Segmented options={shelves} bind:value={shelf} />
	</div>
</div>

<!-- search — its own row: the bar is full-width at every viewport, so on a
     phone it is always visible and never squeezed behind the filter column.
     The bar doubles as a name lookup: local results are always the primary
     grid; while typing (2+ chars) Discogs matches appear above it with a
     one-tap add-to-collection and a heart for the wishlist. Everything here
     is client state — no navigation, so only the affected blocks update. -->
<section class="border-b border-hair py-6">
	<!-- row 1 — the search bar: live as you type (100ms debounce) -->
	<label for="q-input" class="block">
		<span class="sr-only">Search the collection</span>
		<input
			id="q-input"
			type="search"
			bind:value={qInput}
			placeholder="Search — artist, title, genre…"
			class="min-w-0 w-full border-0 bg-transparent p-0 font-display text-[19px] italic text-ink placeholder:text-faint focus:outline-none sm:text-[22px]"
		/>
	</label>

	<!-- row 2 — filters, local-only toggle, view switch -->
	<div class="mt-5 flex flex-wrap items-end gap-x-6 gap-y-4">
		<label class="flex flex-col gap-1.5">
			<span class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">Genre</span>
			<Select name="genre" bind:value={genreF} class="w-32 py-1.5">
				<option value="">All</option>
				{#each data.filters.genres as g}<option value={g}>{g}</option>{/each}
			</Select>
		</label>
		<label class="flex flex-col gap-1.5">
			<span class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">Label</span>
			<Select name="label" bind:value={labelF} class="w-32 py-1.5">
				<option value="">All</option>
				{#each data.filters.labels as l}<option value={l}>{l}</option>{/each}
			</Select>
		</label>
		<!-- The wishlist shelf is pinned to status = wanted, so the filter is
		     hidden there; on the collection shelf "Wanted" isn't an option —
		     those records live on their own tab. -->
		{#if shelf === 'collection'}
			<label class="flex flex-col gap-1.5">
				<span class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">Status</span>
				<Select name="status" bind:value={statusF} class="w-36 py-1.5">
					<option value="">Any</option>
					{#each Object.entries(STATUS_LABELS) as [value, label]: value}
						{#if value !== 'wanted'}<option {value}>{label}</option>{/if}
					{/each}
				</Select>
			</label>
		{/if}

		<!-- local-only: hide the Discogs section entirely (initialized from ?local=1) -->
		<label
			class="flex cursor-pointer select-none items-center gap-2 pb-1.5"
			title="Hide Discogs matches — show only records in this index"
		>
			<input type="checkbox" bind:checked={localOnly} class="h-3.5 w-3.5 accent-accent" />
			<span class="text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"> Local only </span>
		</label>

		<!-- Starred: records with at least one favorited track (initialized from ?fav=1) -->
		<label
			class="flex cursor-pointer select-none items-center gap-2 pb-1.5"
			title="Show only records with a starred track"
		>
			<input type="checkbox" bind:checked={favF} class="h-3.5 w-3.5 accent-accent" />
			<span class="text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"> Starred </span>
		</label>
	</div>

	<!-- row 3 — sort (left) + view switch (right) -->
	<div class="mt-4 flex items-center justify-between gap-4">
		<div class="flex items-end gap-2">
			<label class="flex flex-col gap-1.5">
				<span class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">Sort</span>
				<Select bind:value={sort} class="w-32 py-1.5">
					{#each sortOptions as [val, label]}
						<option value={val}>{label}</option>
					{/each}
				</Select>
			</label>
			<button
				type="button"
				onclick={() => (dir = dir === 'asc' ? 'desc' : 'asc')}
				class="mb-0.5 border border-edge px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-[.14em] text-muted transition-colors hover:border-ink hover:text-ink"
				title={dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
			>
				{dir === 'asc' ? '↑' : '↓'}
			</button>
		</div>
		<div class="flex items-center gap-5">
			<Segmented options={views} bind:value={view} />
			<span class="hidden text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint md:inline">
				{displayRecords.length} of {shelfCount} shown
			</span>
		</div>
	</div>

	{#if hasActiveFilters}
		<div class="mt-4">
			<button
				type="button"
				onclick={clearFilters}
				class="text-[11px] font-medium uppercase tracking-[.2em] text-faint underline underline-offset-4 transition-colors hover:text-accent"
			>
				Clear filters
			</button>
		</div>
	{/if}
</section>

<!-- empty state -->
{#if displayRecords.length === 0}
	<div class="flex flex-col items-center border-b border-hair py-20 text-center">
		<div class="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-edge">
			<!-- vinyl placeholder -->
			<svg viewBox="0 0 96 96" class="h-14 w-14 text-faint" aria-hidden="true" fill="none">
				<circle cx="48" cy="48" r="44" stroke="currentColor" stroke-width="2" />
				<circle cx="48" cy="48" r="30" stroke="currentColor" stroke-width="1" opacity="0.5" />
				<circle cx="48" cy="48" r="14" fill="var(--accent-dim)" stroke="currentColor" stroke-width="2" />
				<circle cx="48" cy="48" r="3.5" fill="var(--paper)" stroke="currentColor" stroke-width="1" />
			</svg>
		</div>
		<p class="mb-2 font-display text-2xl font-normal">
			{shelfCount === 0 && displayRecords.length === 0
				? shelf === 'wishlist'
					? 'Nothing on the wishlist yet'
					: data.total === 0
						? 'No records yet'
						: 'No records on this shelf yet'
				: 'Nothing matches those filters'}
		</p>
		<p class="mb-7 max-w-sm font-display text-[15px] italic text-muted">
			{shelfCount === 0 && displayRecords.length === 0
				? shelf === 'wishlist'
					? 'Heart a release from the search bar, or save an import as wanted, to start the list.'
					: data.total === 0
						? 'Scan a barcode or add one manually to start your collection.'
						: 'Scan a record, or mark a wishlist record as acquired.'
				: 'Try adjusting or clearing the search and filters.'}
		</p>
		{#if data.total === 0}
			<div class="flex flex-wrap justify-center gap-4">
				<Button href="/scan" variant="primary">Scan a record</Button>
				<Button href="/import/manual" variant="secondary">Add manually</Button>
			</div>
		{/if}
	</div>
{:else if view === 'index'}
	<!-- the catalogue: numbered entries, no cards. The title line is the anchor;
	     status + play sit on a second line below it — in the title's column their
	     varying widths squeezed long titles past recognition and kept the columns
	     out of vertical alignment row to row (a <button> may not live inside an
	     <a>, so the second line is its own element). -->
	<div class="mt-2 flex flex-col">
		{#each displayRecords as rec, i (rec.id)}
			<div
				class="entry group relative border-b border-hair transition-[padding] duration-200 group-hover:pl-2"
				style="animation-delay: {Math.min(i * 30, 300)}ms"
			>
				<a
					href="/records/{rec.id}"
					class="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 pr-4 pt-5 sm:grid-cols-[56px_72px_minmax(0,1fr)] sm:gap-x-6 sm:pr-6"
				>
					<!-- Number is dropped below sm so the row can never force a
					     horizontal scroll on narrow phones. -->
					<span class="hidden font-display text-[15px] italic text-faint sm:inline"
						>{String(i + 1).padStart(2, '0')}</span
					>
					<span class="block h-11 w-11 shrink-0 sm:h-18 sm:w-18">
						<CoverImage src={coverSrc(rec)} alt="" loading="lazy" />
					</span>
					<span class="min-w-0">
						<span
							class="block truncate font-display text-[19px] tracking-[.005em] transition-colors group-hover:text-accent sm:text-[21px]"
							>{rec.title}</span
						>
						<span class="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-muted">
							<span class="truncate">{rec.artist}</span>
							{#if rec.year || rec.genres.length}<span class="text-faint"
									>{[rec.year, rec.genres.join(', ')].filter(Boolean).join(' · ')}</span
								>{/if}
						</span>
					</span>
				</a>
				<!-- pl mirrors the grid template above (cover 44 + gap 12 / + number 56 +
					     two sm gaps) so the meta line starts under the title. -->
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-5 pl-14 pr-4 pt-1 sm:pl-44 sm:pr-6">
					<Badge tone={statusTone[rec.status]}>{STATUS_LABELS[rec.status]}</Badge>
					{@render starBadge(rec)}
					{#if rec.copies > 1}<span class="font-display text-[13px] italic text-faint">{rec.copies} copies</span>{/if}
					<span class="ml-auto flex items-center gap-2 sm:gap-3">
						{@render playControl(rec)}
						{@render acquireChip(rec)}
					</span>
				</div>
			</div>
		{/each}
	</div>
{:else if view === 'table'}
	<!-- TABLE — hairlines only, no box -->
	<div class="mt-6 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-edge text-left">
					{#each sortableColumns as [col, colLabel], ci (col)}
						<th class={`pb-3 pr-4 ${ci === 0 ? 'pl-3' : ''}`}>
							<button
								type="button"
								onclick={() => toggleSort(col)}
								class="text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint transition-colors hover:text-ink"
							>
								{colLabel}{sortIndicator(col)}
							</button>
						</th>
					{/each}
					<th class="pb-3 pr-4 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">Cond.</th>
					<th class="pb-3 pr-4 text-right text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">Price</th>
					<th class="pb-3 pr-1 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">Status</th>
					<th class="pb-3 pr-4 text-right text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint"> Plays </th>
					<th class="w-8 pr-3 pb-3" aria-hidden="true"></th>
				</tr>
			</thead>
			<tbody>
				{#each displayRecords as rec (rec.id)}
					<tr class="group border-b border-hair transition-colors hover:bg-surface">
						<td class="py-3 pl-3 pr-4">
							<a href="/records/{rec.id}" class="font-display text-[15px] transition-colors hover:text-accent"
								>{rec.title}</a
							>
							{#if rec.copies > 1}<span class="ml-1.5 font-display text-xs italic text-faint">×{rec.copies}</span>{/if}
						</td>
						<td class="py-3 pr-4 text-muted">{rec.artist}</td>
						<td class="py-3 pr-4 text-muted">{rec.year ?? ''}</td>
						<td class="py-3 pr-4 text-muted">{rec.genres.join(', ')}</td>
						<td class="py-3 pr-4 text-muted">{joinLabels(rec.labels)}</td>
						<td class="py-3 pr-4">
							{@render starBadge(rec)}
						</td>
						<td class="py-3 pr-4 font-mono text-xs text-faint">
							{[rec.condition_media && `M:${rec.condition_media}`, rec.condition_sleeve && `S:${rec.condition_sleeve}`]
								.filter(Boolean)
								.join(' ') || '—'}
						</td>
						<td class="py-3 pr-4 text-right font-mono text-xs text-muted">{fmtPrice(rec.price_paid)}</td>
						<td class="py-3 pr-4">
							<Badge tone={statusTone[rec.status]}>{STATUS_LABELS[rec.status]}</Badge>
							<div class="mt-1.5">{@render acquireChip(rec)}</div>
						</td>
						<!-- play log: quiet inline controls, always usable on touch -->
						<td class="py-3 pr-4">
							{@render playControl(rec)}
						</td>
						<!-- end-of-row slot: hover-reveal Discogs link, kept in its own gutter -->
						<td class="w-8 pr-3 py-3 text-right">{@render discogsMicroLink(rec)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<!-- CARDS — quiet cover tiles, no boxes -->
	<div class="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
		{#each displayRecords as rec, i (rec.id)}
			<div class="group" style="animation-delay: {Math.min(i * 30, 300)}ms">
				<a href="/records/{rec.id}" class="block" aria-label={`${rec.title} — ${rec.artist}`}>
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
					<!-- title → artist → year/genre → status: the badge gets its
					     own line so it never competes with the album name. -->
					<p class="mt-3.5 truncate font-display text-[17px] transition-colors group-hover:text-accent">
						{rec.title}
					</p>
					<p class="mt-0.5 truncate text-[13px] text-muted">{rec.artist}</p>
					{#if rec.year || rec.genres.length}
						<p class="mt-0.5 text-[11px] uppercase tracking-[.16em] text-faint">
							{[rec.year, rec.genres.join(', ')].filter(Boolean).join(' · ')}
						</p>
					{/if}
					<p class="mt-1.5 flex items-center gap-2.5">
						<Badge tone={statusTone[rec.status]}>{STATUS_LABELS[rec.status]}</Badge>
						{@render starBadge(rec)}
					</p>
				</a>
				<div class="mt-2 flex items-center justify-between gap-2">
					{@render acquireChip(rec)}
					{@render playControl(rec)}
				</div>
			</div>
		{/each}
	</div>
{/if}

<!-- Discogs matches — the supplementary half of the name lookup. Local results
     come first (the grid above); this quieter ledger sits below them and only
     appears while a lookup is in flight / has hits. -->
{#if !localOnly && (remoteBusy || remoteHits.length > 0 || remoteError)}
	<section class="mt-14 border-t border-hair pt-6" aria-label="Discogs matches">
		<div class="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h2 class="text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">
				{remoteBusy && remoteHits.length === 0
					? `Discogs — looking for “${qInput}”…`
					: `Also on Discogs${remoteQ ? ` — “${remoteQ}”` : ''}`}
			</h2>
			{#if !remoteBusy && remoteTotal > 0}
				<span class="text-[11px] font-display italic text-faint">
					{remoteHits.length} of {remoteTotal} shown
				</span>
			{/if}
			{#if addedFlash}
				<span class="text-[11px] font-display italic text-forest">{addedFlash}</span>
			{/if}
		</div>

		{#if remoteError}
			<p class="font-display text-[15px] italic text-rust">{remoteError}</p>
		{:else if remoteBusy && remoteHits.length === 0}
			<p class="py-2 font-display text-[15px] italic text-faint">Asking Discogs…</p>
		{:else if remoteHits.length === 0}
			<p class="py-2 font-display text-[15px] italic text-muted">
				No matches on Discogs for “{remoteQ}”.
			</p>
		{:else}
			<ul class="flex flex-col">
				{#each remoteHits as hit (hit.id)}
					{@const fmtLabel = hit.format?.filter((f) => f && !/^(album|mixed)$/i.test(f)).join(', ')}
					{@const labelStr = [hit.label?.[0], hit.catno].filter(Boolean).join(' ')}
					<li class="border-b border-hair">
						<div class="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 py-3">
							<span class="block h-12 w-12 sm:h-14 sm:w-14">
								<CoverImage src={hit.thumb ?? null} alt="" />
							</span>
							<div class="min-w-0">
								<a
									href={discogsReleaseUrl(hit.id)}
									{...DISCOGS_LINK_ATTRS}
									title="Open on Discogs"
									class="block truncate font-display text-[17px] transition-colors hover:text-accent"
								>
									{hit.title}
								</a>
								<div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
									{#if fmtLabel}<span
											class="inline-flex items-center rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium tracking-wide"
											>{fmtLabel}</span
										>{/if}
									{#if hit.year}<span>{hit.year}</span>{/if}
									{#if labelStr}<span class="text-faint">{labelStr}</span>{/if}
									{#if hit.country}<span class="text-faint">{hit.country}</span>{/if}
									{#if hit.community}
										<span class="text-faint">{hit.community.have ?? 0} have / {hit.community.want ?? 0} want</span>
									{/if}
								</div>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<Button type="button" variant="secondary" size="sm" onclick={() => void addRemote(hit, 'add')}>
									+ Add
								</Button>
								<!-- heart = the wishlist: the common case at the shelf —
								     you scan with the barcode, you *want* by name. -->
								<button
									type="button"
									disabled={saving !== null}
									onclick={() => void addRemote(hit, 'wish')}
									title="Add to the wishlist"
									aria-label={`Wish-list ${hit.title}`}
									class="inline-flex h-8 w-8 items-center justify-center border border-edge bg-transparent text-ink transition-colors hover:border-accent hover:text-plum disabled:pointer-events-none disabled:opacity-50"
								>
									{#if saving?.id === hit.id && saving.kind === 'wish'}
										<span class="text-[13px]">…</span>
									{:else}
										<svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
											<path
												fill="currentColor"
												d="M12 21s-7.5-4.7-10-9.3C.4 8.6 2.3 5 5.7 5c2 0 3.4 1.1 4.3 2.6h4C14.9 6.1 16.3 5 18.3 5c3.4 0 5.3 3.6 3.7 6.7C19.5 16.3 12 21 12 21z"
											/>
										</svg>
									{/if}
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<!-- Acquire dialog (F5): opened by the "→ acquired" chip on any wanted row.
     The form inside posts to ?/acquire with use:enhance; the home action
     returns a plain success (no redirect), so onSuccess closes it and
     revalidates — the row leaves the wishlist in place and the counts flip. -->
{#if acquireFor}
	<AcquireDialog
		open
		action="?/acquire"
		recordId={acquireFor.id}
		artist={acquireFor.artist}
		title={acquireFor.title}
		error={form?.error ?? null}
		onCancel={() => (acquireFor = null)}
		onSuccess={() => {
			acquireFor = null;
			void invalidateAll();
		}}
	/>
{/if}

<style>
	/* staggered rise-in for the catalogue rows (delay comes from the inline style attr) */
	.entry {
		animation: rise-in 0.4s ease both;
	}
</style>
