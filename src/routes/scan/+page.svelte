<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';

	type NativeDetector = {
		detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
	};
	type NativeCtor = new (opts: { formats?: string[] }) => NativeDetector;

	let videoEl: HTMLVideoElement | undefined = $state();
	let scanning = $state(false);
	let engine = $state<'native' | 'zxing' | null>(null);
	let error = $state<string | null>(null);
	let manual = $state('');

	let stream: MediaStream | undefined;
	let nativeDetector: NativeDetector | undefined;
	let zxingControls: { stop: () => void } | undefined;
	let frameLoopActive = false;
	let done = false; // set true once we navigate away so loops bail out

	// Numeric values of BarcodeFormat.EAN_13 (7) and UPC_A (14) from @zxing/library.
	// Kept as raw numbers so the constants don't require a top-level import of the
	// CJS package (which breaks Vite SSR); the real enum is used via the dynamic import below.
	const ZXING_FORMATS: readonly number[] = [7, 14];
	const NATIVE_FORMATS = ['ean_13', 'upc_a'];

	function getNativeDetector(): NativeDetector | undefined {
		const Ctor = (globalThis as Record<string, unknown>).BarcodeDetector as NativeCtor | undefined;
		if (!Ctor) return undefined;
		try {
			return new Ctor({ formats: NATIVE_FORMATS });
		} catch {
			return undefined;
		}
	}

	function handleCode(rawValue: string | undefined): void {
		if (done || !rawValue) return;
		const digits = rawValue.replace(/\D+/g, '');
		if (digits.length !== 12 && digits.length !== 13) return;
		done = true;
		stop();
		void goto(`/import/barcode/${digits}`);
	}

	function stop(): void {
		scanning = false;
		frameLoopActive = false;
		zxingControls?.stop();
		zxingControls = undefined;
		stream?.getTracks().forEach((t) => t.stop());
		stream = undefined;
		if (videoEl) videoEl.srcObject = null;
	}

	async function start(): Promise<void> {
		if (scanning) return;
		error = null;
		engine = null;

		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
		} catch {
			error =
				"Can't access the camera. Check permissions, or make sure you're on HTTPS/localhost. You can still type a barcode below.";
			return;
		}

		if (!videoEl) {
			stream.getTracks().forEach((t) => t.stop());
			stream = undefined;
			return;
		}

		videoEl.srcObject = stream;
		try {
			await videoEl.play();
		} catch {
			/* play() may reject on some platforms once; the frame loop still works */
		}

		const native = getNativeDetector();
		if (native) {
			engine = 'native';
			nativeDetector = native;
			scanning = true;
			frameLoopActive = true;
			const tick = () => {
				if (!frameLoopActive || done || !videoEl) return;
				void nativeDetector
					?.detect(videoEl)
					.then((results) => handleCode(results[0]?.rawValue))
					.catch(() => undefined);
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
			return;
		}

		// Fallback: ZXing — client-only dynamic import, never evaluated during SSR.
		engine = 'zxing';
		try {
			const browser = await import('@zxing/browser');
			const library = await import('@zxing/library');
			const hints = new Map();
			hints.set(library.DecodeHintType.POSSIBLE_FORMATS, [...ZXING_FORMATS]);
			hints.set(library.DecodeHintType.TRY_HARDER, true);
			const reader = new browser.BrowserCodeReader(new library.MultiFormatReader(), hints);
			scanning = true;
			zxingControls = await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
				if (result) handleCode(result.getText());
			});
		} catch (e) {
			stop();
			error = e instanceof Error ? e.message : 'ZXing scan failed to start.';
		}
	}

	function submitManual(): void {
		const digits = manual.replace(/\D+/g, '');
		if (digits.length === 12 || digits.length === 13) goto(`/import/barcode/${digits}`);
	}

	onMount(() => {
		void start();
		return stop;
	});
</script>

<svelte:head><title>Scan a barcode · mynyl</title></svelte:head>

<div class="mx-auto max-w-xl space-y-5">
	<header class="space-y-1">
		<h1 class="font-display text-3xl font-black tracking-tight">Scan a barcode</h1>
		<p class="text-sm text-muted">
			Point your camera at the EAN-13 / UPC-A on the back of the record sleeve. Works best in
			bright light with the code flat and filling the frame.
		</p>
	</header>

	<Card shadow class="relative overflow-hidden p-0">
		<div class="relative w-full bg-ink" style="aspect-ratio: 4/3;">
			<video bind:this={videoEl} class="h-full w-full object-cover" muted playsinline></video>

			{#if scanning && engine}
				<!-- corner-bracket scan frame -->
				<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div class="relative h-44 w-full max-w-xs">
						<span class="absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l-4 border-t-4 border-plum" aria-hidden="true"></span>
						<span class="absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r-4 border-t-4 border-plum" aria-hidden="true"></span>
						<span class="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b-4 border-l-4 border-plum" aria-hidden="true"></span>
						<span class="absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b-4 border-r-4 border-plum" aria-hidden="true"></span>
						<span class="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 animate-pulse bg-plum/70" aria-hidden="true"></span>
					</div>
				</div>
				<div class="absolute bottom-2 right-2">
					<Badge tone={engine === 'native' ? 'forest' : 'plum'}>
						{engine === 'native' ? 'native decoder' : 'ZXing decoder'}
					</Badge>
				</div>
			{:else if !error}
				<div class="absolute inset-0 flex items-center justify-center bg-surface-2/80">
					<Button onclick={() => void start()}>📷 Start camera</Button>
				</div>
			{/if}
		</div>
	</Card>

	{#if error}
		<Banner variant="warn">{error}</Banner>
	{/if}

	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			submitManual();
		}}
	>
		<Input
			bind:value={manual}
			inputmode="numeric"
			placeholder="…or type a barcode (12–13 digits)"
			class="flex-1"
		/>
		<Button type="button" onclick={submitManual}>Look up</Button>
	</form>

	<p class="text-center">
		<a href="/import/manual" class="text-sm font-semibold text-muted underline underline-offset-4 hover:text-plum">
			no barcode? enter details manually →
		</a>
	</p>
</div>

<style>
	video {
		transform: scaleX(-1);
	}
</style>
