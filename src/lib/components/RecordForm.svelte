<script lang="ts">
	import { CONDITIONS, RECORD_STATUSES, STATUS_LABELS } from '$lib/types';
	import type { RecordDraft } from '$lib/types';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';

	let { draft = $bindable(null), submitLabel = 'Save' }: {
		draft: RecordDraft | null;
		submitLabel?: string;
	} = $props();
</script>

{#if draft}
	<div class="space-y-8">
		<!-- Release -->
		<section>
			<h3 class="mb-3 font-display text-sm font-black uppercase tracking-widest text-plum">Release</h3>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Input id="f-artist" name="artist" label="Artist" required bind:value={draft.artist} />
				<Input id="f-title" name="title" label="Title" required bind:value={draft.title} />
				<Input id="f-genre" name="genre" label="Genre" bind:value={draft.genre} />
				<Input id="f-style" name="style" label="Style" bind:value={draft.style} />
				<Input id="f-year" name="year" label="Year" bind:value={draft.year} />
				<Input id="f-label" name="label" label="Label" bind:value={draft.label} />
				<Input id="f-format" name="format" label="Format" placeholder="e.g. Vinyl, LP, Album" bind:value={draft.format} />
				<Input id="f-barcode" name="barcode" label="Barcode" inputmode="numeric" bind:value={draft.barcode} />
			</div>
		</section>

		<!-- Condition & purchase -->
		<section>
			<h3 class="mb-3 font-display text-sm font-black uppercase tracking-widest text-plum">Condition & purchase</h3>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Select id="f-cond-media" name="condition_media" label="Condition (media)" bind:value={draft.condition_media}>
					<option value="">—</option>
					{#each CONDITIONS as c}<option value={c}>{c}</option>{/each}
				</Select>
				<Select id="f-cond-sleeve" name="condition_sleeve" label="Condition (sleeve)" bind:value={draft.condition_sleeve}>
					<option value="">—</option>
					{#each CONDITIONS as c}<option value={c}>{c}</option>{/each}
				</Select>
				<Input id="f-price" name="price_paid" type="number" step="0.01" min="0" label="Price paid (USD)" bind:value={draft.price_paid} />
				<Input id="f-acquired" name="acquired_at" type="date" label="Acquired on" bind:value={draft.acquired_at} />
				<Select id="f-status" name="status" label="Status" bind:value={draft.status}>
					{#each RECORD_STATUSES as s}<option value={s}>{STATUS_LABELS[s]}</option>{/each}
				</Select>
				<Input id="f-source" name="source" label="Source / where from" bind:value={draft.source} />
			</div>
		</section>

		<!-- More -->
		<section>
			<h3 class="mb-3 font-display text-sm font-black uppercase tracking-widest text-plum">More</h3>
			<div class="space-y-4">
				<label class="card-pop-sm flex w-fit cursor-pointer items-center gap-2.5 rounded-full border-2 border-edge bg-surface px-4 py-2 shadow-brutal-sm select-none">
					<input
						type="checkbox"
						name="limited_edition"
						id="f-limited"
						class="h-4 w-4 accent-(--plum)"
						bind:checked={draft.limited_edition}
					/>
					<span class="text-sm font-semibold">Limited edition</span>
				</label>

				<Textarea
					id="f-notes"
					name="notes"
					label="Notes (anything you want remembered)"
					rows={3}
					bind:value={draft.notes}
				/>
			</div>
		</section>

		<!-- hidden carriers -->
		<input type="hidden" name="discogs_id" value={draft.discogs_id} />
		<input type="hidden" name="cover_url" value={draft.cover_url} />
		{#if draft.source === 'discogs'}
			<p class="rounded-xl border-2 border-plum/40 bg-plum-soft p-3 text-xs font-medium">
				Sourced from Discogs — edit any field; your changes are stored locally and will not be
				overwritten by Discogs.
			</p>
		{/if}
	</div>

	<div class="mt-8">
		<button type="submit" class="card-pop-sm inline-flex items-center justify-center gap-1.5 rounded-full border-2 border-edge bg-plum px-6 py-3 text-base font-semibold text-plum-contrast shadow-brutal-sm transition-all duration-300 hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
			{submitLabel}
		</button>
	</div>
{/if}
