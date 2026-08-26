<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import RecordForm from '$lib/components/RecordForm.svelte';
	import { draftFromRow } from '$lib/draft';
	import type { PhotoRow, RecordDraft } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	let draft: RecordDraft = $state(draftFromRow(data.record));
	let editing = $state(false);

	// After a successful save, server data is revalidated — resync the form from it.
	$effect(() => {
		const record = data.record; // reactive read
		if (record) draft = draftFromRow(record);
	});
	let photos: PhotoRow[] = $state(data.photos);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let newPhotoFile = $state<FileList | null>(null);
	let caption = $state('');

	// Downscale client-side to ~1600px JPEG before upload (keeps storage lean).
	async function downscale(file: File): Promise<Blob> {
		const bitmap = await createImageBitmap(file);
		const maxSide = 1600;
		const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
		if (scale === 1 && file.type === 'image/jpeg') return file;
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);
		const ctx = canvas.getContext('2d');
		if (!ctx) return file;
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		return new Promise((resolve) =>
			canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.85)
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
				fd.append('files', await downscale(f));
			}
			if (caption.trim()) fd.append('caption', caption.trim());
			const res = await fetch(`/api/records/${data.record.id}/photos`, { method: 'POST', body: fd });
			const json = (await res.json()) as { ok?: boolean; photos?: PhotoRow[]; message?: string };
			if (!res.ok || !json.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
			photos = json.photos ?? photos;
			newPhotoFile = null;
			caption = '';
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			uploading = false;
		}
	}

	async function removePhoto(photoId: number): Promise<void> {
		if (!confirm('Delete this photo?')) return;
		const res = await fetch(
			`/api/records/${data.record.id}/photos?photoId=${photoId}`,
			{ method: 'DELETE' }
		);
		const json = (await res.json()) as { ok?: boolean; photos?: PhotoRow[] };
		if (res.ok) {
			photos = json.photos ?? photos.filter((p) => p.id !== photoId);
		}
	}

	function coverSrc(): string | null {
		if (data.record.cover_filename) return `/media/${data.record.cover_filename}`;
		return data.record.cover_remote_url;
	}

	function fmtPrice(cents: number | null): string {
		return cents === null ? '—' : `$${(cents / 100).toFixed(2)}`;
	}

	const flash = page.url.searchParams.get('imported') || page.url.searchParams.get('added_copy');
</script>

