<script lang="ts">
	import {
		CONDITIONS,
		DISCOGS_GENRES,
		RECORD_STATUSES,
		STATUS_LABELS,
	} from "$lib/types";
	import type { RecordDraft } from "$lib/types";
	import Input from "$lib/components/ui/Input.svelte";
	import Select from "$lib/components/ui/Select.svelte";
	import Textarea from "$lib/components/ui/Textarea.svelte";

	let {
		draft = $bindable(null),
		submitLabel = "Save",
		sources = [],
	}: {
		draft: RecordDraft | null;
		submitLabel?: string;
		/** Existing purchase sources — offered as dropdown suggestions (typing new values stays allowed). */
		sources?: readonly string[];
	} = $props();
</script>

{#if draft}
	<div class="space-y-12">
		<!-- Release -->
		<section>
			<h3
				class="mb-6 border-b border-hair pb-3 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
			>
				Release
			</h3>
			<div class="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
				<Input
					id="f-artist"
					name="artist"
					label="Artist"
					required
					bind:value={draft.artist}
				/>
				<Input
					id="f-title"
					name="title"
					label="Title"
					required
					bind:value={draft.title}
				/>
				<!-- Datalist offers Discogs' top-level genres (incl. the one that
				     contains commas) so a completed value is spelled exactly as
				     Discogs has it; typing anything else stays free-form. -->
				<Input
					id="f-genre"
					name="genre"
					label="Genre"
					placeholder="e.g. Electronic, Pop"
					datalist={DISCOGS_GENRES}
					bind:value={draft.genre}
				/>
				<Input
					id="f-style"
					name="style"
					label="Style"
					placeholder="e.g. Jazz, Free Jazz"
					bind:value={draft.style}
				/>
				<Input id="f-year" name="year" label="Year" bind:value={draft.year} />
				<Input
					id="f-label"
					name="label"
					label="Label"
					placeholder="e.g. Warner Records (BS 2744)"
					bind:value={draft.label}
				/>
				<Input
					id="f-format"
					name="format"
					label="Format"
					placeholder="e.g. Vinyl, LP, Album"
					bind:value={draft.format}
				/>
				<Input
					id="f-barcode"
					name="barcode"
					label="Barcode"
					inputmode="numeric"
					bind:value={draft.barcode}
				/>
			</div>
		</section>

		<!-- Condition & purchase -->
		<section>
			<h3
				class="mb-6 border-b border-hair pb-3 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
			>
				Condition & purchase
			</h3>
			<div class="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
				<Select
					id="f-cond-media"
					name="condition_media"
					label="Condition (media)"
					bind:value={draft.condition_media}
				>
					<option value="">—</option>
					{#each CONDITIONS as c}<option value={c}>{c}</option>{/each}
				</Select>
				<Select
					id="f-cond-sleeve"
					name="condition_sleeve"
					label="Condition (sleeve)"
					bind:value={draft.condition_sleeve}
				>
					<option value="">—</option>
					{#each CONDITIONS as c}<option value={c}>{c}</option>{/each}
				</Select>
				<Input
					id="f-price"
					name="price_paid"
					type="number"
					step="0.01"
					min="0"
					label="Price paid (USD)"
					bind:value={draft.price_paid}
				/>
				<Input
					id="f-acquired"
					name="acquired_at"
					type="date"
					label="Acquired on"
					bind:value={draft.acquired_at}
				/>
				<Select
					id="f-status"
					name="status"
					label="Status"
					bind:value={draft.status}
				>
					{#each RECORD_STATUSES as s}<option value={s}
							>{STATUS_LABELS[s]}</option
						>{/each}
				</Select>
				<Input
					id="f-source"
					name="source"
					label="Source / where from"
					list="f-source-options"
					bind:value={draft.source}
				/>
				<!-- Existing sources as dropdown suggestions; free entry is still allowed. -->
				<datalist id="f-source-options">
					{#each sources as s (s)}
						<option value={s}></option>
					{/each}
				</datalist>
			</div>
			{#if draft.status === "wanted"}
				<p class="mt-4 font-display text-[13px] italic text-faint">
					price and condition can wait until it's on the shelf.
				</p>
			{/if}
		</section>

		<!-- More -->
		<section>
			<h3
				class="mb-6 border-b border-hair pb-3 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint"
			>
				More
			</h3>
			<div class="space-y-5">
				<!-- Numbered pressings: copy no. / total copies ride beside the limited
				     flag but are independent of it (a numbered reissue may not be
				     flagged limited). Both optional; parseRecordForm drops non-integers. -->
				<div class="flex flex-wrap items-end gap-x-10 gap-y-5">
					<label
						class="inline-flex cursor-pointer select-none items-center gap-3 pb-2 text-sm text-muted transition-colors hover:text-ink"
					>
						<input
							type="checkbox"
							name="limited_edition"
							id="f-limited"
							class="h-4 w-4 accent-accent"
							bind:checked={draft.limited_edition}
						/>
						<span>Limited edition</span>
					</label>
					<div class="w-24">
						<Input
							id="f-copy-number"
							name="copy_number"
							type="number"
							min="1"
							step="1"
							label="Copy no."
							bind:value={draft.copy_number}
						/>
					</div>
					<div class="w-28">
						<Input
							id="f-copy-total"
							name="copy_total"
							type="number"
							min="1"
							step="1"
							label="of (total)"
							bind:value={draft.copy_total}
						/>
					</div>
				</div>

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
		{#if draft.source === "discogs"}
			<p
				class="border-l-2 border-l-accent bg-surface px-4 py-3 text-xs text-muted"
			>
				Sourced from Discogs — edits you make here are yours; they won't be
				overwritten by a re-import.
			</p>
		{/if}
	</div>

	<div class="mt-10">
		<button
			type="submit"
			class="inline-flex items-center justify-center border border-ink bg-ink px-6.5 py-3 text-[12px] font-medium uppercase tracking-[.18em] text-paper transition-colors duration-300 hover:border-accent hover:bg-accent"
		>
			{submitLabel}
		</button>
	</div>
{/if}
