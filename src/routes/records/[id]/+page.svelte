<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import RecordForm from "$lib/components/RecordForm.svelte";
	import Banner from "$lib/components/ui/Banner.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import CoverImage from "$lib/components/ui/CoverImage.svelte";
	import Input from "$lib/components/ui/Input.svelte";
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
	let newPhotoFile = $state<FileList | null>(null);
	let caption = $state("");

	// Downscale client-side to ~1600px JPEG before upload (keeps storage lean).
	async function downscale(file: File): Promise<Blob> {
		const bitmap = await createImageBitmap(file);
		const maxSide = 1600;
		const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
		if (scale === 1 && file.type === "image/jpeg") return file;
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) return file;
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		return new Promise((resolve) =>
			canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85),
		);
	}

	async function addPhotos(e: Event): Promise<void> {
		e.preventDefault();
		if (!newPhotoFile || newPhotoFile.length === 0) return;
		uploading = true;
		uploadError = null;
		try {
			const fd = new FormData();
			for (const f of Array.from(newPhotoFile)) {
				fd.append("files", await downscale(f));
			}
			if (caption.trim()) fd.append("caption", caption.trim());
			const res = await fetch(`/api/records/${data.record.id}/photos`, {
				method: "POST",
				body: fd,
			});
			const json = (await res.json()) as {
				ok?: boolean;
				photos?: PhotoRow[];
				message?: string;
			};
			if (!res.ok || !json.ok)
				throw new Error(json.message ?? `HTTP ${res.status}`);
			photosOverride = json.photos ?? photos;
			newPhotoFile = null;
			caption = "";
		} catch (err) {
			uploadError = err instanceof Error ? err.message : "Upload failed";
		} finally {
			uploading = false;
		}
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

	const flash =
		page.url.searchParams.get("imported") ||
		page.url.searchParams.get("added_copy") ||
		page.url.searchParams.get("cover_saved");

	const statusTone: Record<string, "forest" | "butter" | "muted"> = {
		in_collection: "forest",
		sold: "butter",
		traded_away: "muted",
	};

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
				["Acquired", data.record.acquired_at ?? ""],
				["Source", data.record.source ?? ""],
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
{:else if flash === "cover_saved"}
	<div class="mt-6">
		<Banner variant="success">Cover saved.</Banner>
	</div>
{/if}

<!-- detail — a full catalogue spread -->
<div class="mt-8 grid gap-14 lg:grid-cols-[minmax(300px,420px)_1fr]">
	<div>
		<div class="w-full">
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
				<dd class="text-[15px] font-normal text-accent">
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
			<Button
				variant="primary"
				disabled={loggingPlay}
				onclick={() => void logPlay()}
			>
				{loggingPlay ? "Logging…" : "Log a play"}
			</Button>
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
			<form method="POST" action="?/add_copy" class="inline-flex">
				<Button type="submit" variant="secondary">Add a copy</Button>
			</form>
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

	{#if photos.length > 0}
		<div class="flex flex-wrap gap-4">
			{#each photos as p (p.id)}
				<figure class="group relative w-[180px]">
					<img
						src="/media/{p.filename}"
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

			<form
				method="POST"
				onsubmit={(e) => void addPhotos(e)}
				class="flex w-[180px] flex-col items-center justify-center gap-3"
			>
				<label
					class={`flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xs border border-dashed border-edge text-center transition-colors hover:border-accent hover:text-accent ${uploading ? "pointer-events-none opacity-50" : "text-faint"}`}
				>
					<span class="text-xl leading-none" aria-hidden="true">+</span>
					<span class="px-4 text-[10px] font-semibold uppercase tracking-[.2em]"
						>{uploading ? "Uploading…" : "Add photographs"}</span
					>
					<input
						type="file"
						name="files"
						multiple
						accept="image/*"
						bind:files={newPhotoFile}
						class="hidden"
					/>
				</label>
				{#if newPhotoFile?.length}
					<Input
						bind:value={caption}
						placeholder="optional caption"
						class="w-full text-center text-xs"
					/>
					<button
						type="submit"
						disabled={uploading}
						class="text-[10px] font-semibold uppercase tracking-[.2em] text-accent disabled:opacity-50"
					>
						Upload {newPhotoFile.length === 1
							? "photo"
							: `${newPhotoFile.length} photos`} →
					</button>
				{/if}
			</form>
		</div>
	{:else}
		<div class="flex flex-wrap items-center gap-5">
			<form
				method="POST"
				onsubmit={(e) => void addPhotos(e)}
				class="inline-flex"
			>
				<label
					class={`flex h-40 w-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xs border border-dashed border-edge text-center transition-colors hover:border-accent hover:text-accent ${uploading ? "pointer-events-none opacity-50" : "text-faint"}`}
				>
					<span class="text-xl leading-none" aria-hidden="true">+</span>
					<span class="px-4 text-[10px] font-semibold uppercase tracking-[.2em]"
						>{uploading ? "Uploading…" : "Add photographs"}</span
					>
					<input
						type="file"
						name="files"
						multiple
						accept="image/*"
						bind:files={newPhotoFile}
						class="hidden"
					/>
				</label>
			</form>
			<p class="max-w-xs font-display text-[13.5px] italic text-faint">
				No photographs yet — add images of your physical record.
			</p>
		</div>
	{/if}

	{#if uploadError}<p class="mt-4 text-sm text-rust">{uploadError}</p>{/if}
</section>