<svelte:head><title>{data.record.artist} — {data.record.title} · mynyl</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
	<a href="/" class="text-sm opacity-60 hover:opacity-100">← All records</a>

	{#if flash === 'imported'}
		<p class="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-400">Record saved. 🎉</p>
	{:else if flash === 'added_copy'}
		<p class="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-400">Added another copy.</p>
	{/if}

	<!-- header: cover + identity -->
	<div class="flex flex-col gap-6 sm:flex-row">
		<div class="w-full shrink-0 sm:w-56">
			<div class="aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
				{#if coverSrc()}
					<img src={coverSrc()} alt="Cover" class="h-full w-full object-cover" />
				{:else}
					<div class="flex h-full items-center justify-center text-6xl opacity-20">💿</div>
				{/if}
			</div>
			{#if data.record.cover_remote_url && !data.record.cover_filename}
				<p class="mt-1 text-xs opacity-40">Cover is remote (not yet downloaded locally).</p>
			{/if}
		</div>

		<div class="min-w-0 flex-1 space-y-2">
			<h1 class="text-3xl font-bold leading-tight">{data.record.artist}</h1>
			<h2 class="text-xl opacity-80">{data.record.title}</h2>

			<dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
				{#if data.record.year}<dt class="opacity-50">Year</dt><dd>{data.record.year}</dd>{/if}
				{#if data.record.genre}<dt class="opacity-50">Genre</dt><dd>{data.record.genre}</dd>{/if}
				{#if data.record.style}<dt class="opacity-50">Style</dt><dd>{data.record.style}</dd>{/if}
				{#if data.record.label}<dt class="opacity-50">Label</dt><dd class="break-words">{data.record.label}</dd>{/if}
				{#if data.record.format}<dt class="opacity-50">Format</dt><dd>{data.record.format}</dd>{/if}
				{#if data.record.barcode}<dt class="opacity-50">Barcode</dt><dd class="font-mono">{data.record.barcode}</dd>{/if}
				{#if data.record.condition_media}<dt class="opacity-50">Cond. media</dt><dd>{data.record.condition_media}</dd>{/if}
				{#if data.record.condition_sleeve}<dt class="opacity-50">Cond. sleeve</dt><dd>{data.record.condition_sleeve}</dd>{/if}
				<dt class="opacity-50">Price paid</dt><dd>{fmtPrice(data.record.price_paid)}</dd>
				{#if data.record.acquired_at}<dt class="opacity-50">Acquired</dt><dd>{data.record.acquired_at}</dd>{/if}
				{#if data.record.source}<dt class="opacity-50">Source</dt><dd>{data.record.source}</dd>{/if}
				<dt class="opacity-50">Status</dt>
				<dd><span class="rounded-full bg-zinc-800 px-2 py-0.5 text-xs">{data.record.status.replace('_', ' ')}</span></dd>
				<dt class="opacity-50">Copies</dt><dd>{data.record.copies}{data.record.limited_edition ? ' · limited' : ''}</dd>
			</dl>

			{#if data.record.notes}
				<p class="whitespace-pre-wrap rounded-lg bg-zinc-900/60 p-3 text-sm opacity-80">{data.record.notes}</p>
			{/if}

			{#if data.record.discogs_id}
				<a
					href="https://www.discogs.com/release/{data.record.discogs_id}"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-block text-sm opacity-60 underline hover:opacity-100"
				>
					View on Discogs ↗
				</a>
			{/if}

			<div class="flex flex-wrap gap-2 pt-3">
				<button
					class="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-emerald-500"
					onclick={() => {
						editing = !editing;
						if (!editing) draft = draftFromRow(data.record); // discard unsaved changes
					}}
				>
					{editing ? 'Cancel editing' : '✏️ Edit'}
				</button>
				<form method="POST" action="?/add_copy" class="inline">
					<button class="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-emerald-500">
						+ Add a copy
					</button>
				</form>
				<form method="POST" action="?/delete" class="inline" onsubmit={(e) => { if (!confirm('Delete this record? Its photos will be removed too.')) e.preventDefault(); }}>
					<button class="rounded-lg border border-red-900/60 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/40">
						Delete
					</button>
				</form>
			</div>
		</div>
	</div>

	<!-- edit form -->
	{#if editing}
		<section class="space-y-4 rounded-xl border border-zinc-800 p-4">
			<h3 class="font-semibold">Edit details</h3>
			{#if form?.error}<p class="rounded-lg bg-red-500/10 p-2 text-sm text-red-400">{form.error}</p>{/if}
			<form
				method="POST"
				action="?/edit"
				use:enhance
			>
				<RecordForm bind:draft submitLabel="Save changes" />
			</form>
		</section>
	{/if}

	<!-- photos -->
	<section class="space-y-4 rounded-xl border border-zinc-800 p-4">
		<h3 class="font-semibold">Photos ({photos.length})</h3>

		{#if photos.length > 0}
			<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
				{#each photos as p (p.id)}
					<figure class="group relative overflow-hidden rounded-lg bg-zinc-900">
						<img src="/media/{p.filename}" alt={p.caption ?? ''} loading="lazy" class="aspect-square w-full object-cover" />
						{#if p.caption}<figcaption class="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-xs">{p.caption}</figcaption>{/if}
						<button
							class="absolute right-1 top-1 hidden rounded-full bg-black/70 px-2 py-0.5 text-xs group-hover:block"
							onclick={() => void removePhoto(p.id)}
						>✕</button>
					</figure>
				{/each}
			</div>
		{:else}
			<p class="text-sm opacity-60">No photos yet — add images of your physical record below.</p>
		{/if}

		<form method="POST" onsubmit={(e) => void addPhotos(e)} class="flex flex-wrap items-center gap-2">
			<input type="file" name="files" multiple accept="image/*" bind:files={newPhotoFile} class="text-sm" />
			<input
				bind:value={caption}
				placeholder="optional caption"
				class="min-w-[140px] flex-1 rounded-lg border border-zinc-700 bg-transparent px-3 py-1.5 text-sm"
			/>
			<button class="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium disabled:opacity-50" disabled={uploading}>
				{uploading ? 'Uploading…' : 'Add photo'}
			</button>
		</form>
		{#if uploadError}<p class="text-sm text-red-400">{uploadError}</p>{/if}
	</section>
</div>
