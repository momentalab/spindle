<script lang="ts">
	import { CONDITIONS, RECORD_STATUSES, STATUS_LABELS } from '$lib/types';
	import type { RecordDraft } from '$lib/types';

	let { draft = $bindable(null), submitLabel = 'Save' }: {
		draft: RecordDraft | null;
		submitLabel?: string;
	} = $props();

	const fieldClass =
		'w-full rounded-lg border border-zinc-700 bg-transparent px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none';
	const labelClass = 'mb-1 block text-xs font-medium uppercase tracking-wide opacity-70';
</script>

{#if draft}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- identity -->
		<div>
			<label class={labelClass} for="f-artist">Artist *</label>
			<input id="f-artist" class={fieldClass} bind:value={draft.artist} />
		</div>
		<div>
			<label class={labelClass} for="f-title">Title *</label>
			<input id="f-title" class={fieldClass} bind:value={draft.title} />
		</div>

		<!-- discogs-sourced metadata -->
		<div>
			<label class={labelClass} for="f-genre">Genre</label>
			<input id="f-genre" class={fieldClass} bind:value={draft.genre} />
		</div>
		<div>
			<label class={labelClass} for="f-style">Style</label>
			<input id="f-style" class={fieldClass} bind:value={draft.style} />
		</div>

		<div>
			<label class={labelClass} for="f-year">Year</label>
			<input id="f-year" class={fieldClass} bind:value={draft.year} />
		</div>
		<div>
			<label class={labelClass} for="f-label">Label</label>
			<input id="f-label" class={fieldClass} bind:value={draft.label} />
		</div>

		<div>
			<label class={labelClass} for="f-format">Format</label>
			<input id="f-format" class={fieldClass} bind:value={draft.format} />
		</div>
		<div>
			<label class={labelClass} for="f-barcode">Barcode</label>
			<input id="f-barcode" inputmode="numeric" class={fieldClass} bind:value={draft.barcode} />
		</div>

		<!-- condition + acquisition -->
		<div>
			<label class={labelClass} for="f-cond-media">Condition (media)</label>
			<select id="f-cond-media" class={fieldClass} bind:value={draft.condition_media}>
				<option value="">—</option>
				{#each CONDITIONS as c}<option value={c}>{c}</option>{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="f-cond-sleeve">Condition (sleeve)</label>
			<select id="f-cond-sleeve" class={fieldClass} bind:value={draft.condition_sleeve}>
				<option value="">—</option>
				{#each CONDITIONS as c}<option value={c}>{c}</option>{/each}
			</select>
		</div>

		<div>
			<label class={labelClass} for="f-price">Price paid (USD)</label>
			<input
				id="f-price"
				type="number"
				step="0.01"
				min="0"
				class={fieldClass}
				bind:value={draft.price_paid}
			/>
		</div>
		<div>
			<label class={labelClass} for="f-acquired">Acquired on</label>
			<input id="f-acquired" type="date" class={fieldClass} bind:value={draft.acquired_at} />
		</div>

		<!-- status + misc -->
		<div>
			<label class={labelClass} for="f-status">Status</label>
			<select id="f-status" class={fieldClass} bind:value={draft.status}>
				{#each RECORD_STATUSES as s}<option value={s}>{STATUS_LABELS[s]}</option>{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="f-source">Source / where from</label>
			<input id="f-source" class={fieldClass} bind:value={draft.source} />
		</div>

		<div class="flex items-center gap-2 pt-1">
			<input
				id="f-limited"
				type="checkbox"
				class="h-4 w-4 accent-emerald-500"
				bind:checked={draft.limited_edition}
			/>
			<label for="f-limited" class="text-sm">Limited edition</label>
		</div>

		<!-- custom / free-form -->
		<div class="sm:col-span-2">
			<label class={labelClass} for="f-notes">Notes (anything you want remembered)</label>
			<textarea id="f-notes" rows="3" class={fieldClass} bind:value={draft.notes}></textarea>
		</div>

		<!-- hidden carriers -->
		<input type="hidden" name="discogs_id" value={draft.discogs_id} />
		<input type="hidden" name="cover_url" value={draft.cover_url} />
		{#if draft.source === 'discogs'}
			<p class="sm:col-span-2 text-xs opacity-60">
				Sourced from Discogs — edit any field; your changes are stored locally and will not be
				overwritten by Discogs.
			</p>
		{/if}
	</div>

	<div class="mt-6 flex gap-3">
		<button type="submit" class="rounded-lg bg-emerald-600 px-5 py-2 font-medium hover:bg-emerald-500">
			{submitLabel}
		</button>
	</div>
{/if}
