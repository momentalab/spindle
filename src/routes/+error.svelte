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
	<div class="w-full max-w-md space-y-6 text-center">
		<p class="font-display text-7xl font-black tracking-tight" style="color: var(--rust)">{status}</p>
		<h1 class="font-display text-2xl font-black tracking-tight">
			{titles[status] ?? 'Oops.'}
		</h1>
		<p class="text-sm text-muted">
			Your collection is safe — this only affects the page you were trying to reach.
		</p>
		<div class="flex justify-center gap-3">
			<Button href="/">← Back to collection</Button>
			<Button href="/scan" variant="secondary">Scan a record</Button>
		</div>
	</div>
</div>
