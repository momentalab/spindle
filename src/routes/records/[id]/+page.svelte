<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import AcquireDialog from '$lib/components/AcquireDialog.svelte';
	import RecordForm from '$lib/components/RecordForm.svelte';
	import ReleasePicker from '$lib/components/ReleasePicker.svelte';
	import TrendChart, { type TrendSeries } from '$lib/components/TrendChart.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import CoverImage from '$lib/components/ui/CoverImage.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { draftFromRow, emptyDraft } from '$lib/draft';
	import { appTitle } from '$lib/index';
	import { DISCOGS_LINK_ATTRS, discogsReleaseUrl } from '$lib/discogs';
	import { downscale, fmtSize } from '$lib/image';
	import { STATUS_LABELS, joinLabels, joinStyles } from '$lib/types';
	import type { PhotoRow, RecordDraft, ReleaseCredit, ReleaseVideo, SearchCandidate, TrackRow } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	let draft: RecordDraft = $state(emptyDraft());
	let editing = $state(false);
	// In-flight ?/edit POST — keeps the modal from being dismissed mid-save.
	let editSubmitting = $state(false);

	// After a successful save, server data is revalidated — resync the form from it.
	$effect(() => {
		const record = data.record; // reactive read
		if (record) draft = draftFromRow(record);
	});

	// Acquire dialog (F5): "Mark as acquired" opens this instead of flipping
	// immediately — the just-bought-it details (date, price, conditions) belong
	// in one place. The dialog's own form posts to ?/acquire with use:enhance;
	// the 303 then navigates back, the record flips out of "wanted" and the
	// dialog unmounts with the ?acquired=1 flash on the spec sheet.
	let acquireOpen = $state(false);

	// Re-identify: re-run the barcode lookup and re-pick the release (a wrong pick
	// at import time). Candidates come from /api/import — the same source as the
	// import flow; selecting one posts its discogs_id to ?/reidentify and the
	// server overwrites only the identity fields. The candidate list itself (with
	// lazy "Details" expansion and per-row commit state) lives in ReleasePicker.
	let reidOpen = $state(false);
	let reidLoading = $state(false);
	let reidError = $state<string | null>(null);
	let reidCandidates = $state<SearchCandidate[] | null>(null);

	async function openReidentify(): Promise<void> {
		if (reidOpen) {
			closeReidentify();
			return;
		}
		reidOpen = true;
		reidError = null;
		if (reidCandidates) return; // already loaded from a previous visit
		reidLoading = true;
		try {
			const r = data.record;
			const url = r.barcode
				? `/api/import?barcode=${r.barcode}`
				: `/api/import?q=${encodeURIComponent(`${r.artist} ${r.title}`)}`;
			const res = await fetch(url);
			const json = (await res.json().catch(() => null)) as {
				candidates?: SearchCandidate[];
				message?: string;
			} | null;
			if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
			reidCandidates = json.candidates ?? [];
		} catch (e) {
			reidError = e instanceof Error ? e.message : 'Discogs lookup failed.';
			reidCandidates = null;
		} finally {
			reidLoading = false;
		}
	}

	function closeReidentify(): void {
		reidOpen = false;
		reidCandidates = null;
		reidError = null;
	}

	// Cover override: replace the artwork without touching the record's identity.
	// (i) Pick the cover of ANY Discogs entry — the shared ReleasePicker posts the
	// chosen release id to ?/pick_cover, which borrows only its primary image.
	// (ii) Upload a local image — same pipeline as photographs (downscale, then
	// POST /api/records/<id>/cover); on success invalidateAll() refetches the row
	// and the ?cover_saved=1 flash fires.
	let coverOpen = $state(false);
	let coverLoading = $state(false);
	let coverError = $state<string | null>(null);
	let coverQuery = $state('');
	let coverCandidates = $state<SearchCandidate[] | null>(null);

	async function openCover(): Promise<void> {
		if (coverOpen) {
			closeCover();
			return;
		}
		coverOpen = true;
		coverError = null;
		if (!coverCandidates) coverQuery = `${data.record.artist} ${data.record.title}`.trim();
		await searchCover(coverQuery);
	}

	async function searchCover(q: string): Promise<void> {
		coverQuery = q;
		coverLoading = true;
		coverError = null;
		const query = q.trim();
		if (!query) {
			coverCandidates = [];
			coverLoading = false;
			return;
		}
		try {
			const res = await fetch(`/api/import?q=${encodeURIComponent(query)}`);
			const json = (await res.json().catch(() => null)) as {
				candidates?: SearchCandidate[];
				message?: string;
			} | null;
			if (!res.ok || !json) throw new Error(json?.message ?? `HTTP ${res.status}`);
			coverCandidates = json.candidates ?? [];
		} catch (e) {
			coverError = e instanceof Error ? e.message : 'Discogs search failed.';
			coverCandidates = null;
		} finally {
			coverLoading = false;
		}
	}

	function closeCover(): void {
		coverOpen = false;
		coverError = null;
	}

	async function onCoverPicked(): Promise<void> {
		await invalidateAll();
		closeCover();
	}

	async function onCoverFilePicked(e: Event): Promise<void> {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-picking the same file later
		if (!file) return;
		coverError = null;
		if (file.size > UPLOAD_MAX_BYTES) {
			coverError = `"${file.name}" is ${fmtSize(file.size)} — over the ${fmtSize(UPLOAD_MAX_BYTES)} limit.`;
			return;
		}
		coverLoading = true;
		try {
			const encoded = await downscale(file, 1600);
			const fd = new FormData();
			fd.append('file', encoded);
			const res = await fetch(`/api/records/${data.record.id}/cover`, {
				method: 'POST',
				body: fd
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				message?: string;
			} | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			closeCover();
			// goto (not invalidateAll) so the ?cover_saved=1 flash lands on the spec sheet,
			// matching the pick/restore paths. The navigation revalidates page data.
			await goto(`/records/${data.record.id}?cover_saved=1`, {
				replaceState: true
			});
		} catch (err) {
			coverError = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			coverLoading = false;
		}
	}

	// Missing-cover repair (F2): re-pull the artwork from Discogs when this record
	// only has a remote fallback (or a discogs_id to look one up). The ?/repair_cover
	// action handles the download; on success `update()` revalidates and the local
	// cover replaces the remote fallback.
	let repairingCover = $state(false);
	let repairError = $state<string | null>(null);
	// The photo API is fetch-based, so uploads/deletes update `photosOverride`
	// locally instead of revalidating page data. The server list stays the source
	// of truth until an API response overrides it (the edit action never touches
	// photos, so a stale override cannot desync from revalidation).
	let photosOverride = $state<PhotoRow[] | null>(null);
	const photos = $derived(photosOverride ?? data.photos);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	// Uploads are automatic: picking an image starts the POST immediately and the
	// in-flight `staging` tiles show a live preview, so there's never a moment
	// where it looks like nothing happened. The picker is a plain <label>
	// (no form) so there is nothing to submit — onchange just kicks off the fetch.
	let staging = $state<{ file: File; url: string }[]>([]);
	// Photos above this get a confirm dialog first, then an aggressive re-encode,
	// so a 48MP phone shot doesn't bloat storage. Must stay in sync with the
	// server cap (photos/+server.ts).
	const BIG_PHOTO_BYTES = 8 * 1024 * 1024;
	const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
	let bigFiles = $state<File[]>([]);
	const bigSingle = $derived(bigFiles.length === 1 ? bigFiles[0] : null);

	function onFilesPicked(e: Event): void {
		if (uploading) return;
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = ''; // allow re-picking the same file later
		if (files.length === 0 || files.length > 10) return;
		if (files.some((f) => f.size > BIG_PHOTO_BYTES)) {
			bigFiles = files;
			return;
		}
		void runUpload(files);
	}

	function previewUrl(f: File): string {
		try {
			return URL.createObjectURL(f);
		} catch {
			return '';
		}
	}

	async function runUpload(files: File[], targetBytes?: number): Promise<void> {
		uploading = true;
		uploadError = null;
		staging = files.map((file) => ({ file, url: previewUrl(file) }));
		try {
			const fd = new FormData();
			for (const f of files) {
				const encoded = await downscale(f, 1600, targetBytes);
				if (encoded.size > UPLOAD_MAX_BYTES)
					throw new Error(
						`"${f.name}" is still ${fmtSize(encoded.size)} after compression (limit ${fmtSize(UPLOAD_MAX_BYTES)})`
					);
				fd.append('files', encoded);
			}
			const res = await fetch(`/api/records/${data.record.id}/photos`, {
				method: 'POST',
				body: fd
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				photos?: PhotoRow[];
				message?: string;
			} | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			photosOverride = json.photos ?? photos;
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			staging.forEach((s) => URL.revokeObjectURL(s.url));
			staging = [];
			uploading = false;
		}
	}

	async function confirmBigUpload(): Promise<void> {
		const files = bigFiles;
		bigFiles = [];
		await runUpload(files, BIG_PHOTO_BYTES);
	}

	function cancelBigUpload(): void {
		bigFiles = [];
	}

	async function removePhoto(photoId: number): Promise<void> {
		if (!confirm('Delete this photo?')) return;
		const res = await fetch(`/api/records/${data.record.id}/photos?photoId=${photoId}`, { method: 'DELETE' });
		const json = (await res.json()) as { ok?: boolean; photos?: PhotoRow[] };
		if (res.ok) {
			photosOverride = json.photos ?? photos.filter((p) => p.id !== photoId);
		}
	}

	// Play log: one row per spin. Same override pattern as photos — the API is
	// fetch-based, so taps update local state optimistically and reconcile from
	// the server's authoritative count; a failed request reverts.
	let playCountOverride = $state<number | null>(null);
	let lastPlayedAtOverride = $state<string | null | undefined>(undefined);
	const playCount = $derived(playCountOverride ?? data.play_count);
	const lastPlayedAt = $derived(lastPlayedAtOverride === undefined ? data.last_played_at : lastPlayedAtOverride);
	let loggingPlay = $state(false);
	let undoingPlay = $state(false);

	const PLAY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

	/**
	 * Build a Date from 'YYYY-MM-DD' or a full ISO string by parsing the date
	 * parts manually — `new Date('2026-08-30')` is UTC midnight and shifts a
	 * day in western timezones. The value comes back as a local-midnight Date.
	 */
	function parseYmd(v: string): Date | null {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
		if (!m) return null;
		const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
		return Number.isNaN(d.getTime()) ? null : d;
	}

	/** Deterministic 'Aug 30, 2026' — no toLocaleDateString (SSR/locale drift). */
	function fmtPlayDate(iso: string | null): string {
		if (!iso) return '';
		const d = parseYmd(iso);
		if (!d) return '';
		return `${PLAY_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
	}

	/** Whole days between an ISO date and the start of today: "today", "yesterday" or "N days ago". */
	function relDays(iso: string): string {
		const d = parseYmd(iso);
		if (!d) return '';
		const today = new Date();
		const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
		const days = Math.round((startOfDay(today) - startOfDay(d)) / 86400000);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		return `${days} days ago`;
	}

	async function logPlay(): Promise<void> {
		loggingPlay = true;
		const prevCount = playCountOverride;
		const prevLast = lastPlayedAtOverride;
		playCountOverride = playCount + 1;
		lastPlayedAtOverride = new Date().toISOString();
		try {
			const res = await fetch(`/api/records/${data.record.id}/plays`, {
				method: 'POST'
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				play_count: number;
				last_played_at: string | null;
				message?: string;
			} | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			playCountOverride = json.play_count;
			lastPlayedAtOverride = json.last_played_at;
		} catch {
			playCountOverride = prevCount;
			lastPlayedAtOverride = prevLast;
		} finally {
			loggingPlay = false;
		}
	}

	async function undoPlay(): Promise<void> {
		undoingPlay = true;
		const prevCount = playCountOverride;
		const prevLast = lastPlayedAtOverride;
		playCountOverride = Math.max(0, playCount - 1);
		try {
			const res = await fetch(`/api/records/${data.record.id}/plays`, {
				method: 'DELETE'
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				play_count: number;
				last_played_at: string | null;
				message?: string;
			} | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			playCountOverride = json.play_count;
			lastPlayedAtOverride = json.last_played_at;
		} catch {
			playCountOverride = prevCount;
			lastPlayedAtOverride = prevLast;
		} finally {
			undoingPlay = false;
		}
	}

	function coverSrc(): string | null {
		if (data.record.cover_filename) return `/media/${data.record.cover_filename}`;
		return data.record.cover_remote_url;
	}

	function fmtPrice(cents: number | null): string {
		return cents === null ? '' : `$${(cents / 100).toFixed(2)}`;
	}

	// Key-based (has, not get): the redirect params carry values (?acquired=1),
	// so comparing against the key name is what makes these banners fire.
	const flash = $derived.by(() => {
		const sp = page.url.searchParams;
		if (sp.has('imported')) return 'imported';
		if (sp.has('added_copy')) return 'added_copy';
		if (sp.has('removed_copy')) return 'removed_copy';
		if (sp.has('renamed_copy')) return 'renamed_copy';
		if (sp.has('cover_saved')) return 'cover_saved';
		if (sp.has('acquired')) return 'acquired';
		if (sp.has('reidentified')) return 'reidentified';
		if (sp.has('tracks_loaded')) return 'tracks_loaded';
		if (sp.has('details_refreshed')) return 'details_refreshed';
		return null;
	});

	/* -------------------------------------------------------------- */
	/* The tracklist: stars, inline edit, manual add.                 */
	/* Every API response carries the full authoritative list, so the */
	/* client just swaps it in — no partial state surgery.            */
	/* -------------------------------------------------------------- */

	let tracksOverride = $state<TrackRow[] | null>(null);
	const tracks = $derived(tracksOverride ?? data.tracks);
	const favCount = $derived(tracks.filter((t) => t.favorite === 1).length);
	let tracksError = $state<string | null>(null);
	let loadingTracks = $state(false); // ?/load_tracks in flight

	// Deep link /records/<id>?track=<trackId> (from the /stats starred list):
	// gold-tint that row and scroll it into view.
	const trackHighlight = $derived(page.url.searchParams.get('track'));
	$effect(() => {
		if (trackHighlight === null) return;
		if (!tracks.some((t) => String(t.id) === trackHighlight)) return;
		void (async () => {
			await new Promise((r) => requestAnimationFrame(r)); // let the row paint first
			document.getElementById(`track-${trackHighlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		})();
	});

	// Inline edit: one row at a time; three compact fields, save posts a PATCH.
	let editingTrackId = $state<number | null>(null);
	let editPos = $state('');
	let editTitle = $state('');
	let editDur = $state('');
	let editSaving = $state(false);
	let editError = $state<string | null>(null);

	function startEditTrack(t: TrackRow): void {
		editingTrackId = t.id;
		editPos = t.position ?? '';
		editTitle = t.title;
		editDur = t.duration ?? '';
		editError = null;
	}

	function cancelEditTrack(): void {
		editingTrackId = null;
		editError = null;
	}

	async function saveEditTrack(): Promise<void> {
		if (editingTrackId === null) return;
		const trackId = editingTrackId;
		editSaving = true;
		editError = null;
		try {
			const res = await fetch(`/api/records/${data.record.id}/tracks/${trackId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					position: editPos,
					title: editTitle,
					duration: editDur
				})
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				tracks?: TrackRow[];
				message?: string;
			} | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			tracksOverride = json.tracks ?? tracks;
			cancelEditTrack();
		} catch (err) {
			editError = err instanceof Error ? err.message : 'Could not save the track.';
		} finally {
			editSaving = false;
		}
	}

	// Inline copy rename: one row at a time; save posts the rename_copy action,
	// so an unlabeled copy can be given its identity after the fact.
	let editingCopyId = $state<number | null>(null);
	let editCopyLabel = $state('');

	function startEditCopy(c: { id: number; label: string | null }): void {
		editingCopyId = c.id;
		editCopyLabel = c.label ?? '';
	}

	function cancelEditCopy(): void {
		editingCopyId = null;
	}

	async function removeTrack(t: TrackRow): Promise<void> {
		if (!confirm(`Delete "${t.title}" from the tracklist?`)) return;
		const res = await fetch(`/api/records/${data.record.id}/tracks/${t.id}`, {
			method: 'DELETE'
		});
		const json = (await res.json().catch(() => null)) as {
			ok?: boolean;
			tracks?: TrackRow[];
		} | null;
		if (res.ok && json?.ok) tracksOverride = json.tracks ?? tracks;
	}

	// Manual add row (works with or without a Discogs link).
	let addOpen = $state(false);
	let addPos = $state('');
	let addTitle = $state('');
	let addDur = $state('');
	let addSaving = $state(false);
	let addError = $state<string | null>(null);

	function openAddTrack(): void {
		addOpen = true;
		addPos = '';
		addTitle = '';
		addDur = '';
		addError = null;
	}

	async function submitAddTrack(): Promise<void> {
		if (!addTitle.trim()) {
			addError = 'Give the track a title.';
			return;
		}
		addSaving = true;
		addError = null;
		try {
			const res = await fetch(`/api/records/${data.record.id}/tracks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					position: addPos,
					title: addTitle,
					duration: addDur
				})
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				tracks?: TrackRow[];
				message?: string;
			} | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			tracksOverride = json.tracks ?? tracks;
			addOpen = false;
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Could not add the track.';
		} finally {
			addSaving = false;
		}
	}

	// Star toggle: optimistic flip, reconcile from the response, revert on failure.
	const favToggling = $state<Set<number>>(new Set());
	async function toggleFavorite(t: TrackRow): Promise<void> {
		if (favToggling.has(t.id)) return;
		favToggling.add(t.id);
		const prev = tracksOverride ? [...tracksOverride] : null;
		const nextFav: 0 | 1 = t.favorite === 1 ? 0 : 1;
		tracksOverride = tracks.map((x) => (x.id === t.id ? { ...x, favorite: nextFav } : x));
		try {
			const res = await fetch(`/api/records/${data.record.id}/tracks/${t.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ favorite: nextFav === 1 })
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				tracks?: TrackRow[];
				message?: string;
			} | null;
			if (!res.ok || !json?.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
			tracksOverride = json.tracks ?? tracks;
		} catch {
			tracksOverride = prev; // null → fall back to the server list on revalidation
		} finally {
			favToggling.delete(t.id);
		}
	}

	/* -------------------------------------------------------------- */
	/* "From Discogs": the cached snapshot + refresh.                 */
	/* -------------------------------------------------------------- */
	let refreshingDetails = $state(false);
	let detailsError = $state<string | null>(null);

	const communityLine = $derived.by(() => {
		const s = data.snapshot;
		if (!s) return '';
		const bits: string[] = [];
		if (s.community.rating_avg !== null && s.community.rating_count !== null)
			bits.push(`${s.community.rating_avg} ★ from ${s.community.rating_count} ratings`);
		if (s.community.have !== null) bits.push(`${s.community.have} have it`);
		if (s.community.want !== null) bits.push(`${s.community.want} want it`);
		return bits.join(' · ');
	});

	// Discogs returns some releases' lists with whole entries duplicated (videos
	// and credits both). Svelte throws on duplicate keys in a keyed each during
	// client render, so dedupe here (render side; toSnapshot() does the same at
	// write time). Null byte as field separator: can't appear in API strings.
	const creditKey = (c: ReleaseCredit) => `${c.name}\u0000${c.role}\u0000${c.kind}`;
	const snapshotVideos = $derived.by((): ReleaseVideo[] => {
		const s = data.snapshot;
		if (!s) return [];
		const seen = new Set<string>();
		const out: ReleaseVideo[] = [];
		for (const v of s.videos) {
			if (seen.has(v.url)) continue;
			seen.add(v.url);
			out.push(v);
		}
		return out;
	});
	const snapshotCredits = $derived.by((): ReleaseCredit[] => {
		const s = data.snapshot;
		if (!s) return [];
		const seen = new Set<string>();
		const out: ReleaseCredit[] = [];
		for (const c of s.credits) {
			const key = creditKey(c);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(c);
		}
		return out;
	});

	const statusTone: Record<string, 'forest' | 'plum' | 'butter' | 'muted'> = {
		in_collection: 'forest',
		sold: 'butter',
		traded_away: 'muted',
		wanted: 'plum'
	};

	/** Numbered pressing — `828 / 1000`, or `#828` when only the number exists. */
	const copyDisplay = $derived.by(() => {
		const n = data.record.copy_number;
		const t = data.record.copy_total;
		if (n === null && t === null) return '';
		if (n !== null && t !== null) return `${n} / ${t}`;
		if (n !== null) return `#${n}`;
		return `/ ${t}`;
	});

	// Flat label/value pairs for the spec sheet (nulls skipped).
	const meta = $derived(
		(
			[
				[
					'Plays',
					playCount > 0
						? [
								`${playCount} · spun ${fmtPlayDate(lastPlayedAt)}`,
								data.minutes_played > 0 ? `≈ ${data.minutes_played} min` : null
							]
								.filter(Boolean)
								.join(' · ')
						: '—'
				],
				['Year', data.record.year ?? ''],
				['Genre', [data.record.genres.join(', '), joinStyles(data.record.styles)].filter(Boolean).join(' — ')],
				['Label', joinLabels(data.record.labels)],
				['Format', data.record.format ?? ''],
				['Barcode', data.record.barcode ?? ''],
				[
					'Condition',
					[
						data.record.condition_media && `media ${data.record.condition_media}`,
						data.record.condition_sleeve && `sleeve ${data.record.condition_sleeve}`
					]
						.filter(Boolean)
						.join(' · ')
				],
				['Price paid', fmtPrice(data.record.price_paid)],
				// F7 pre-stage — shown when a sale is recorded; the portfolio view (F7)
				// is what gives these columns their user-facing meaning.
				['Sold', data.record.sold_at ? `${relDays(data.record.sold_at)} · ${fmtPlayDate(data.record.sold_at)}` : ''],
				['Sale price', fmtPrice(data.record.sale_price)],
				[
					'Acquired',
					data.record.acquired_at ? `${relDays(data.record.acquired_at)} · ${fmtPlayDate(data.record.acquired_at)}` : ''
				],
				['Source', data.record.source ?? ''],
				[
					'Wanted since',
					data.record.wanted_at ? `${relDays(data.record.wanted_at)} · ${fmtPlayDate(data.record.wanted_at)}` : ''
				],
				['Copy', copyDisplay]
			] as [string, string][]
		).filter(([, v]) => v !== '')
	);

	/* ---- market value — the record's Discogs trendline + position ---- */
	const mk = $derived(data.market);
	const mkSeries = $derived<TrendSeries[]>([
		{
			id: 'price',
			label: 'Market price',
			color: 'var(--accent)',
			points: mk.priced_points
				.map((p) => {
					const d = parseYmd(p.at);
					return d ? { x: d.getTime(), y: p.price_cents } : null;
				})
				.filter((p): p is { x: number; y: number } => p !== null)
		}
	]);
	/** Compact money for the trendline's y-axis: $8.50 stays, $1,240 → $1.2k. */
	function mkTick(cents: number): string {
		const d = cents / 100;
		if (d >= 10_000) return `$${(d / 1000).toFixed(1).replace(/\.0$/, '')}k`;
		if (d >= 1000) return `$${(d / 1000).toFixed(2).replace(/\.?0+$/, '')}k`;
		return `$${d.toFixed(d < 10 ? 2 : 0)}`;
	}
	function mkPctLabel(pct: number | null): string {
		if (pct === null) return '—';
		return `${pct < 0 ? '-' : '+'}${Math.abs(pct).toFixed(1)}%`;
	}
	/** Latest quote vs. what was paid, per copy (the record's own P&L line). */
	const mkPosition = $derived.by(() => {
		const paid = data.record.price_paid;
		const last = mk.last_priced;
		if (paid === null || !last || last.price_cents === null) return null;
		return last.price_cents - paid;
	});
</script>

<svelte:head><title>{appTitle(`${data.record.artist} · ${data.record.title}`)}</title></svelte:head>

<a href="/" class="text-[11.5px] uppercase tracking-[.2em] text-faint transition-colors hover:text-ink">
	← Return to the index
</a>

{#if flash === 'imported'}
	<div class="mt-6"><Banner variant="success">Record saved.</Banner></div>
{:else if flash === 'added_copy'}
	<div class="mt-6"><Banner variant="success">Added another copy.</Banner></div>
{:else if flash === 'removed_copy'}
	<div class="mt-6"><Banner variant="success">Removed a copy.</Banner></div>
{:else if flash === 'renamed_copy'}
	<div class="mt-6"><Banner variant="success">Renamed the copy.</Banner></div>
{:else if flash === 'acquired'}
	<div class="mt-6"><Banner variant="success">On the shelf.</Banner></div>
{:else if flash === 'cover_saved'}
	<div class="mt-6">
		<Banner variant="success">Cover saved.</Banner>
	</div>
{:else if flash === 'reidentified'}
	<div class="mt-6"><Banner variant="success">Re-identified.</Banner></div>
{:else if flash === 'tracks_loaded'}
	<div class="mt-6">
		<Banner variant="success">Tracklist loaded from Discogs.</Banner>
	</div>
{:else if flash === 'details_refreshed'}
	<div class="mt-6"><Banner variant="success">Details refreshed.</Banner></div>
{/if}

<!-- detail — a full catalogue spread. The cover track is capped at 100%
     (and the wrapper gets min-w-0) so its w-full child can never inflate the
     column past the viewport on fresh records. -->
<div class="mt-8 grid gap-14 lg:grid-cols-[minmax(300px,min(420px,100%))_minmax(0,1fr)]">
	<div class="min-w-0">
		<div class="w-full max-w-full">
			<CoverImage
				src={coverSrc()}
				alt={`Cover — ${data.record.artist}, ${data.record.title}`}
				class="aspect-square w-full"
				loading="eager"
			/>
		</div>
		<p class="mt-3.5 font-display text-[13.5px] italic text-faint">
			{#if data.record.cover_remote_url && !data.record.cover_filename}
				Cover is remote — not yet saved.
			{:else if !data.record.cover_filename}
				No cover on file.
			{:else if !data.record.cover_remote_url}
				Manual cover.
			{:else}
				Front cover.
			{/if}
		</p>
		{#if !data.record.cover_filename && (data.record.cover_remote_url || data.record.discogs_id)}
			<div class="mt-4 flex flex-col gap-3">
				{#if repairError}
					<Banner variant="error">{repairError}</Banner>
				{/if}
				<form
					method="POST"
					action="?/repair_cover"
					class="inline-flex"
					use:enhance={() =>
						async ({ result, update }) => {
							repairingCover = true;
							repairError = null;
							if (result && 'type' in result && result.type === 'failure') {
								repairError = (result.data as { error?: string } | undefined)?.error ?? 'Cover download failed.';
							} else {
								await update(); // revalidates: stored cover replaces the fallback
							}
							repairingCover = false;
						}}
				>
					<Button type="submit" variant="secondary" size="sm" disabled={repairingCover}>
						{repairingCover ? 'Recovering…' : 'Download cover'}
					</Button>
				</form>
			</div>
		{/if}

		<div class="mt-5 flex flex-wrap items-center gap-2.5">
			{#if data.record.limited_edition}<Badge tone="plum">Limited edition</Badge>{/if}
			{#if data.record.copies > 1}<span class="font-display text-[13px] italic text-faint"
					>{data.record.copies} copies</span
				>{/if}
		</div>
	</div>

	<div class="min-w-0">
		<h1 class="break-words font-display text-5xl font-normal leading-[1.02] tracking-[-.01em] sm:text-[56px]">
			{data.record.title}
		</h1>
		{#if data.record.artist}<h2 class="mt-2.5 font-display text-2xl font-normal italic text-muted">
				{data.record.artist}
			</h2>{/if}

		<div class="my-7 h-px w-14 bg-accent"></div>

		<dl class="flex flex-col">
			{#each meta as [k, v] (k)}
				<div
					class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 border-b border-hair py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-6"
				>
					<dt class="pt-0.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
						{k}
					</dt>
					<dd
						class={`break-words text-[15px] ${['Format', 'Barcode', 'Acquired', 'Source'].includes(k) ? 'text-muted' : ''}`}
					>
						{v}
					</dd>
				</div>
			{/each}
			<div
				class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 border-b border-hair py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-6"
			>
				<dt class="pt-0.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">Status</dt>
				<dd
					class={`text-[15px] font-normal ${data.record.status === 'wanted' ? 'text-plum' : data.record.status === 'in_collection' ? 'text-accent' : 'text-muted'}`}
				>
					{STATUS_LABELS[data.record.status]}
				</dd>
			</div>
		</dl>

		{#if data.record.notes}
			<div class="mt-7 border-l-2 border-l-edge bg-surface px-5 py-4">
				<p class="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">Notes</p>
				<p class="whitespace-pre-wrap font-display text-[15px] italic leading-relaxed text-muted">
					{data.record.notes}
				</p>
			</div>
		{/if}

		<!-- Row 1 — the day-to-day: log (or acquire), undo, edit, delete. -->
		<div class="mt-9 flex flex-wrap items-center gap-4">
			{#if data.record.status === 'wanted'}
				<!-- (F5): the primary action for a want. Opens the acquire dialog —
				     date (default today), price and conditions land with it; the
				     ?/acquire form lives inside the dialog, enhance keeps the
				     page in place and the 303 lands the "On the shelf." flash. -->
				<Button variant="primary" onclick={() => (acquireOpen = true)}>Mark as acquired</Button>
			{:else}
				<Button variant="primary" disabled={loggingPlay} onclick={() => void logPlay()}>
					{loggingPlay ? 'Logging…' : 'Log a play'}
				</Button>
			{/if}
			{#if playCount > 0}
				<Button variant="ghost" size="sm" disabled={undoingPlay} onclick={() => void undoPlay()}>Undo last</Button>
			{/if}
			<Button
				variant="secondary"
				onclick={() => {
					editing = !editing;
					if (!editing) draft = draftFromRow(data.record); // discard unsaved changes
				}}
			>
				{editing ? 'Cancel editing' : 'Edit record'}
			</Button>
			<!-- inline-flex, not inline: a display:inline wrapper form ignores margins and
			     collapses its height, which is what made rows of buttons stack with no
			     vertical spacing. -->
			<form
				method="POST"
				action="?/delete"
				class="inline-flex"
				onsubmit={(e) => {
					if (!confirm('Delete this record? Its photos will be removed too.')) e.preventDefault();
				}}
			>
				<Button type="submit" variant="danger">Delete record</Button>
			</form>
		</div>

		<!-- Row 2 — release identity: cover + re-identification. -->
		<div class="mt-4 flex flex-wrap items-center gap-4">
			<Button variant="ghost" size="sm" onclick={() => void openCover()}>
				{coverOpen ? 'Close cover options' : 'Change cover'}
			</Button>
			<Button variant="ghost" size="sm" onclick={() => void openReidentify()}>Re-identify</Button>
		</div>

		{#if data.record.discogs_id}
			{@const discogsUrl = discogsReleaseUrl(data.record.discogs_id)}
			{#if discogsUrl}
				<div class="mt-5">
					<a
						href={discogsUrl}
						{...DISCOGS_LINK_ATTRS}
						class="text-[11.5px] uppercase tracking-[.2em] text-faint underline underline-offset-4 transition-colors hover:text-accent"
					>
						View on Discogs ↗
					</a>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- market value — the record's own trendline (Discogs observations) + position.
	     Rendered only when a release is linked: without one there is no market. -->
{#if data.record.discogs_id}
	<section class="mt-16 border-t border-edge pt-10">
		<div class="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
			<h3 class="text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">Market value</h3>
			{#if mk.latest}
				<p class="font-display text-[13px] italic text-faint">
					last observed {fmtPlayDate(mk.latest.at)}
					{#if mk.latest.condition_media}· {mk.latest.condition_media}{/if}
					{#if mk.latest.num_for_sale !== null}· {mk.latest.num_for_sale} for sale{/if}
				</p>
			{/if}
		</div>

		{#if mk.priced_points.length > 0}
			<div class="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
				<div>
					<div class="font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px]">
						{fmtPrice(mk.last_priced?.price_cents ?? null)}
					</div>
					<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">latest quote</div>
				</div>
				<div>
					<div class="font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px]">
						{fmtPrice(mk.first_priced?.price_cents ?? null)}
					</div>
					<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">
						first observed{mk.first_priced ? ` · ${relDays(mk.first_priced.at)}` : ''}
					</div>
				</div>
				<div>
					<div
						class={`font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px] ${
							mk.change_pct === null ? '' : mk.change_pct >= 0 ? 'text-forest' : 'text-rust'
						}`}
					>
						{mkPctLabel(mk.change_pct)}
					</div>
					<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">
						since first observed
					</div>
				</div>
				<div>
					<div
						class={`font-display text-[21px] leading-none tracking-[-.01em] sm:text-[23px] ${
							mkPosition === null ? '' : mkPosition >= 0 ? 'text-forest' : 'text-rust'
						}`}
					>
						{#if mkPosition === null}
							—
						{:else}
							{mkPosition < 0 ? '-' : '+'}{fmtPrice(Math.abs(mkPosition))}
						{/if}
					</div>
					<div class="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">
						{data.record.price_paid === null ? 'price not recorded' : 'vs. what you paid'}
					</div>
				</div>
			</div>

			<TrendChart
				series={mkSeries}
				height={240}
				formatValue={(v) => fmtPrice(v) || '—'}
				formatTick={mkTick}
				formatTipDate={(ms) => {
					const d = new Date(ms);
					return `${PLAY_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
				}}
				ariaLabel="Market price over time"
			/>

			<p class="mt-3 text-[10.5px] font-semibold uppercase tracking-[.2em] text-faint">
				Discogs marketplace — one observation per snapshot
			</p>
		{:else}
			<p class="font-display text-[14.5px] italic leading-relaxed text-muted">
				No market observations yet — <a
					href="/value"
					class="text-muted underline underline-offset-4 transition-colors hover:text-accent">take a snapshot</a
				>
				and the trendline starts here.
			</p>
		{/if}
	</section>
{/if}

<!-- photos first — a user field, so it leads with your record before the
    Discogs-derived sections below it -->
<section class="mt-16 border-t border-edge pt-10">
	<h3 class="mb-5 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">
		Photographs — {photos.length}
	</h3>

	<!-- in-flight previews — the auto-upload shows its photos while they go up -->
	{#if staging.length > 0}
		<div class="mb-5 flex flex-wrap items-center gap-3">
			<!-- key by index: blob URLs can be reused and same-named files would collide -->
			{#each staging as s, i (i + `-${s.file.name}`)}
				{#if s.url}
					<img
						src={s.url}
						alt=""
						class="aspect-square w-[72px] animate-pulse rounded-xs border border-hair object-cover opacity-60"
					/>
				{:else}
					<div
						class="flex aspect-square w-[72px] items-center justify-center rounded-xs border border-dashed border-edge text-faint"
						aria-hidden="true"
					>
						?
					</div>
				{/if}
			{/each}
			<span class="text-[10px] font-semibold uppercase tracking-[.2em] text-faint"
				>Uploading {staging.length === 1 ? 'photo' : `${staging.length} photos`}…</span
			>
		</div>
	{/if}

	<!-- the picker is a bare square label in both branches, so it lines up with the
	     thumbnail row; uploads start on pick, there is no submit step. -->
	{#if photos.length > 0 || staging.length > 0}
		<!-- items-start: default stretch would elongate the square picker to match
		     a captioned thumbnail in the same row. -->
		<div class="flex flex-wrap items-start gap-4">
			{#each photos as p (p.id)}
				<figure class="group relative w-[180px]">
					<!-- v= created_at: busts the image cache when two uploads re-encode to
					     byte-identical JPEGs — without it the browser can serve the first
					     photo for the second filename, looking like a replacement. -->
					<img
						src="/media/{p.filename}?v={p.created_at ?? p.id}"
						alt={p.caption ?? 'Record photograph'}
						loading="lazy"
						class="aspect-square w-full rounded-xs border border-hair object-cover"
					/>
					{#if p.caption}<figcaption class="mt-2 font-display text-[12.5px] italic text-faint">
							{p.caption}
						</figcaption>{/if}
					<button
						aria-label="Delete photo"
						class="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full border border-edge bg-paper text-[10px] text-muted transition-colors hover:border-rust hover:text-rust group-hover:flex"
						onclick={() => void removePhoto(p.id)}>✕</button
					>
				</figure>
			{/each}

			<label
				class={`group block w-[180px] shrink-0 cursor-pointer overflow-hidden rounded-xs border border-dashed border-edge transition-colors hover:border-accent ${uploading ? 'pointer-events-none opacity-50' : ''}`}
			>
				<span
					class="flex aspect-square w-full flex-col items-center justify-center gap-2 px-4 text-center text-faint transition-colors group-hover:text-accent"
				>
					<span class="text-xl leading-none" aria-hidden="true">+</span>
					<span class="text-[10px] font-semibold uppercase tracking-[.2em]">Add photographs</span>
				</span>
				<input type="file" multiple accept="image/*" onchange={onFilesPicked} class="hidden" />
			</label>
		</div>
	{:else}
		<div class="flex flex-wrap items-start gap-5">
			<label
				class={`group block w-[180px] shrink-0 cursor-pointer overflow-hidden rounded-xs border border-dashed border-edge transition-colors hover:border-accent ${uploading ? 'pointer-events-none opacity-50' : ''}`}
			>
				<span
					class="flex aspect-square w-full flex-col items-center justify-center gap-2 px-4 text-center text-faint transition-colors group-hover:text-accent"
				>
					<span class="text-xl leading-none" aria-hidden="true">+</span>
					<span class="text-[10px] font-semibold uppercase tracking-[.2em]">Add photographs</span>
				</span>
				<input type="file" multiple accept="image/*" onchange={onFilesPicked} class="hidden" />
			</label>
			<p class="max-w-xs font-display text-[13.5px] italic text-faint">
				No photographs yet — add images of your physical record.
			</p>
		</div>
	{/if}

	{#if uploadError}<p class="mt-4 text-sm text-rust">{uploadError}</p>{/if}
</section>

<!-- the tracks: the songs, and which ones you keep coming back to -->
<section class="mt-16 border-t border-edge pt-10">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h3 class="font-display text-3xl font-normal">Tracks</h3>
			<p class="mt-2 font-display text-[13.5px] italic text-faint">
				{#if tracks.length > 0}
					{tracks.length}
					{tracks.length === 1 ? 'track' : 'tracks'}
					{#if favCount > 0}
						· {favCount} starred
					{/if}
				{:else}
					no tracklist on file yet
				{/if}
			</p>
		</div>
	</div>

	{#if tracks.length > 0}
		<div class="mt-6">
			{#each tracks as t (t.id)}
				{@const highlighted = String(t.id) === trackHighlight}
				<div
					id={`track-${t.id}`}
					class={`group grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-hair py-2.5 transition-colors sm:grid-cols-[3rem_minmax(0,1fr)_4rem_auto] ${highlighted ? 'bg-plum-soft' : ''}`}
				>
					<span
						class={`text-right text-[11px] uppercase tracking-[.18em] text-faint ${editingTrackId === t.id ? 'hidden' : ''}`}
					>
						{t.position ?? String(tracks.indexOf(t) + 1)}
					</span>

					{#if editingTrackId === t.id}
						<!-- inline edit — the three fields take the row's full width; save/cancel
						     sit right-aligned below so nothing squishes at any width -->
						<div class="col-span-full col-start-1 row-start-1 flex flex-col gap-2">
							<div class="flex items-center gap-2">
								<input
									class="w-14 border-b border-edge bg-transparent px-1 py-0.5 text-[13px] outline-none focus:border-accent"
									bind:value={editPos}
									placeholder="A1"
									aria-label="Track position"
								/>
								<input
									class="min-w-0 flex-1 border-b border-edge bg-transparent px-1 py-0.5 text-[14px] outline-none focus:border-accent"
									bind:value={editTitle}
									aria-label="Track title"
								/>
								<input
									class="w-14 border-b border-edge bg-transparent px-1 py-0.5 text-right text-[13px] outline-none focus:border-accent"
									bind:value={editDur}
									placeholder="3:32"
									aria-label="Track duration"
								/>
							</div>
							<div class="flex items-center justify-end gap-2">
								{#if editError}<p class="mr-auto text-sm text-rust">{editError}</p>{/if}
								<Button variant="secondary" size="sm" disabled={editSaving} onclick={() => void saveEditTrack()}>
									{editSaving ? 'Saving…' : 'Save'}
								</Button>
								<Button variant="ghost" size="sm" disabled={editSaving} onclick={cancelEditTrack}>Cancel</Button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							class="truncate text-left font-display text-[15px] transition-colors hover:underline"
							title={t.title}
							onclick={() => startEditTrack(t)}
						>
							{t.title}
						</button>
					{/if}

					<span class={`hidden text-right text-[13px] italic text-faint ${editingTrackId === t.id ? '' : 'sm:block'}`}>
						{t.duration ?? ''}
					</span>

					<div class={`flex items-center gap-1.5 ${editingTrackId === t.id ? 'hidden' : ''}`}>
						<button
							type="button"
							class={`flex h-7 w-7 items-center justify-center transition-colors ${t.favorite === 1 ? 'text-accent' : 'text-faint hover:text-accent'}`}
							aria-label={t.favorite === 1 ? `Unfavorite "${t.title}"` : `Favorite "${t.title}"`}
							disabled={favToggling.has(t.id)}
							onclick={() => void toggleFavorite(t)}
						>
							<svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true">
								<path
									d="M8 1.8l1.9 3.9 4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6z"
									fill={t.favorite === 1 ? 'currentColor' : 'none'}
									stroke="currentColor"
									stroke-width="1.1"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
						<button
							type="button"
							class="flex h-7 w-7 items-center justify-center text-faint opacity-0 transition-opacity hover:text-rust focus:opacity-100 group-hover:opacity-100"
							aria-label={`Delete "${t.title}" from the tracklist`}
							onclick={() => void removeTrack(t)}
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
				</div>
			{/each}
		</div>
	{:else if data.record.discogs_id}
		<!-- recovery surface: the list is empty (import-time Discogs failure, or it
		     never had one) — offer the re-pull. Hidden once any track exists. -->
		<div class="mt-6 flex flex-wrap items-center gap-4">
			<form
				method="POST"
				action="?/load_tracks"
				class="inline-flex"
				use:enhance={() =>
					async ({ result, update }) => {
						loadingTracks = true;
						tracksError = null;
						if (result && 'type' in result && result.type === 'failure') {
							tracksError = (result.data as { error?: string } | undefined)?.error ?? 'Could not load the tracklist.';
						} else {
							await update();
						}
						loadingTracks = false;
					}}
			>
				<Button type="submit" variant="secondary" size="sm" disabled={loadingTracks}>
					{loadingTracks ? 'Loading from Discogs…' : 'Load tracklist from Discogs'}
				</Button>
			</form>
			{#if tracksError}<p class="text-sm text-rust">{tracksError}</p>{/if}
		</div>
	{/if}

	<!-- manual add — always available (a record without a Discogs link lives here) -->
	<div class="mt-4">
		<Button variant="ghost" size="sm" onclick={openAddTrack}>+ Add a track</Button>
	</div>
</section>

<!-- Copies: each physical copy of this release, tracked individually —
	     add one with an identifier ("Second pressing · #13/500"), rename any of
	     them, remove the specific one that left. A want has no copies until it's
	     acquired (F5). -->
{#if data.record.status !== 'wanted'}
	<section class="mt-16 border-t border-edge pt-10">
		<div>
			<h3 class="font-display text-3xl font-normal">Copies</h3>
			<p class="mt-2 font-display text-[13.5px] italic text-faint">
				{data.copies.length}
				{data.copies.length === 1 ? 'physical copy' : 'physical copies'} of this release — name each one so the shelf matches
				what's in your hands
			</p>
		</div>

		<div class="mt-6">
			{#each data.copies as c, i (c.id)}
				{@const last = data.copies.length === 1}
				<div class="group grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-hair py-2.5">
					<span class="text-right text-[11px] uppercase tracking-[.18em] text-faint">{i + 1}</span>
					{#if editingCopyId === c.id}
						<!-- inline rename — same underline-input pattern as the tracklist -->
						<form method="POST" action="?/rename_copy" class="flex min-w-0 flex-wrap items-center gap-2" use:enhance>
							<input type="hidden" name="copy_id" value={c.id} />
							<input
								class="min-w-0 flex-1 border-b border-edge bg-transparent px-1 py-0.5 text-[14px] outline-none focus:border-accent"
								name="copy_label"
								bind:value={editCopyLabel}
								placeholder="Blank = unlabeled"
								aria-label="Copy identifier"
							/>
							<Button type="submit" variant="secondary" size="sm">Save</Button>
							<Button variant="ghost" size="sm" onclick={cancelEditCopy}>Cancel</Button>
						</form>
					{:else}
						<button
							type="button"
							class="break-words text-left text-[15px] transition-colors hover:underline"
							title="Rename this copy"
							onclick={() => startEditCopy(c)}
						>
							{c.label ?? `Copy ${i + 1}`}
						</button>
					{/if}
					<form method="POST" action="?/remove_copy" class="inline-flex">
						<input type="hidden" name="copy_id" value={c.id} />
						<Button
							type="submit"
							variant="ghost"
							size="sm"
							disabled={last}
							title={last ? 'A record always keeps its last copy' : `Remove ${c.label ?? `copy ${i + 1}`}`}
						>
							Remove
						</Button>
					</form>
				</div>
			{/each}
		</div>

		<form method="POST" action="?/add_copy" class="mt-6 flex max-w-xl flex-col gap-3" use:enhance>
			<Input
				name="copy_label"
				placeholder="What makes this one distinct? — e.g. Second pressing · #13/500 (blank = just one more)"
			/>
			<div>
				<Button type="submit" variant="secondary">Add a copy</Button>
			</div>
		</form>
	</section>
{/if}

<!-- from Discogs: the cached release details (offline-capable) -->
{#if data.snapshot}
	{@const s = data.snapshot}
	<section class="mt-16 border-t border-edge pt-10">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h3 class="font-display text-3xl font-normal">From Discogs</h3>
				<p class="mt-2 font-display text-[13.5px] italic text-faint">
					cached {fmtPlayDate(s.fetched_at)}
				</p>
			</div>
			{#if data.record.discogs_id}
				<form
					method="POST"
					action="?/refresh_details"
					class="inline-flex"
					use:enhance={() =>
						async ({ result, update }) => {
							refreshingDetails = true;
							detailsError = null;
							if (result && 'type' in result && result.type === 'failure') {
								detailsError =
									(result.data as { error?: string } | undefined)?.error ?? 'Could not refresh the details.';
							} else {
								await update();
							}
							refreshingDetails = false;
						}}
				>
					<Button type="submit" variant="ghost" size="sm" disabled={refreshingDetails}>
						{refreshingDetails ? 'Refreshing…' : 'Refresh details'}
					</Button>
				</form>
			{/if}
		</div>
		{#if detailsError}<p class="mt-3 text-sm text-rust">{detailsError}</p>{/if}

		<dl class="mt-6 flex flex-col">
			{#each [['Country', s.country ?? ''], ['Released', s.released_formatted && s.released_formatted !== data.record.year ? s.released_formatted : ''], ['Series', s.series.join(', ')], ['Community', communityLine]] as [string, string][] as [k, v] (k)}
				{#if v}
					<div
						class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 border-b border-hair py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-6"
					>
						<dt class="pt-0.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
							{k}
						</dt>
						<dd class="break-words text-[15px] text-muted">{v}</dd>
					</div>
				{/if}
			{/each}
		</dl>

		{#if s.notes}
			<div class="mt-6 border-l-2 border-l-edge bg-surface px-5 py-4">
				<p class="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">
					Notes, as Discogs has them
				</p>
				<p class="whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">
					{s.notes}
				</p>
			</div>
		{/if}

		{#if snapshotCredits.length > 0}
			<div class="mt-7">
				<p class="text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">Credits</p>
				<ul class="mt-3 flex flex-col">
					{#each snapshotCredits as c (creditKey(c))}
						<li
							class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-hair py-2 sm:grid-cols-[220px_minmax(0,1fr)]"
						>
							<span class="text-[10.5px] uppercase tracking-[.18em] text-faint"
								>{c.role || (c.kind === 'company' ? 'Company' : 'Guest')}</span
							>
							<span class="break-words font-display text-[14.5px] text-muted sm:text-right">{c.name}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if snapshotVideos.length > 0}
			<div class="mt-7">
				<p class="text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">Videos</p>
				<ul class="mt-3 flex flex-wrap gap-x-6 gap-y-2">
					{#each snapshotVideos as v (v.url)}
						<li>
							<a
								href={v.url}
								target="_blank"
								rel="noopener noreferrer"
								class="font-display text-[14px] italic text-muted underline underline-offset-4 transition-colors hover:text-accent"
							>
								▶ {v.title}{v.duration !== null &&
									` (${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')})`}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>
{/if}

<!-- edit form — a modal so the sheet doesn't land below the fold on mobile -->
<Modal
	open={editing}
	aria-label="Edit details"
	title="Edit details"
	size="lg"
	locked={editSubmitting}
	onClose={() => {
		editing = false;
		draft = draftFromRow(data.record); // discard unsaved changes
	}}
>
	{#if form?.error}
		<div class="mb-6">
			<Banner variant="error">{form.error}</Banner>
		</div>
	{/if}
	<form
		method="POST"
		action="?/edit"
		use:enhance={() =>
			async ({ result }) => {
				editSubmitting = true;
				try {
					// Success: dismiss the editor (SvelteKit then revalidates the spec
					// sheet from the updated row). Failure: keep it open so the error
					// banner and the filled-in fields stay put.
					if (!result || !('type' in result) || result.type !== 'failure') {
						editing = false;
					}
				} finally {
					editSubmitting = false;
				}
			}}
	>
		<RecordForm bind:draft sources={data.sources} submitLabel="Save changes" />
	</form>
</Modal>

<!-- re-identify — re-pick the release this record points at (wrong pick at import) -->
<Modal open={reidOpen} aria-label="Re-identify" title="Re-identify" size="lg" onClose={closeReidentify}>
	<p class="max-w-xl font-display text-[13.5px] italic leading-relaxed text-faint">
		{#if data.record.barcode}
			Barcode {data.record.barcode} — pick the release this record actually is.
		{:else}
			No barcode on file — searched "{data.record.artist}
			{data.record.title}" instead.
		{/if}
		Identifying details and cover are replaced; your copy's condition, price and notes are kept.
	</p>

	{#if form?.error}
		<div class="mt-6">
			<Banner variant="error">{form.error}</Banner>
		</div>
	{/if}

	{#if reidLoading}
		<p class="mt-8 font-display text-[14px] italic text-faint">Looking up on Discogs…</p>
	{:else if reidError}
		<div class="mt-8">
			<Banner variant="warn">Discogs lookup: {reidError}</Banner>
		</div>
	{:else if reidCandidates && reidCandidates.length === 0}
		<div class="mt-8">
			<Banner variant="info">No Discogs results — fix the identifying fields in "Edit details" instead.</Banner>
		</div>
	{:else if reidCandidates}
		<ReleasePicker
			candidates={reidCandidates}
			selectedId={data.record.discogs_id}
			action="?/reidentify"
			commitLabel="Select"
			onCommitted={closeReidentify}
		/>
	{/if}
</Modal>

<!-- change cover — override the artwork without touching the record's identity -->
<Modal open={coverOpen} aria-label="Change cover" title="Change cover" size="lg" onClose={closeCover}>
	<p class="max-w-xl font-display text-[13.5px] italic leading-relaxed text-faint">
		Replace the artwork only — none of the picked entry's data touches this record, and nothing changes for the record
		itself.
	</p>

	{#if form?.error}
		<div class="mt-6">
			<Banner variant="error">{form.error}</Banner>
		</div>
	{/if}

	{#if coverError}
		<div class="mt-6">
			<Banner variant="error">{coverError}</Banner>
		</div>
	{/if}

	<!-- (i) borrow the artwork of any other Discogs entry -->
	<div class="mt-8">
		<h4 class="text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">From another Discogs entry</h4>
		<form
			class="mt-3 flex max-w-md items-end gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				void searchCover(coverQuery);
			}}
		>
			<div class="min-w-0 flex-1">
				<Input name="cover_query" placeholder="Search artist, title or catno…" bind:value={coverQuery} />
			</div>
			<Button type="submit" variant="secondary" size="sm" disabled={coverLoading}>
				{coverLoading ? 'Searching…' : 'Search'}
			</Button>
		</form>

		{#if coverLoading}
			<p class="mt-6 font-display text-[14px] italic text-faint">Looking up on Discogs…</p>
		{:else if coverCandidates && coverCandidates.length === 0}
			<div class="mt-6">
				<Banner variant="info">No Discogs results for that search.</Banner>
			</div>
		{:else if coverCandidates}
			<ReleasePicker
				candidates={coverCandidates}
				selectedLabel="Current cover"
				action="?/pick_cover"
				commitLabel="Use this cover"
				fieldName="release_id"
				onCommitted={() => void onCoverPicked()}
			/>
		{/if}
	</div>

	<!-- (ii) upload a local image, or restore the linked release's artwork -->
	<div class="mt-10 border-t border-hair pt-8">
		<h4 class="text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">Or your own image</h4>
		<div class="mt-4 flex flex-wrap items-center gap-4">
			<label
				class={`group block w-[180px] shrink-0 cursor-pointer overflow-hidden rounded-xs border border-dashed border-edge transition-colors hover:border-accent ${coverLoading ? 'pointer-events-none opacity-50' : ''}`}
			>
				<span
					class="flex aspect-square w-full flex-col items-center justify-center gap-2 px-4 text-center text-faint transition-colors group-hover:text-accent"
				>
					<span class="text-xl leading-none" aria-hidden="true">+</span>
					<span class="text-[10px] font-semibold uppercase tracking-[.2em]"
						>{coverLoading ? 'Uploading…' : 'Upload cover image'}</span
					>
				</span>
				<input type="file" accept="image/*" onchange={(e) => void onCoverFilePicked(e)} class="hidden" />
			</label>
			{#if data.record.discogs_id}
				<form
					method="POST"
					action="?/reset_cover"
					class="inline-flex"
					use:enhance={() =>
						async ({ result, update }) => {
							if (result && 'type' in result && result.type === 'failure') {
								coverError = (result.data as { error?: string } | undefined)?.error ?? 'Could not restore the cover.';
								return; // keep the panel open on error
							}
							await update(); // 303 to the ?cover_saved=1 flash
							closeCover();
						}}
				>
					<Button type="submit" variant="ghost" size="sm">Restore linked release cover</Button>
				</form>
			{/if}
		</div>
	</div>
</Modal>

<!-- manual add — the row used to expand inline under the tracklist; it now pops up -->
<Modal
	open={addOpen}
	aria-label="Add a track"
	title="Add a track"
	size="sm"
	locked={addSaving}
	onClose={() => (addOpen = false)}
>
	<div class="flex flex-wrap items-center gap-2">
		<input
			class="w-14 border-b border-edge bg-transparent px-1 py-0.5 text-[13px] outline-none focus:border-accent"
			bind:value={addPos}
			placeholder="A1"
			aria-label="New track position"
		/>
		<input
			class="min-w-0 flex-1 border-b border-edge bg-transparent px-1 py-0.5 text-[14px] outline-none focus:border-accent"
			bind:value={addTitle}
			placeholder="Track title"
			aria-label="New track title"
		/>
		<input
			class="w-14 border-b border-edge bg-transparent px-1 py-0.5 text-right text-[13px] outline-none focus:border-accent"
			bind:value={addDur}
			placeholder="3:32"
			aria-label="New track duration"
		/>
		<Button variant="secondary" size="sm" disabled={addSaving} onclick={() => void submitAddTrack()}>
			{addSaving ? 'Adding…' : 'Add track'}
		</Button>
		<Button variant="ghost" size="sm" onclick={() => (addOpen = false)}>Cancel</Button>
		{#if addError}<p class="w-full text-sm text-rust">{addError}</p>{/if}
	</div>
</Modal>

<!-- big-photo confirm: files over 8MB ask before an aggressive re-encode + upload -->
{#if bigFiles.length > 0}
	<div class="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default bg-ink/25 backdrop-blur-[2px]"
			aria-label="Close dialog"
			onclick={cancelBigUpload}
		></button>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Large photograph"
			class="card-pop-sm relative w-full max-w-md border border-edge bg-paper p-7 shadow-xl"
		>
			<div class="flex items-start justify-between gap-4">
				<div class="min-w-0">
					<p class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">
						Large photograph{bigFiles.length > 1 ? 's' : ''}
					</p>
					<h3 class="mt-1.5 truncate font-display text-xl leading-snug">
						{bigSingle ? bigSingle.name : `${bigFiles.length} photos over ${fmtSize(BIG_PHOTO_BYTES)}`}
					</h3>
				</div>
				<button
					type="button"
					class="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center text-muted transition-colors hover:text-accent"
					aria-label="Close dialog"
					onclick={cancelBigUpload}
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
			<p class="mt-4 font-display text-[14px] leading-relaxed text-muted">
				{#if bigSingle && bigSingle.size > UPLOAD_MAX_BYTES}
					This image is {fmtSize(bigSingle.size)} — too large even against the
					{fmtSize(UPLOAD_MAX_BYTES)} limit, so it can't be uploaded. Try a smaller file.
				{:else}
					This image is {bigSingle ? fmtSize(bigSingle.size) : 'over ' + fmtSize(BIG_PHOTO_BYTES)}. Compress it (max
					side 1600px, re-encoded as JPEG) and upload?
				{/if}
			</p>
			<div class="mt-7 flex justify-end gap-3">
				<Button variant="secondary" type="button" onclick={cancelBigUpload}>Cancel</Button>
				<Button
					variant="primary"
					type="button"
					disabled={!!(bigSingle && bigSingle.size > UPLOAD_MAX_BYTES)}
					onclick={() => void confirmBigUpload()}
				>
					Compress & upload
				</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Acquire dialog (F5) — the one-tap, now with its details: when, what it cost,
	    how it came in. All fields optional; the date defaults to today. -->
{#if data.record.status === 'wanted'}
	<AcquireDialog
		open={acquireOpen}
		action="?/acquire"
		artist={data.record.artist}
		title={data.record.title}
		error={form?.error ?? null}
		onCancel={() => (acquireOpen = false)}
	/>
{/if}
