<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import RecordForm from '$lib/components/RecordForm.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import CoverImage from '$lib/components/ui/CoverImage.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { draftFromRow } from '$lib/draft';
	import { STATUS_LABELS } from '$lib/types';
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

	const statusTone: Record<string, 'forest' | 'butter' | 'muted'> = {
		in_collection: 'forest',
		sold: 'butter',
		traded_away: 'muted'
	};

	// Flat label/value pairs for the metadata grid (nulls skipped).
	const meta = $derived(
		(
			[
				['Year', data.record.year ?? ''],
				['Genre', data.record.genre ?? ''],
				['Style', data.record.style ?? ''],
				['Label', data.record.label ?? ''],
				['Format', data.record.format ?? ''],
				['Barcode', data.record.barcode ?? ''],
				['Cond. media', data.record.condition_media ?? ''],
				['Cond. sleeve', data.record.condition_sleeve ?? ''],
				['Price paid', fmtPrice(data.record.price_paid)],
				['Acquired', data.record.acquired_at ?? ''],
				['Source', data.record.source ?? ''],
			] as [string, string][]
		).filter(([, v]) => v !== '' && v !== '—')
	);
</script>

<svelte:head><title>{data.record.artist} — {data.record.title} · mynyl</title></svelte:head>

<div class="space-y-6">
	<a href="/" class="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-plum">
		← All records
	</a>

	{#if flash === 'imported'}
		<Banner variant="success">Record saved. 🎉</Banner>
	{:else if flash === 'added_copy'}
		<Banner variant="success">Added another copy.</Banner>
	{/if}

	<!-- header: cover + identity -->
	<div class="flex flex-col gap-6 sm:flex-row">
		<div class="w-full shrink-0 sm:w-64">
			<Card shadow class="p-2">
				<CoverImage src={coverSrc()} alt="Cover" class="aspect-square w-full rounded-xl" loading="eager" />
			</Card>
			{#if data.record.cover_remote_url && !data.record.cover_filename}
				<p class="mt-2 text-xs text-muted">Cover is remote (not yet downloaded locally).</p>
			{/if}
		</div>

		<div class="min-w-0 flex-1 space-y-3">
			<h1 class="font-display text-3xl font-black leading-tight tracking-tight sm:text-4xl">{data.record.artist}</h1>
			<h2 class="text-xl font-bold text-muted">{data.record.title}</h2>

			<div class="flex flex-wrap gap-2">
				<Badge tone={statusTone[data.record.status]}>{STATUS_LABELS[data.record.status]}</Badge>
				{#if data.record.limited_edition}<Badge tone="plum">limited edition</Badge>{/if}
				{#if data.record.copies > 1}<Badge tone="butter">{data.record.copies} copies</Badge>{/if}
			</div>

			<dl class="grid grid-cols-2 gap-x-6 gap-y-2 pt-2 text-sm sm:grid-cols-3">
				{#each meta as [k, v] (k)}
					<div>
						<dt class="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt>
						<dd class={k === 'Barcode' ? 'font-mono' : ''}>{v}</dd>
					</div>
				{/each}
			</dl>

			{#if data.record.notes}
				<p class="whitespace-pre-wrap rounded-xl border-2 border-edge bg-surface p-3 text-sm">{data.record.notes}</p>
			{/if}

			{#if data.record.discogs_id}
				<a
					href="https://www.discogs.com/release/{data.record.discogs_id}"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-block text-sm font-semibold text-muted underline underline-offset-4 hover:text-plum"
				>
					View on Discogs ↗
				</a>
			{/if}

			<div class="flex flex-wrap gap-2 pt-2">
				<Button
					variant="secondary"
					onclick={() => {
						editing = !editing;
						if (!editing) draft = draftFromRow(data.record); // discard unsaved changes
					}}
				>
					{editing ? '✕ Cancel editing' : '✏️ Edit'}
				</Button>
				<form method="POST" action="?/add_copy" class="inline">
					<Button type="submit" variant="secondary">+ Add a copy</Button>
				</form>
				<form method="POST" action="?/delete" class="inline" onsubmit={(e) => { if (!confirm('Delete this record? Its photos will be removed too.')) e.preventDefault(); }}>
					<Button type="submit" variant="danger">Delete</Button>
				</form>
			</div>
		</div>
	</div>

	<!-- edit form -->
	{#if editing}
		<Card shadow class="space-y-4 p-4 sm:p-6">
			<h3 class="font-display text-lg font-black tracking-tight">Edit details</h3>
			{#if form?.error}<Banner variant="error">{form.error}</Banner>{/if}
			<form method="POST" action="?/edit" use:enhance>
				<RecordForm bind:draft submitLabel="Save changes" />
			</form>
		</Card>
	{/if}

	<!-- photos -->
	<Card shadow class="space-y-4 p-4 sm:p-6">
		<h3 class="font-display text-lg font-black tracking-tight">Photos ({photos.length})</h3>

		{#if photos.length > 0}
			<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
				{#each photos as p (p.id)}
					<figure class="group relative overflow-hidden rounded-xl border-2 border-edge bg-surface-2">
						<img src="/media/{p.filename}" alt={p.caption ?? ''} loading="lazy" class="aspect-square w-full object-cover" />
						{#if p.caption}<figcaption class="absolute inset-x-0 bottom-0 border-t-2 border-edge bg-paper px-2 py-1 text-xs font-medium">{p.caption}</figcaption>{/if}
						<button
							aria-label="Delete photo"
							class="absolute right-1.5 top-1.5 hidden h-7 w-7 items-center justify-center rounded-full border-2 border-edge bg-paper text-xs font-black shadow-brutal-sm hover:bg-rust hover:text-white group-hover:flex"
							onclick={() => void removePhoto(p.id)}
						>✕</button>
					</figure>
				{/each}
			</div>
		{:else}
			<p class="rounded-xl border-2 border-dashed border-muted/50 p-4 text-sm text-muted">
				No photos yet — add images of your physical record below.
			</p>
		{/if}

		<form method="POST" onsubmit={(e) => void addPhotos(e)} class="flex flex-wrap items-center gap-2">
			<input type="file" name="files" multiple accept="image/*" bind:files={newPhotoFile} class="text-sm file:mr-2 file:cursor-pointer file:rounded-full file:border-2 file:border-edge file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-ink hover:file:bg-surface-2" />
			<Input bind:value={caption} placeholder="optional caption" class="min-w-[140px] flex-1 py-1.5" />
			<Button type="button" size="md" disabled={uploading}>
				{uploading ? 'Uploading…' : 'Add photo'}
			</Button>
		</form>
		{#if uploadError}<p class="text-sm font-semibold text-rust">{uploadError}</p>{/if}
	</Card>
</div>
