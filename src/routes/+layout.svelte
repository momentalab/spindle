<script lang="ts">
	import './layout.css';
	import AppNav from '$lib/components/ui/AppNav.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<AppNav />
<main class="mx-auto min-h-[calc(100dvh-4.5rem)] w-full max-w-[1040px] px-7 pb-24 pt-14">
	{@render children()}
</main>

<footer class="border-t border-hair py-10 text-center">
	<p class="text-[11px] uppercase tracking-[.22em] text-faint">mynyl — your records, on your machine.</p>
</footer>
