<script lang="ts">
	import './layout.css';
	import AppNav from '$lib/components/ui/AppNav.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<AppNav />
<main class="mx-auto min-h-[calc(100dvh-3.5rem)] w-full max-w-6xl px-4 py-6 sm:px-6">
	{@render children()}
</main>

<footer class="border-t-2 border-edge/15 py-6 text-center text-xs font-medium text-muted">
	mynyl — your records, on your machine.
</footer>
