<script lang="ts">
	import { enhance } from '$app/forms';
	import RecordForm from '$lib/components/RecordForm.svelte';
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

<div class="mx-auto max-w-3xl space-y-6 p-6">
	<h1 class="text-2xl font-bold">Add record <span class="font-mono text-lg opacity-70">{data.barcode}</span></h1>

	{#if data.existing}
		<div class="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			<span>
				Already in your collection:
				<a href="/records/{data.existing.id}" class="font-medium underline">
					{data.existing.artist} — {data.existing.title}
				</a>
				({data.existing.copies} cop{data.existing.copies === 1 ? 'y' : 'ies'})
			</span>
			<form method="POST" class="ml-auto flex gap-2">
				<input type="hidden" name="op" value="add_copy" />
				<input type="hidden" name="record_id" value={data.existing.id} />
				<button class="rounded bg-amber-500/90 px-3 py-1 font-medium text-black">+ Add another copy</button>
			</form>
		</div>
	{/if}

	{#if data.candidates.length > 0}
		<section class="space-y-2">
			<h2 class="text-sm font-semibold uppercase tracking-wide opacity-70">
				{data.candidates.length === 1 ? 'Found on Discogs' : 'Matched {data.candidates.length} releases — pick one'}
			</h2>
			<ul class="grid gap-2 sm:grid-cols-2">
				{#each data.candidates as c (c.id)}
					<li>
						<button
							class="flex w-full items-center gap-3 rounded-lg border p-2 text-left text-sm hover:border-emerald-500 {draft.discogs_id === String(c.id) ? 'border-emerald-500' : 'border-zinc-700'}"
							disabled={expandingId !== null}
							onclick={() => void pickCandidate(c.id)}
						>
							{#if c.thumb}
								<img src={c.thumb} alt="" class="h-12 w-12 rounded object-cover" />
							{:else}
								<div class="flex h-12 w-12 items-center justify-center rounded bg-zinc-800 text-xl">💿</div>
							{/if}
							<span class="min-w-0">
								<span class="block truncate font-medium">{c.title}</span>
								<span class="block text-xs opacity-60">
									{c.year ?? '????'} · {c.catno ?? ''} {expandingId === c.id ? '…loading' : ''}
								</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if expandError}<p class="text-sm text-red-400">{expandError}</p>{/if}
		</section>
	{:else if data.lookupError === null}
		<p class="rounded-lg bg-zinc-800/60 p-3 text-sm">
			No Discogs results for this barcode — fill in the details below manually.
		</p>
	{:else}
		<p class="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-400">
			Discogs lookup: {data.lookupError} You can still add this record manually below.
		</p>
	{/if}

	{#if duplicate}
		<div class="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
			<span>
				Already saved as <strong>{duplicate.artist} — {duplicate.title}</strong> (same barcode or Discogs ID).
			</span>
			<form method="POST" class="ml-auto flex gap-2">
				<input type="hidden" name="op" value="add_copy" />
				<input type="hidden" name="record_id" value={duplicate.id} />
				<button class="rounded bg-red-500/90 px-3 py-1 font-medium text-white">+ Add copy</button>
			</form>
			<button
				class="rounded border border-zinc-600 px-3 py-1"
				onclick={() => {
					createAnyway = true;
					duplicate = null;
				}}
			>
				Create anyway (different pressing)
			</button>
		</div>
	{/if}

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

	<p class="text-xs opacity-50">
		Tip: the cover image is downloaded and stored locally on save (when available on Discogs), so your
		collection stays browsable offline.
	</p>
</div>
