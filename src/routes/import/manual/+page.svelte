<script lang="ts">
	import { enhance } from '$app/forms';
	import RecordForm from '$lib/components/RecordForm.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { emptyDraft } from '$lib/draft';
	import type { RecordDraft } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();
	let draft: RecordDraft = $state(emptyDraft());
	let duplicate = $state<{ id: number; artist: string; title: string } | null>(null);
	let createAnyway = $state(false);

	if (form?.error) duplicate = null; // fresh error state resets the banner
</script>

<svelte:head><title>Add record manually · mynyl</title></svelte:head>

<div class="space-y-6">
	<header class="space-y-1">
		<h1 class="font-display text-3xl font-black tracking-tight">Add record manually</h1>
		<p class="text-sm text-muted">
			No barcode or Discogs needed — type whatever you know. Everything is stored locally.
		</p>
	</header>

	{#if form?.error}
		<Banner variant="error">{form.error}</Banner>
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
			Already saved as <strong>{duplicate.artist} — {duplicate.title}</strong> (same barcode).
		</Banner>
	{/if}

	<Card shadow class="p-4 sm:p-6">
		<form
			method="POST"
			class="space-y-6"
			use:enhance={() =>
				async ({ result, update }) => {
					if (result && 'data' in result && result.data?.duplicate) {
						duplicate = result.data.duplicate as typeof duplicate;
						return; // stay on the page, show the dedupe banner
					}
					update();
				}
			}
		>
			<input type="hidden" name="op" value={createAnyway ? 'create_anyway' : 'save'} />
			<RecordForm bind:draft submitLabel="Save to my collection" />
		</form>
	</Card>
</div>
