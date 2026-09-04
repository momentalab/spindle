<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import AcquireDialog from "$lib/components/AcquireDialog.svelte";
	import RecordForm from "$lib/components/RecordForm.svelte";
	import Banner from "$lib/components/ui/Banner.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import CoverImage from "$lib/components/ui/CoverImage.svelte";
	import { draftFromRow, emptyDraft } from "$lib/draft";
	import { appTitle } from "$lib/index";
	import { DISCOGS_LINK_ATTRS, discogsReleaseUrl } from "$lib/discogs";
	import { STATUS_LABELS, joinLabels, joinStyles } from "$lib/types";
	import type { PhotoRow, RecordDraft } from "$lib/types";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	let draft: RecordDraft = $state(emptyDraft());
	let editing = $state(false);

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

	// Missing-cover repair (F2): re-pull the artwork from Discogs when this record
	// only has a remote fallback (or a discogs_id to look one up). The ?/repair_cover
	// action handles the download; on success `update()` revalidates and the local
	// cover replaces the remote fallback.
	let repairingCover = $state(false);
	let coverError = $state<string | null>(null);
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

	function loadImage(
		file: File,
	): Promise<{ url: string; el: HTMLImageElement }> {
		return new Promise((resolve, reject) => {
			const url = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => resolve({ url, el: img });
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error(`${file.name} isn't a readable image`));
			};
			img.src = url;
		});
	}

	// Re-encode to JPEG at maxSide (long edge) before upload, stepping quality —
	// then width — down until under targetBytes. Falls back to the original File
	// when it isn't a decodable image or compression can't get there.
	async function downscale(
		file: File,
		maxSide: number,
		targetBytes?: number,
	): Promise<File> {
		let source: { url: string; el: HTMLImageElement };
		try {
			source = await loadImage(file);
		} catch (e) {
			throw e; // unreadable image — surfaced as the upload error
		}
		const { url, el } = source;
		try {
			const scale = Math.min(
				1,
				maxSide / Math.max(el.naturalWidth, el.naturalHeight),
			);
			const alreadySmall =
				scale === 1 &&
				file.type === "image/jpeg" &&
				(!targetBytes || file.size <= targetBytes);
			if (alreadySmall) return file;
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(el.naturalWidth * scale));
			canvas.height = Math.max(1, Math.round(el.naturalHeight * scale));
			const ctx = canvas.getContext("2d");
			if (!ctx) return file;
			// White fill so transparent PNGs become white, not black, JPEGs.
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
			const toJpeg = (q: number) =>
				new Promise<Blob | null>((resolve) =>
					canvas.toBlob(resolve, "image/jpeg", q),
				);
			const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
			const limit = targetBytes ?? Infinity;
			for (const q of [0.85, 0.72, 0.55]) {
				const blob = await toJpeg(q);
				if (!blob) break;
				const out = new File([blob], name, { type: "image/jpeg" });
				if (out.size <= limit) return out;
			}
			// Still over budget — halve the width a couple of times before giving up.
			let side = Math.round(maxSide / 2);
			while (side >= 400) {
				canvas.width = side;
				canvas.height = Math.max(
					1,
					Math.round(side * (el.naturalHeight / el.naturalWidth)),
				);
				ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
				const blob = await toJpeg(0.55);
				if (!blob) break;
				const out = new File([blob], name, { type: "image/jpeg" });
				if (out.size <= limit) return out;
				side = Math.round(side / 2);
			}
			return file; // let the server-side cap be the final arbiter
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	function fmtSize(bytes: number): string {
		return bytes >= 1024 * 1024
			? `${(bytes / 1024 / 1024).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}

	function onFilesPicked(e: Event): void {
		if (uploading) return;
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = ""; // allow re-picking the same file later
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
			return "";
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
						`"${f.name}" is still ${fmtSize(encoded.size)} after compression (limit ${fmtSize(UPLOAD_MAX_BYTES)})`,
					);
				fd.append("files", encoded);
			}
			const res = await fetch(`/api/records/${data.record.id}/photos`, {
				method: "POST",
				body: fd,
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				photos?: PhotoRow[];
				message?: string;
			} | null;
			if (!res.ok || !json?.ok)
				throw new Error(json?.message ?? `HTTP ${res.status}`);
			photosOverride = json.photos ?? photos;
		} catch (err) {
			uploadError = err instanceof Error ? err.message : "Upload failed";
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
		if (!confirm("Delete this photo?")) return;
		const res = await fetch(
			`/api/records/${data.record.id}/photos?photoId=${photoId}`,
			{ method: "DELETE" },
		);
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
	const lastPlayedAt = $derived(
		lastPlayedAtOverride === undefined
			? data.last_played_at
			: lastPlayedAtOverride,
	);
	let loggingPlay = $state(false);
	let undoingPlay = $state(false);

	const PLAY_MONTHS = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	] as const;

	/** Deterministic 'Aug 30, 2026' — no toLocaleDateString (SSR/locale drift). */
	function fmtPlayDate(iso: string | null): string {
		if (!iso) return "";
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return "";
		return `${PLAY_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
	}

	/** Whole days between an ISO date and the start of today: "today", "yesterday" or "N days ago". */
	function relDays(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return "";
		const today = new Date();
		const startOfDay = (x: Date) =>
			new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
		const days = Math.round((startOfDay(today) - startOfDay(d)) / 86400000);
		if (days <= 0) return "today";
		if (days === 1) return "yesterday";
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
				method: "POST",
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				play_count: number;
				last_played_at: string | null;
				message?: string;
			} | null;
			if (!res.ok || !json?.ok)
				throw new Error(json?.message ?? `HTTP ${res.status}`);
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
				method: "DELETE",
			});
			const json = (await res.json().catch(() => null)) as {
				ok?: boolean;
				play_count: number;
				last_played_at: string | null;
				message?: string;
			} | null;
			if (!res.ok || !json?.ok)
				throw new Error(json?.message ?? `HTTP ${res.status}`);
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
		if (data.record.cover_filename)
			return `/media/${data.record.cover_filename}`;
		return data.record.cover_remote_url;
	}

	function fmtPrice(cents: number | null): string {
		return cents === null ? "" : `$${(cents / 100).toFixed(2)}`;
	}

	// Key-based (has, not get): the redirect params carry values (?acquired=1),
	// so comparing against the key name is what makes these banners fire.
	const flash = $derived.by(() => {
		const sp = page.url.searchParams;
		if (sp.has("imported")) return "imported";
		if (sp.has("added_copy")) return "added_copy";
		if (sp.has("cover_saved")) return "cover_saved";
		if (sp.has("acquired")) return "acquired";
		return null;
	});

	const statusTone: Record<string, "forest" | "plum" | "butter" | "muted"> = {
		in_collection: "forest",
		sold: "butter",
		traded_away: "muted",
		wanted: "plum",
	};

	/** Numbered pressing — `828 / 1000`, or `#828` when only the number exists. */
	const copyDisplay = $derived.by(() => {
		const n = data.record.copy_number;
		const t = data.record.copy_total;
		if (n === null && t === null) return "";
		if (n !== null && t !== null) return `${n} / ${t}`;
		if (n !== null) return `#${n}`;
		return `/ ${t}`;
	});

	// Flat label/value pairs for the spec sheet (nulls skipped).
	const meta = $derived(
		(
			[
				[
					"Plays",
					playCount > 0
						? `${playCount} · spun ${fmtPlayDate(lastPlayedAt)}`
						: "—",
				],
				["Year", data.record.year ?? ""],
				[
					"Genre",
					[data.record.genres.join(", "), joinStyles(data.record.styles)]
						.filter(Boolean)
						.join(" — "),
				],
				["Label", joinLabels(data.record.labels)],
				["Format", data.record.format ?? ""],
				["Barcode", data.record.barcode ?? ""],
				[
					"Condition",
					[
						data.record.condition_media &&
							`media ${data.record.condition_media}`,
						data.record.condition_sleeve &&
							`sleeve ${data.record.condition_sleeve}`,
					]
						.filter(Boolean)
						.join(" · "),
				],
				["Price paid", fmtPrice(data.record.price_paid)],
				// F7 pre-stage — shown when a sale is recorded; the portfolio view (F7)
				// is what gives these columns their user-facing meaning.
				[
					"Sold",
					data.record.sold_at
						? `${relDays(data.record.sold_at)} · ${fmtPlayDate(data.record.sold_at)}`
						: "",
				],
				["Sale price", fmtPrice(data.record.sale_price)],
				[
					"Acquired",
					data.record.acquired_at
						? `${relDays(data.record.acquired_at)} · ${fmtPlayDate(data.record.acquired_at)}`
						: "",
				],
				["Source", data.record.source ?? ""],
				[
					"Wanted since",
					data.record.wanted_at
						? `${relDays(data.record.wanted_at)} · ${fmtPlayDate(data.record.wanted_at)}`
						: "",
				],
				["Copy", copyDisplay],
			] as [string, string][]
		).filter(([, v]) => v !== ""),
	);
