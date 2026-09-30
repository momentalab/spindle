/**
 * Client-side image helpers for uploads (photos + cover override).
 *
 * Browser-only: everything here touches URL/Image/canvas, so it must only be
 * imported from code paths that run in the browser.
 */

export function loadImage(file: File): Promise<{ url: string; el: HTMLImageElement }> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => resolve({ url, el: img });
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error(`${file.name} isn't a readable image`));
		};
		img.src = url;
	});
}

/**
 * Re-encode to JPEG at maxSide (long edge) before upload, stepping quality —
 * then width — down until under targetBytes. Falls back to the original File
 * when it isn't a decodable image or compression can't get there.
 */
export async function downscale(file: File, maxSide: number, targetBytes?: number): Promise<File> {
	let source: { url: string; el: HTMLImageElement };
	try {
		source = await loadImage(file);
	} catch (e) {
		throw e; // unreadable image — surfaced as the upload error
	}
	const { url, el } = source;
	try {
		const scale = Math.min(1, maxSide / Math.max(el.naturalWidth, el.naturalHeight));
		const alreadySmall = scale === 1 && file.type === 'image/jpeg' && (!targetBytes || file.size <= targetBytes);
		if (alreadySmall) return file;
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(el.naturalWidth * scale));
		canvas.height = Math.max(1, Math.round(el.naturalHeight * scale));
		const ctx = canvas.getContext('2d');
		if (!ctx) return file;
		// White fill so transparent PNGs become white, not black, JPEGs.
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
		const toJpeg = (q: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
		const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
		const limit = targetBytes ?? Infinity;
		for (const q of [0.85, 0.72, 0.55]) {
			const blob = await toJpeg(q);
			if (!blob) break;
			const out = new File([blob], name, { type: 'image/jpeg' });
			if (out.size <= limit) return out;
		}
		// Still over budget — halve the width a couple of times before giving up.
		let side = Math.round(maxSide / 2);
		while (side >= 400) {
			canvas.width = side;
			canvas.height = Math.max(1, Math.round(side * (el.naturalHeight / el.naturalWidth)));
			ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
			const blob = await toJpeg(0.55);
			if (!blob) break;
			const out = new File([blob], name, { type: 'image/jpeg' });
			if (out.size <= limit) return out;
			side = Math.round(side / 2);
		}
		return file; // let the server-side cap be the final arbiter
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function fmtSize(bytes: number): string {
	return bytes >= 1024 * 1024
		? `${(bytes / 1024 / 1024).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
