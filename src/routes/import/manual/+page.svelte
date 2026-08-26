<script lang="ts">
	import { enhance } from '$app/forms';
	import RecordForm from '$lib/components/RecordForm.svelte';
	import { emptyDraft } from '$lib/draft';
	import type { RecordDraft } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();
	let draft: RecordDraft = $state(emptyDraft());
	let duplicate = $state<{ id: number; artist: string; title: string } | null>(null);
	let createAnyway = $state(false);

	if (form?.error) duplicate = null; // fresh error state resets the banner
</script>

<div class="mx-auto max-w-3xl space-y-6 p-6">
	<h1 class="text-2xl font-bold">Add record manually</h1>
	<p class="text-sm opacity-70">
		No barcode or Discogs needed — type whatever you know. Everything is stored locally.
	</p>

	{#if form?.error}
		<p class="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{form.error}</p>
	{/if}

	{#if duplicate}
		<div class="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
			<span>
				Already saved as <strong>{duplicate.artist} — {duplicate.title}</strong> (same barcode).
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
					return;
				}
				update();
			}
		}
	>
		<input type="hidden" name="op" value={createAnyway ? 'create_anyway' : 'save'} />
		<RecordForm bind:draft submitLabel="Save to my collection" />
	</form>
</div>
