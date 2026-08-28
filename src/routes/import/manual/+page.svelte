<script lang="ts">
	import { enhance } from "$app/forms";
	import RecordForm from "$lib/components/RecordForm.svelte";
	import Banner from "$lib/components/ui/Banner.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { emptyDraft } from "$lib/draft";
	import type { RecordDraft } from "$lib/types";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData | null } = $props();
	let draft: RecordDraft = $state(emptyDraft());
	let duplicate = $state<{ id: number; artist: string; title: string } | null>(
		null,
	);
	let createAnyway = $state(false);

	// A fresh action result (error from a new submit) dismisses the stale duplicate banner.
	$effect(() => {
		if (form?.error) duplicate = null;
	});
</script>

<svelte:head><title>Add record manually · mynyl</title></svelte:head>

<!-- page head -->
<header class="border-b border-edge pb-7">
	<h1
		class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em]"
	>
		Add a record.
	</h1>
	<p class="mt-3 max-w-xl font-display text-[15px] italic text-muted">
		No barcode or Discogs needed — type whatever you know.
	</p>
</header>

{#if form?.error}
	<div class="mt-8"><Banner variant="error">{form.error}</Banner></div>
{/if}

{#if duplicate}
	{@const dup = duplicate}
	<div class="mt-6">
		<Banner variant="error">
			{#snippet actions()}
				<form method="POST" class="inline">
					<input type="hidden" name="op" value="add_copy" />
					<input type="hidden" name="record_id" value={dup.id} />
					<Button type="submit" size="sm">Add copy</Button>
				</form>
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
			Already saved as <strong>{duplicate.artist} — {duplicate.title}</strong> (same
			barcode).
		</Banner>
	</div>
{/if}

<div class="mt-10">
	<form
		method="POST"
		use:enhance={() =>
			async ({ result, update }) => {
				if (result && "data" in result && result.data?.duplicate) {
					duplicate = result.data.duplicate as typeof duplicate;
					return; // stay on the page, show the dedupe banner
				}
				update();
			}}
	>
		<input
			type="hidden"
			name="op"
			value={createAnyway ? "create_anyway" : "save"}
		/>
		<RecordForm bind:draft submitLabel="Save to my collection" />
	</form>
</div>
