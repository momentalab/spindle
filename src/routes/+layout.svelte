<script lang="ts">
	import './layout.css';
	import AppNav from '$lib/components/ui/AppNav.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="shortcut icon" href="/favicon.ico" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
	<meta name="apple-mobile-web-app-title" content="Mynyl" />
	<link rel="manifest" href="/site.webmanifest" />
</svelte:head>

<AppNav />
<main class="mx-auto min-h-[calc(100dvh-4.5rem)] w-full max-w-[1040px] px-7 pb-24 pt-14">
	{@render children()}
</main>

<footer class="border-t border-hair py-10 text-center">
	<p class="text-[11px] uppercase tracking-[.22em] text-faint">mynyl — a vinyl index</p>
</footer>