</script>

<svelte:head
	><title>{appTitle(`${data.record.artist} · ${data.record.title}`)}</title
	></svelte:head
>

<a
	href="/"
	class="text-[11.5px] uppercase tracking-[.2em] text-faint transition-colors hover:text-ink"
>
	← Return to the index
</a>

{#if flash === "imported"}
	<div class="mt-6"><Banner variant="success">Record saved.</Banner></div>
{:else if flash === "added_copy"}
	<div class="mt-6"><Banner variant="success">Added another copy.</Banner></div>
{:else if flash === "acquired"}
	<div class="mt-6"><Banner variant="success">On the shelf.</Banner></div>
{:else if flash === "cover_saved"}
	<div class="mt-6">
		<Banner variant="success">Cover saved.</Banner>
	</div>
{/if}

<!-- detail — a full catalogue spread. The cover track is capped at 100%
     (and the wrapper gets min-w-0) so its w-full child can never inflate the
     column past the viewport on fresh records. -->
<div
	class="mt-8 grid gap-14 lg:grid-cols-[minmax(300px,min(420px,100%))_minmax(0,1fr)]"
>
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
			{:else}
				Front cover.
			{/if}
		</p>
		{#if !data.record.cover_filename && (data.record.cover_remote_url || data.record.discogs_id)}
			<div class="mt-4">
				{#if coverError}
					<Banner variant="error">{coverError}</Banner>
				{/if}
				<form
					method="POST"
					action="?/repair_cover"
					class="inline-flex"
					use:enhance={() =>
						async ({ result, update }) => {
							repairingCover = true;
							coverError = null;
							if (result && "type" in result && result.type === "failure") {
								coverError =
									(result.data as { error?: string } | undefined)?.error ??
									"Cover download failed.";
							} else {
								await update(); // revalidates: stored cover replaces the fallback
							}
							repairingCover = false;
						}}
				>
					<Button
						type="submit"
						variant="secondary"
						size="sm"
						disabled={repairingCover}
					>
						{repairingCover ? "Recovering…" : "Download cover"}
					</Button>
				</form>
			</div>
		{/if}

		<div class="mt-5 flex flex-wrap gap-2.5">
			{#if data.record.limited_edition}<Badge tone="plum">Limited edition</Badge
				>{/if}
			{#if data.record.copies > 1}<span
					class="font-display text-[13px] italic text-faint"
					>{data.record.copies} copies</span
				>{/if}
		</div>
	</div>

	<div class="min-w-0">
		<h1
			class="break-words font-display text-5xl font-normal leading-[1.02] tracking-[-.01em] sm:text-[56px]"
		>
			{data.record.title}
		</h1>
		{#if data.record.artist}<h2
				class="mt-2.5 font-display text-2xl font-normal italic text-muted"
			>
				{data.record.artist}
			</h2>{/if}

		<div class="my-7 h-px w-14 bg-accent"></div>

		<dl class="flex flex-col">
			{#each meta as [k, v] (k)}
				<div
					class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 border-b border-hair py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-6"
				>
					<dt
						class="pt-0.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
					>
						{k}
					</dt>
					<dd
						class={`break-words text-[15px] ${["Format", "Barcode", "Acquired", "Source"].includes(k) ? "text-muted" : ""}`}
					>
						{v}
					</dd>
				</div>
			{/each}
			<div
				class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 border-b border-hair py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-6"
			>
				<dt
					class="pt-0.5 text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
				>
					Status
				</dt>
				<dd
					class={`text-[15px] font-normal ${data.record.status === "wanted" ? "text-plum" : data.record.status === "in_collection" ? "text-accent" : "text-muted"}`}
				>
					{STATUS_LABELS[data.record.status]}
				</dd>
			</div>
		</dl>

		{#if data.record.notes}
			<div class="mt-7 border-l-2 border-l-edge bg-surface px-5 py-4">
				<p
					class="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
				>
					Notes
				</p>
				<p
					class="whitespace-pre-wrap font-display text-[15px] italic leading-relaxed text-muted"
				>
					{data.record.notes}
				</p>
			</div>
		{/if}

		<div class="mt-9 flex flex-wrap items-center gap-4">
			{#if data.record.status === "wanted"}
				<!-- (F5): the primary action for a want. Opens the acquire dialog —
				     date (default today), price and conditions land with it; the
				     ?/acquire form lives inside the dialog, enhance keeps the
				     page in place and the 303 lands the "On the shelf." flash. -->
				<Button variant="primary" onclick={() => (acquireOpen = true)}>
					Mark as acquired
				</Button>
			{:else}
				<Button
					variant="primary"
					disabled={loggingPlay}
					onclick={() => void logPlay()}
				>
					{loggingPlay ? "Logging…" : "Log a play"}
				</Button>
			{/if}
			{#if playCount > 0}
				<Button
					variant="ghost"
					size="sm"
					disabled={undoingPlay}
					onclick={() => void undoPlay()}
				>
					Undo last
				</Button>
			{/if}
			<Button
				variant="secondary"
				onclick={() => {
					editing = !editing;
					if (!editing) draft = draftFromRow(data.record); // discard unsaved changes
				}}
			>
				{editing ? "Cancel editing" : "Edit record"}
			</Button>
			<!-- inline-flex, not inline: a display:inline wrapper form ignores
			     margins and collapses its height, which is what made rows of
			     buttons stack with no vertical spacing. -->
			{#if data.record.status !== "wanted"}
				<!-- Copies of a want is nonsense until it's owned (F5). -->
				<form method="POST" action="?/add_copy" class="inline-flex">
					<Button type="submit" variant="secondary">Add a copy</Button>
				</form>
			{/if}
			<form
				method="POST"
				action="?/delete"
				class="inline-flex"
				onsubmit={(e) => {
					if (!confirm("Delete this record? Its photos will be removed too."))
						e.preventDefault();
				}}
			>
				<Button type="submit" variant="danger">Delete record</Button>
			</form>
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

<!-- edit form -->
{#if editing}
	<section class="mt-16 border-t border-edge pt-10">
		<h3 class="mb-8 font-display text-3xl font-normal">Edit details</h3>
		{#if form?.error}<div class="mb-6">
				<Banner variant="error">{form.error}</Banner>
			</div>{/if}
		<form
			method="POST"
			action="?/edit"
			use:enhance={() =>
				async ({ result }) => {
					// Success: dismiss the editor (SvelteKit then revalidates the spec
					// sheet from the updated row). Failure: keep it open so the error
					// banner and the filled-in fields stay put.
					if (!result || !("type" in result) || result.type !== "failure") {
						editing = false;
					}
				}}
		>
			<RecordForm
				bind:draft
				sources={data.sources}
				submitLabel="Save changes"
			/>
		</form>
	</section>
{/if}

<!-- photos — a quiet strip -->
<section class="mt-16">
	<h3
		class="mb-5 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
	>
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
			<span
				class="text-[10px] font-semibold uppercase tracking-[.2em] text-faint"
				>Uploading {staging.length === 1
					? "photo"
					: `${staging.length} photos`}…</span
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
						alt={p.caption ?? "Record photograph"}
						loading="lazy"
						class="aspect-square w-full rounded-xs border border-hair object-cover"
					/>
					{#if p.caption}<figcaption
							class="mt-2 font-display text-[12.5px] italic text-faint"
						>
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
				class={`group block w-[180px] shrink-0 cursor-pointer overflow-hidden rounded-xs border border-dashed border-edge transition-colors hover:border-accent ${uploading ? "pointer-events-none opacity-50" : ""}`}
			>
				<span
					class="flex aspect-square w-full flex-col items-center justify-center gap-2 px-4 text-center text-faint transition-colors group-hover:text-accent"
				>
					<span class="text-xl leading-none" aria-hidden="true">+</span>
					<span class="text-[10px] font-semibold uppercase tracking-[.2em]"
						>Add photographs</span
					>
				</span>
				<input
					type="file"
					multiple
					accept="image/*"
					onchange={onFilesPicked}
					class="hidden"
				/>
			</label>
		</div>
	{:else}
		<div class="flex flex-wrap items-start gap-5">
			<label
				class={`group block w-[180px] shrink-0 cursor-pointer overflow-hidden rounded-xs border border-dashed border-edge transition-colors hover:border-accent ${uploading ? "pointer-events-none opacity-50" : ""}`}
			>
				<span
					class="flex aspect-square w-full flex-col items-center justify-center gap-2 px-4 text-center text-faint transition-colors group-hover:text-accent"
				>
					<span class="text-xl leading-none" aria-hidden="true">+</span>
					<span class="text-[10px] font-semibold uppercase tracking-[.2em]"
						>Add photographs</span
					>
				</span>
				<input
					type="file"
					multiple
					accept="image/*"
					onchange={onFilesPicked}
					class="hidden"
				/>
			</label>
			<p class="max-w-xs font-display text-[13.5px] italic text-faint">
				No photographs yet — add images of your physical record.
			</p>
		</div>
	{/if}

	{#if uploadError}<p class="mt-4 text-sm text-rust">{uploadError}</p>{/if}
</section>

<!-- big-photo confirm: files over 8MB ask before an aggressive re-encode + upload -->
{#if bigFiles.length > 0}
	<div
		class="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center"
	>
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
					<p
						class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
					>
						Large photograph{bigFiles.length > 1 ? "s" : ""}
					</p>
					<h3 class="mt-1.5 truncate font-display text-xl leading-snug">
						{bigSingle
							? bigSingle.name
							: `${bigFiles.length} photos over ${fmtSize(BIG_PHOTO_BYTES)}`}
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
					{fmtSize(UPLOAD_MAX_BYTES)} limit, so it can't be uploaded. Try a smaller
					file.
				{:else}
					This image is {bigSingle
						? fmtSize(bigSingle.size)
						: "over " + fmtSize(BIG_PHOTO_BYTES)}. Compress it (max side 1600px,
					re-encoded as JPEG) and upload?
				{/if}
			</p>
			<div class="mt-7 flex justify-end gap-3">
				<Button variant="secondary" type="button" onclick={cancelBigUpload}>
					Cancel
				</Button>
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
{#if data.record.status === "wanted"}
	<AcquireDialog
		open={acquireOpen}
		action="?/acquire"
		artist={data.record.artist}
		title={data.record.title}
		error={form?.error ?? null}
		onCancel={() => (acquireOpen = false)}
	/>
{/if}
