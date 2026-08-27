<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';

	let { status }: { status: number } = $props();

	const titles: Record<number, string> = {
		400: 'Hmm, that was a bit off.',
		404: 'That record isn’t in the crate.',
		409: 'Looks like a duplicate.',
		413: 'That file is too big.',
		500: 'Something snapped.'
	};
</script>

<svelte:head><title>Error {status} · mynyl</title></svelte:head>

<div class="flex min-h-[50vh] items-center justify-center">
	<div class="w-full max-w-md text-center">
		<p class="mb-3 text-[10.5px] font-semibold uppercase tracking-[.24em] text-faint">Error No. {status}</p>
		<h1 class="font-display text-6xl font-normal leading-none">{titles[status] ?? 'Oops.'}</h1>
		<div class="mx-auto my-8 h-px w-14 bg-accent"></div>
		<p class="mb-9 font-display text-[15px] italic text-muted">
			Your collection is safe — this only affects the page you were trying to reach.
		</p>
		<div class="flex flex-wrap justify-center gap-4">
			<Button href="/" variant="primary">Back to collection</Button>
			<Button href="/scan" variant="secondary">Scan a record</Button>
		</div>
	</div>
</div>
