<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

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

<div class="mx-auto max-w-xl space-y-6 p-6">
	<h1 class="text-2xl font-bold">Scan a barcode</h1>
	<p class="text-sm opacity-70">
		Point your camera at the EAN-13 / UPC-A on the back of the record sleeve. Works best in bright
		light with the code flat and filling the frame. {engine === 'native' ? '(using native camera decoding)' : engine === 'zxing' ? '(using in-browser ZXing decoder)' : ''}
	</p>

	<div class="relative overflow-hidden rounded-xl bg-black" style="aspect-ratio: 4/3;">
		<video bind:this={videoEl} class="h-full w-full object-cover" muted playsinline></video>
		{#if scanning && engine}
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
				<div class="h-40 w-full max-w-xs rounded border-2 border-white/80"></div>
			</div>
		{:else if !error}
			<div class="absolute inset-0 flex items-center justify-center">
				<button class="rounded-lg bg-white/90 px-4 py-2 font-medium" onclick={() => void start()}>
					📷 Start camera
				</button>
			</div>
		{/if}
	</div>

	{#if error}
		<p class="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
	{/if}

	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			submitManual();
		}}
	>
		<input
			bind:value={manual}
			inputmode="numeric"
			placeholder="…or type a barcode (12–13 digits)"
			class="flex-1 rounded-lg border border-zinc-700 bg-transparent px-3 py-2"
		/>
		<button class="rounded-lg bg-emerald-600 px-4 py-2 font-medium">Look up</button>
	</form>
</div>

<style>
	video {
		transform: scaleX(-1);
	}
</style>
