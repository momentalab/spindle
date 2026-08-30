<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import Banner from "$lib/components/ui/Banner.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Input from "$lib/components/ui/Input.svelte";
	import { appTitle } from "$lib/index";

	type NativeDetector = {
		detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
	};
	type NativeCtor = new (opts: { formats?: string[] }) => NativeDetector;

	let videoEl: HTMLVideoElement | undefined = $state();
	let scanning = $state(false);
	let engine = $state<"native" | "zxing" | null>(null);
	let error = $state<string | null>(null);
	let manual = $state("");

	let stream: MediaStream | undefined;
	let nativeDetector: NativeDetector | undefined;
	let zxingControls: { stop: () => void } | undefined;
	let frameLoopActive = false;
	let done = false; // set true once we navigate away so loops bail out

	// Numeric values of BarcodeFormat.EAN_13 (7) and UPC_A (14) from @zxing/library.
	// Kept as raw numbers so the constants don't require a top-level import of the
	// CJS package (which breaks Vite SSR); the real enum is used via the dynamic import below.
	const ZXING_FORMATS: readonly number[] = [7, 14];
	const NATIVE_FORMATS = ["ean_13", "upc_a"];

	function getNativeDetector(): NativeDetector | undefined {
		const Ctor = (globalThis as Record<string, unknown>).BarcodeDetector as
			| NativeCtor
			| undefined;
		if (!Ctor) return undefined;
		try {
			return new Ctor({ formats: NATIVE_FORMATS });
		} catch {
			return undefined;
		}
	}

	function handleCode(rawValue: string | undefined): void {
		if (done || !rawValue) return;
		const digits = rawValue.replace(/\D+/g, "");
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
				video: { facingMode: "environment" },
				audio: false,
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
			engine = "native";
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
		engine = "zxing";
		try {
			const browser = await import("@zxing/browser");
			const library = await import("@zxing/library");
			const hints = new Map();
			hints.set(library.DecodeHintType.POSSIBLE_FORMATS, [...ZXING_FORMATS]);
			hints.set(library.DecodeHintType.TRY_HARDER, true);
			const reader = new browser.BrowserCodeReader(
				new library.MultiFormatReader(),
				hints,
			);
			scanning = true;
			zxingControls = await reader.decodeFromVideoDevice(
				undefined,
				videoEl,
				(result) => {
					if (result) handleCode(result.getText());
				},
			);
		} catch (e) {
			stop();
			error = e instanceof Error ? e.message : "ZXing scan failed to start.";
		}
	}

	function submitManual(): void {
		const digits = manual.replace(/\D+/g, "");
		if (digits.length === 12 || digits.length === 13)
			goto(`/import/barcode/${digits}`);
	}

	onMount(() => {
		void start();
		return stop;
	});
</script>

<svelte:head><title>{appTitle("Scan")}</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<!-- page head -->
	<header class="border-b border-edge pb-7">
		<h1
			class="font-display text-5xl font-normal leading-[1.05] tracking-[-.01em]"
		>
			Scan a barcode.
		</h1>
		<p class="mt-3 max-w-xl font-display text-[15px] italic text-muted">
			Point your camera at the EAN-13 / UPC-A on the back of the record sleeve.
			Works best in bright light with the code flat and filling the frame.
		</p>
	</header>

	<!-- viewer -->
	<div
		class="relative mt-8 overflow-hidden rounded-xs border border-edge bg-surface-2"
	>
		<video
			bind:this={videoEl}
			class="block aspect-4/3 w-full object-cover"
			muted
			playsinline
		></video>

		{#if scanning && engine}
			<!-- corner-bracket scan frame — hairline gold -->
			<div
				class="pointer-events-none absolute inset-0 flex items-center justify-center"
			>
				<div class="relative h-44 w-full max-w-xs">
					<span
						class="absolute left-0 top-0 h-8 w-8 rounded-tl-xs border-l-2 border-t-2 border-accent"
						aria-hidden="true"
					></span>
					<span
						class="absolute right-0 top-0 h-8 w-8 rounded-tr-xs border-r-2 border-t-2 border-accent"
						aria-hidden="true"
					></span>
					<span
						class="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xs border-b-2 border-l-2 border-accent"
						aria-hidden="true"
					></span>
					<span
						class="absolute bottom-0 right-0 h-8 w-8 rounded-br-xs border-b-2 border-r-2 border-accent"
						aria-hidden="true"
					></span>
					<span
						class="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 animate-pulse bg-accent/60"
						aria-hidden="true"
					></span>
				</div>
			</div>
			<div class="absolute bottom-3 right-3">
				<Badge tone={engine === "native" ? "forest" : "plum"}>
					{engine === "native" ? "native decoder" : "ZXing decoder"}
				</Badge>
			</div>
		{:else if !error}
			<div
				class="absolute inset-0 flex items-center justify-center bg-paper/85"
			>
				<Button onclick={() => void start()}>Start camera</Button>
			</div>
		{/if}
	</div>

	{#if error}
		<div class="mt-6"><Banner variant="warn">{error}</Banner></div>
	{/if}

	<!-- manual entry — a single elegant line -->
	<form
		class="mt-10 flex items-end gap-5 border-b border-hair pb-4"
		onsubmit={(e) => {
			e.preventDefault();
			submitManual();
		}}
	>
		<label class="min-w-0 flex-1">
			<span
				class="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
			>
				…or type a barcode (12–13 digits)
			</span>
			<Input
				bind:value={manual}
				inputmode="numeric"
				placeholder="8 43176 145012"
				class="font-display text-[19px] italic"
			/>
		</label>
		<Button type="button" variant="secondary">Look up</Button>
	</form>

	<p class="mt-8 text-center">
		<a
			href="/import/manual"
			class="text-[11.5px] uppercase tracking-[.2em] text-faint underline underline-offset-4 transition-colors hover:text-accent"
		>
			no barcode? enter details manually →
		</a>
	</p>
</div>

<style>
	video {
		transform: scaleX(-1);
	}
</style>
