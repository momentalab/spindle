/**
 * Minimal typing for fontkit — the package ships no declarations, and its
 * default entry resolves to an untyped browser build. Only the surface the
 * catalogue measurement uses is declared.
 */
declare module 'fontkit' {
	export interface FontLayout {
		/** Kerned advance sum in font units (design space, not scaled by size). */
		advanceWidth: number;
	}
	export interface Font {
		unitsPerEm: number;
		layout(text: string, options?: { size?: number }): FontLayout;
	}
	/** Async factory — the TTF parser is WASM-backed in this build. */
	export function create(buffer: Buffer | Uint8Array): Promise<Font>;
}
