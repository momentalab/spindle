<script lang="ts">
	import { enhance } from '$app/forms';
	import RecordForm from '$lib/components/RecordForm.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { draftFromSeed, emptyDraft } from '$lib/draft';
	import type { DiscogsSeed, RecordDraft } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	let draft: RecordDraft = $state(data.seed ? draftFromSeed(data.seed) : emptyDraft());
	let expandingId = $state<number | null>(null);
	let expandError = $state<string | null>(null);
	let duplicate = $state<{ id: number; artist: string; title: string } | null>(
		form?.duplicate ?? null
	); // non-enhanced (no-JS) submissions land here with the dedupe result
	let createAnyway = $state(false);

	async function pickCandidate(id: number): Promise<void> {
		// Already expanded? No-op.
		if (data.seed && data.seed.discogs_id === id) return;
		expandingId = id;
		expandError = null;
		try {
			const res = await fetch(`/api/import?id=${id}`);
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				throw new Error(body?.message ?? `HTTP ${res.status}`);
			}
			const json = (await res.json()) as { seed: DiscogsSeed };
			draft = draftFromSeed(json.seed);
		} catch (e) {
			expandError = e instanceof Error ? e.message : 'Could not load that release.';
		} finally {
			expandingId = null;
		}
	}

	function onFormSuccess(): void {
		duplicate = null;
		createAnyway = false;
	}
</script>

<svelte:head><title>Add record · mynyl</title></svelte:head>

<div class="space-y-6">
	<header class="flex flex-wrap items-center gap-3">
		<h1 class="font-display text-3xl font-black tracking-tight">Add record</h1>
		<span class="rounded-full border-2 border-edge bg-surface-2 px-3 py-1 font-mono text-sm font-bold">
			{data.barcode}
		</span>
	</header>

	{#if data.existing}
		{@const existing = data.existing}
		<Banner variant="warn">
			{#snippet actions()}
				<form method="POST" class="inline">
					<input type="hidden" name="op" value="add_copy" />
					<input type="hidden" name="record_id" value={existing.id} />
					<Button type="submit" size="sm" variant="secondary">+ Add another copy</Button>
				</form>
			{/snippet}
			Already in your collection:
			<a href="/records/{data.existing.id}" class="font-bold underline underline-offset-4">
				{data.existing.artist} — {data.existing.title}
			</a>
			({data.existing.copies} cop{data.existing.copies === 1 ? 'y' : 'ies'})
		</Banner>
	{/if}

	{#if data.candidates.length > 0}
		<section class="space-y-3">
			<h2 class="font-display text-sm font-black uppercase tracking-widest text-plum">
				{data.candidates.length === 1 ? 'Found on Discogs' : `Matched ${data.candidates.length} releases — pick one`}
			</h2>
			<ul class="grid gap-3 sm:grid-cols-2">
				{#each data.candidates as c (c.id)}
					<li>
						<button
							type="button"
							class={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all duration-300 ${
								draft.discogs_id === String(c.id)
									? 'border-plum bg-plum-soft shadow-brutal-sm'
									: 'border-edge bg-surface hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal-sm'
							} disabled:opacity-60`}
							disabled={expandingId !== null}
							onclick={() => void pickCandidate(c.id)}
						>
							{#if c.thumb}
								<img src={c.thumb} alt="" class="h-14 w-14 shrink-0 rounded-xl border-2 border-edge object-cover" />
							{:else}
								<div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-edge bg-surface-2">💿</div>
							{/if}
							<span class="min-w-0">
								<span class="block truncate font-bold">{c.title}</span>
								<span class="block text-xs text-muted">
									{c.year ?? '????'} · {c.catno ?? ''}
									{#if expandingId === c.id}<span class="font-semibold"> …loading</span>{/if}
								</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if expandError}<Banner variant="error">{expandError}</Banner>{/if}
		</section>
	{:else if data.lookupError === null}
		<Banner variant="info">No Discogs results for this barcode — fill in the details below manually.</Banner>
	{:else}
		<Banner variant="warn">Discogs lookup: {data.lookupError} You can still add this record manually below.</Banner>
	{/if}

	{#if duplicate}
		{@const dup = duplicate}
		<Banner variant="error">
			{#snippet actions()}
				<form method="POST" class="inline">
					<input type="hidden" name="op" value="add_copy" />
					<input type="hidden" name="record_id" value={dup.id} />
					<Button type="submit" size="sm">+ Add copy</Button>
				</form>
				<Button
					size="sm"
					variant="secondary"
					onclick={() => {
						createAnyway = true;
						duplicate = null;
					}}
				>
					Create anyway (different pressing)
				</Button>
			{/snippet}
			Already saved as <strong>{duplicate.artist} — {duplicate.title}</strong> (same barcode or Discogs ID).
		</Banner>
	{/if}

	<Card shadow class="p-4 sm:p-6">
		{#if form?.error}<div class="mb-4"><Banner variant="error">{form.error}</Banner></div>{/if}
		<form
			method="POST"
			class="space-y-6"
			use:enhance={() =>
				async ({ result, update }) => {
					if (result && 'data' in result && result.data?.duplicate) {
						duplicate = result.data.duplicate as typeof duplicate;
						return; // stay on the page, show the dedupe banner
					}
					update(); // default behavior → follow 303 redirect on success
				}
			}
		>
			<input type="hidden" name="op" value={createAnyway ? 'create_anyway' : 'save'} />
			<RecordForm bind:draft submitLabel="Save to my collection" />
		</form>
	</Card>

	<p class="text-xs text-muted">
		Tip: the cover image is downloaded and stored locally on save (when available on Discogs), so your
		collection stays browsable offline.
	</p>
</div>
