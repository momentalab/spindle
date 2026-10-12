<script lang="ts">
	import { enhance } from '$app/forms';
	import RecordForm from '$lib/components/RecordForm.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { draftFromSeed, emptyDraft } from '$lib/draft';
	import { appTitle } from '$lib/index';
	import { DISCOGS_LINK_ATTRS, discogsReleaseUrl } from '$lib/discogs';
	import type { DiscogsSeed, RecordDraft } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	let draft: RecordDraft = $state(emptyDraft());
	// status rides the dedupe payload so a wanted row offers "Mark as acquired"
	// (F5) instead of another copy.
	let duplicate = $state<{
		id: number;
		artist: string;
		title: string;
		status?: string;
	} | null>(null);

	// Keep the form in sync with server-provided state (initial seed, and a fresh
	// dedupe result that lands via `form` after non-enhanced submissions).
	let seededFor: DiscogsSeed | undefined;
	$effect(() => {
		const seed = data.seed; // reactive read
		if (seed && seed !== seededFor) {
			draft = draftFromSeed(seed);
			seededFor = seed;
		}
		if (form?.duplicate) duplicate = form.duplicate;
	});
	let createAnyway = $state(false);
</script>

<svelte:head><title>{appTitle('Add record')}</title></svelte:head>

<!-- page head -->
<header class="flex flex-wrap items-end justify-between gap-6 border-b border-edge pb-7">
	<div>
		<h1 class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em]">Add a record.</h1>
	</div>
	<div class="shrink-0 text-right">
		<p class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint">Release</p>
		<p class="mt-1.5 font-display text-[26px] italic text-muted">
			<a
				href={discogsReleaseUrl(data.id) ?? '#'}
				{...DISCOGS_LINK_ATTRS}
				class="underline-offset-4 transition-colors hover:text-accent hover:underline"
			>
				{data.id}
			</a>
		</p>
	</div>
</header>

{#if data.existing}
	{@const existing = data.existing}
	<div class="mt-8">
		<Banner variant={existing.status === 'wanted' ? 'info' : 'warn'}>
			{#snippet actions()}
				{#if existing.status === 'wanted'}
					<!-- F5 — found it at the shop: flip the want into the collection. -->
					<form method="POST" class="inline">
						<input type="hidden" name="op" value="acquire" />
						<input type="hidden" name="record_id" value={existing.id} />
						<Button type="submit" size="sm">Mark as acquired</Button>
					</form>
				{:else}
					<form method="POST" class="inline">
						<input type="hidden" name="op" value="add_copy" />
						<input type="hidden" name="record_id" value={existing.id} />
						<Button type="submit" size="sm" variant="secondary">Add another copy</Button>
					</form>
				{/if}
			{/snippet}
			{#if existing.status === 'wanted'}
				On your wishlist:
			{:else}
				Already in your collection:
			{/if}
			<a href="/records/{existing.id}" class="underline underline-offset-4 transition-colors hover:text-accent">
				{existing.artist} — {existing.title}
			</a>
			{#if existing.status !== 'wanted'}
				({existing.copies} cop{existing.copies === 1 ? 'y' : 'ies'})
			{:else}
				— on your wishlist, not owned yet.
			{/if}
		</Banner>
	</div>
{/if}

{#if data.lookupError !== null}
	<div class="mt-8">
		<Banner variant="warn">Discogs lookup: {data.lookupError} You can still add this record manually below.</Banner>
	</div>
{/if}

{#if duplicate}
	{@const dup = duplicate}
	<div class="mt-6">
		<Banner variant="error">
			{#snippet actions()}
				{#if dup.status === 'wanted'}
					<form method="POST" class="inline">
						<input type="hidden" name="op" value="acquire" />
						<input type="hidden" name="record_id" value={dup.id} />
						<Button type="submit" size="sm">Mark as acquired</Button>
					</form>
				{:else}
					<form method="POST" class="inline">
						<input type="hidden" name="op" value="add_copy" />
						<input type="hidden" name="record_id" value={dup.id} />
						<Button type="submit" size="sm">Add copy</Button>
					</form>
				{/if}
				<Button
					size="sm"
					variant="secondary"
					onclick={() => {
						createAnyway = true;
						duplicate = null;
					}}
				>
					Create anyway
				</Button>
			{/snippet}
			Already saved as <strong>{duplicate.artist} — {duplicate.title}</strong> (same barcode or Discogs ID).
		</Banner>
	</div>
{/if}

<div class="mt-10">
	{#if form?.error}<div class="mb-8">
			<Banner variant="error">{form.error}</Banner>
		</div>{/if}
	<form
		method="POST"
		use:enhance={() =>
			async ({ result, update }) => {
				if (result && 'data' in result && result.data?.duplicate) {
					duplicate = result.data.duplicate as typeof duplicate;
					return; // stay on the page, show the dedupe banner
				}
				update(); // default behavior → follow 303 redirect on success
			}}
	>
		<input type="hidden" name="op" value={createAnyway ? 'create_anyway' : 'save'} />
		<!-- F5 — saving a want goes to the wishlist, not the shelf. -->
		<RecordForm bind:draft submitLabel={draft.status === 'wanted' ? 'Save to wishlist' : 'Save to my collection'} />
	</form>
</div>

<p class="mt-10 font-display text-[13px] italic text-faint">
	Cover artwork is saved with the record when it's available on Discogs.
</p>
