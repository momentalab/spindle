/**
 * Printable catalogue (F12) — the shared page model every export surface renders.
 *
 *   - /print              the browser-paginated equivalent (CSS columns + print CSS)
 *   - catalogue-pdf.ts    pdfkit draw: real selectable text + embedded cover JPEGs
 *
 * The model is laid out in PDF points (1pt = 1/72in) on A4 portrait.
 *
 * Fixed ink-on-paper palette: an exported catalogue is a print artifact, so it
 * never follows the user's dark mode / color palettes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { create as createFont } from 'fontkit';
import sharp from 'sharp';
import { latestPlayedAt, listRecords, playCounts } from '$lib/server/records';
import { MEDIA_DIR } from '$lib/server/paths';
import { joinLabels, joinStyles, STATUS_LABELS, type RecordRow } from '$lib/types';

/* ---------------- geometry (points, A4 portrait) ---------------- */

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN_X = 56;
export const GUTTER = 28;
export const COL_W = (PAGE_W - MARGIN_X * 2 - GUTTER) / 2; // 227.64
export const COL1_X = MARGIN_X;
export const COL2_X = MARGIN_X + COL_W + GUTTER;

/** Where entry rows start: below the masthead on page 1, near the top after. */
export const FIRST_TOP = 150;
export const LATER_TOP = 64;
export const CONTENT_BOTTOM = 794;
export const ROW_H = 108;

/** Entry anatomy inside its cell (cell w = COL_W, h = ROW_H). */
export const COVER_SIZE = 72;
export const COVER_PAD = (ROW_H - COVER_SIZE) / 2; // vertically centered: 18
export const TEXT_X_OFF = COVER_SIZE + 10; // text block starts right of the cover
export const TEXT_W = COL_W - TEXT_X_OFF;

/** Text slots inside an index cell, offset from the cell top (7.5pt micro-lines). */
export const CELL_TITLE_Y1 = 13;
export const CELL_TITLE_Y2 = 27;
/** One-line titles pull the artist up so title + artist read as one group,
    with the spec micro-lines as a separate block below. */
export const CELL_ARTIST_Y_SINGLE = 32;
export const CELL_ARTIST_Y = 41;
export const CELL_YEARFORMAT_Y = 60;
export const CELL_LABEL_Y1 = 73;
export const CELL_LABEL_Y2 = 86;
export const CELL_CONDITION_Y = 98;

/** Detail pages (sequential flow): cover left, spec sheet right. */
export const DETAIL_COVER = 220;
export const DETAIL_COL_X = MARGIN_X + DETAIL_COVER + 32; // 308
export const DETAIL_COL_W = PAGE_W - 2 * MARGIN_X - DETAIL_COVER - 32; // 231.28
/** Content top — the first detail page yields to a quiet section header. */
export const DETAIL_TOP_FIRST = 104;
export const DETAIL_TOP = 64;
/** The small break between records: rule centred in the gap. */
export const DETAIL_BREAK = 28;
export const DETAIL_TITLE_LH = 26; // 18pt serif lines
export const DETAIL_ARTIST_LH = 19; // 12.5pt italic serif lines
/** One spec-sheet row: a 6.5pt label line, 9.5pt value line(s), then a gap. */
export const DETAIL_ROW_DT_H = 10;
export const DETAIL_ROW_DD_LH = 13;
export const DETAIL_ROW_GAP = 8;
export const DETAIL_NOTES_LH = 15; // 10.5pt notes lines
export const DETAIL_NOTES_PAD = 14;

const ROWS_FIRST = Math.floor((CONTENT_BOTTOM - FIRST_TOP) / ROW_H); // 5
const ROWS_LATER = Math.floor((CONTENT_BOTTOM - LATER_TOP) / ROW_H); // 6
export const CAPACITY_FIRST = ROWS_FIRST * 2; // 10 entries
export const CAPACITY_LATER = ROWS_LATER * 2; // 12 entries

/* ---------------- palette (the light/gold tokens, blended to solid hex) -------- */

export const PALETTE = {
	paper: '#f4efe5',
	surface: '#eae3d3',
	ink: '#1b1813',
	muted: '#6f675c',
	faint: '#948b7a',
	accent: '#8a6c33',
	/** --edge (ink @ 20%) pre-blended onto the paper. */
	edge: '#c6bfb6',
	/** --hair (ink @ 10%) pre-blended onto the paper. */
	hair: '#dedbc2'
} as const;

/* ---------------- page model ---------------- */

export type CatalogueCover = { kind: 'local'; filename: string } | { kind: 'remote'; url: string } | { kind: 'none' };

export interface CatalogueEntry {
	id: number;
	/** Quiet index number, '01', '02', … — the bound-catalogue numbering. */
	number: string;
	artist: string;
	titleLines: [string, string | null];
	/** Artist slot — CELL_ARTIST_Y_SINGLE under a one-line title, else CELL_ARTIST_Y. */
	artistY: number;
	yearFormat: string; // '1974 · 12" LP'
	/** Label(s) on their own line(s) — wrapped, never mid-word ellipsized. */
	labelLines: [string, string | null];
	condition: string; // 'VG+/VG+ · In collection · ×2 · Limited'
	cover: CatalogueCover;
}

/** A spec-sheet row with its value pre-wrapped and its slot pre-measured. */
export interface DetailRow {
	label: string;
	lines: string[]; // the value, wrapped to ≤3 lines
	dy: number; // offset of the label line from the block top
	height: number;
}

export interface CatalogueDetail {
	id: number;
	number: string;
	titleLines: string[]; // ≤3 @18pt serif
	artistLines: string[]; // ≤2 @12.5pt italic serif
	/** Spec sheet rows in the record page's order. */
	rows: DetailRow[];
	/** ≤12 @10.5pt lines — empty when the record has no notes. */
	notesLines: string[];
	/** Offsets from the block top (precomputed so every surface renders identically). */
	titleDy: number;
	artistDy: number;
	rowsDy: number;
	notesDy: number;
	/** Full block height — at least the cover, plus the notes when present. */
	height: number;
	cover: CatalogueCover;
}

export interface PlacedDetail extends CatalogueDetail {
	top: number; // absolute y of the block top within its page
	/** Hairline rule above the block (false for a page's first record). */
	breakBefore: boolean;
}

export interface CatalogueDetailPage {
	number: number; // 1-based within the detail section
	first: boolean;
	blocks: PlacedDetail[];
}

export interface PlacedEntry extends CatalogueEntry {
	x: number;
	y: number;
	/** Hairline rule under the cell (false on a column's last row). */
	rule: boolean;
}

export interface CataloguePage {
	number: number;
	first: boolean;
	entries: PlacedEntry[];
}

export interface Catalogue {
	pages: CataloguePage[]; // index pages
	detailPages: CatalogueDetailPage[]; // sequential record details
	total: number;
	monthYear: string; // 'October 2026' — the masthead meta line
}

/** Play stats for the detail pages, keyed by record id. */
export type CataloguePlays = Record<number, { count: number; lastPlayedAt: string | null }>;

/**
 * Measure text with the real bundled TTFs (fontkit — the same engine pdfkit
 * shapes with), so a line the model calls "one line" can never re-wrap in a
 * renderer. The old 0.5em-per-char estimate undershot Source Serif, and pdfkit
 * silently broke e.g. "Favourite Worst Nightmare" under a one-line layout —
 * landing the artist line on top of the title's second visual line.
 */
type MeasuredFont = Awaited<ReturnType<typeof createFont>>;
const measureReady = new Map<CatalogueFont, MeasuredFont>();

/**
 * Parse the wrapping faces once per process — fontkit's factory is async, so
 * every export entry point awaits this before its first buildCatalogue.
 */
export async function prepareMeasurement(): Promise<void> {
	for (const name of ['source-serif-4-400', 'source-serif-4-italic-400', 'archivo-400'] as const) {
		if (!measureReady.has(name)) measureReady.set(name, await createFont(readFont(name)));
	}
}

function measureFont(name: CatalogueFont): MeasuredFont {
	const f = measureReady.get(name);
	if (!f) throw new Error(`catalogue measurement not prepared for ${name}`);
	return f;
}
/**
 * Rendered width in pt: fontkit's Layout.advanceWidth is the kerned advance sum
 * in font units, so scale by size/unitsPerEm. (`.width` does not exist on this
 * fontkit build — it silently returns undefined and every wrap degenerates to
 * a single ellipsis.)
 */
const widthOf = (text: string, face: CatalogueFont, size: number) => {
	const f = measureFont(face);
	return f.layout(text).advanceWidth * (size / f.unitsPerEm);
};

/**
 * Greedy word wrap against measured widths. Shared by every surface so the PDF,
 * image, and print page all break identically; values wrap to ≤3 lines so a
 * field is never cut off mid-value.
 */
export function wrapText(
	text: string,
	face: CatalogueFont,
	size: number,
	maxWidth: number,
	maxLines: number
): string[] {
	const w = (s: string) => widthOf(s, face, size);
	/** `t` trimmed to the longest prefix that fits with a terminal ellipsis. */
	const fitEllipsized = (t: string): string => {
		if (w(t) <= maxWidth) return t;
		let lo = 0;
		let hi = t.length;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (w(`${t.slice(0, mid)}…`) <= maxWidth) lo = mid;
			else hi = mid - 1;
		}
		return `${t.slice(0, lo)}…`;
	};
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const lines: string[] = [];
	let cur = '';
	let i = 0;
	while (i < words.length && lines.length < maxLines) {
		const word = words[i];
		if (cur === '') {
			// A word longer than the whole line: hard-cut it (pathological case).
			cur = w(word) <= maxWidth ? word : fitEllipsized(word);
			i++;
		} else if (w(`${cur} ${word}`) <= maxWidth) {
			cur = `${cur} ${word}`;
			i++;
		} else {
			lines.push(cur);
			cur = '';
		}
	}
	if (cur !== '') lines.push(cur);
	if (i < words.length && lines.length > 0) {
		// Ran past maxLines: ellipsize the last line for the remainder.
		lines[lines.length - 1] = fitEllipsized(lines[lines.length - 1]);
	}
	return lines;
}

/** Two-line wrap for the index entries' title display. */
export function wrapTitle(title: string): [string, string | null] {
	const [l1, l2] = wrapText(title, 'source-serif-4-400', 11, TEXT_W, 2);
	return [l1 ?? '', l2 ?? null];
}

function coverOf(rec: RecordRow): CatalogueCover {
	return rec.cover_filename
		? { kind: 'local', filename: rec.cover_filename }
		: rec.cover_remote_url
			? { kind: 'remote', url: rec.cover_remote_url }
			: { kind: 'none' };
}

function toEntry(rec: RecordRow, index: number): CatalogueEntry {
	const yearFormat = [rec.year, rec.format].filter(Boolean).join(' · ');
	const [l1, l2] = wrapText(joinLabels(rec.labels), 'archivo-400', 7.5, TEXT_W, 2);
	const titleLines = wrapTitle(rec.title);
	const condition = [
		[rec.condition_media, rec.condition_sleeve].filter(Boolean).join('/'),
		STATUS_LABELS[rec.status],
		rec.copies > 1 ? `×${rec.copies}` : '',
		rec.limited_edition ? 'Limited' : ''
	]
		.filter(Boolean)
		.join(' · ');
	return {
		id: rec.id,
		number: String(index + 1).padStart(2, '0'),
		artist: rec.artist,
		titleLines,
		artistY: titleLines[1] ? CELL_ARTIST_Y : CELL_ARTIST_Y_SINGLE,
		yearFormat,
		labelLines: [l1 ?? '', l2 ?? null],
		condition,
		cover: coverOf(rec)
	};
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Deterministic 'Aug 30, 2026' — no toLocaleDateString (SSR/locale drift). */
export function fmtDate(iso: string | null): string {
	if (!iso) return '';
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!m) return '';
	const mon = Number(m[2]);
	const day = Number(m[3]);
	if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
	return `${MONTHS[mon - 1]} ${day}, ${m[1]}`;
}

/** Integer cents → '$15.99'. */
export function fmtPrice(cents: number | null): string {
	return cents == null ? '' : `$${(cents / 100).toFixed(2)}`;
}

/** Numbered pressing — `828 / 1000`, or `#828` when only the number exists. */
function copyDisplay(n: number | null, t: number | null): string {
	if (n === null && t === null) return '';
	if (n !== null && t !== null) return `${n} / ${t}`;
	if (n !== null) return `#${n}`;
	return `/ ${t}`;
}

function toDetail(
	rec: RecordRow,
	index: number,
	play: { count: number; lastPlayedAt: string | null } | undefined
): CatalogueDetail {
	// The record page's spec sheet, with absolute dates (a print artifact — no
	// "N days ago" drift). Rows appear in the record page's order; empty values
	// are skipped. Plays only when there is something to say. Values wrap onto
	// extra lines — a field is never cut off mid-value.
	const rows: DetailRow[] = [];
	let rowDy = 0;
	const addRow = (label: string, value: string) => {
		if (!value) return;
		const lines = wrapText(value, 'archivo-400', 9.5, DETAIL_COL_W, 3);
		rows.push({ label, lines, dy: rowDy, height: DETAIL_ROW_DT_H + lines.length * DETAIL_ROW_DD_LH + DETAIL_ROW_GAP });
		rowDy += DETAIL_ROW_DT_H + lines.length * DETAIL_ROW_DD_LH + DETAIL_ROW_GAP;
	};
	if (play && play.count > 0) addRow('Plays', `${play.count} · spun ${fmtDate(play.lastPlayedAt)}`);
	addRow('Year', rec.year ?? '');
	addRow('Genre', [rec.genres.join(', '), joinStyles(rec.styles)].filter(Boolean).join(' — '));
	addRow('Label', joinLabels(rec.labels));
	addRow('Format', rec.format ?? '');
	addRow('Barcode', rec.barcode ?? '');
	addRow(
		'Condition',
		[rec.condition_media && `media ${rec.condition_media}`, rec.condition_sleeve && `sleeve ${rec.condition_sleeve}`]
			.filter(Boolean)
			.join(' · ')
	);
	addRow('Price paid', fmtPrice(rec.price_paid));
	addRow('Sold', fmtDate(rec.sold_at));
	addRow('Sale price', fmtPrice(rec.sale_price));
	addRow('Acquired', fmtDate(rec.acquired_at));
	addRow('Source', rec.source ?? '');
	addRow('Wanted since', fmtDate(rec.wanted_at));
	addRow('Copy', copyDisplay(rec.copy_number, rec.copy_total));

	const titleLines = wrapText(rec.title, 'source-serif-4-400', 18, DETAIL_COL_W, 3);
	const artistLines = wrapText(rec.artist, 'source-serif-4-italic-400', 12.5, DETAIL_COL_W, 2);
	const notesLines = rec.notes
		? wrapText(rec.notes, 'archivo-400', 10.5, DETAIL_COL_W - 2 * DETAIL_NOTES_PAD - 8, 12)
		: [];

	// Block anatomy, measured from the block top: title, artist, rows, then the
	// notes block below whichever of cover/rows ends lower.
	const titleDy = 0;
	const artistDy = titleLines.length * DETAIL_TITLE_LH + 6;
	const rowsDy = artistDy + artistLines.length * DETAIL_ARTIST_LH + 14;
	rows.forEach((r) => (r.dy += rowsDy));
	const notesDy = Math.max(DETAIL_COVER, rowsDy + rowDy) + 14;
	const notesH = notesLines.length * DETAIL_NOTES_LH + 2 * DETAIL_NOTES_PAD;
	const height = Math.max(DETAIL_COVER, rowsDy + rowDy, notesLines.length > 0 ? notesDy + notesH : 0);

	return {
		id: rec.id,
		number: String(index + 1).padStart(2, '0'),
		titleLines,
		artistLines,
		rows,
		notesLines,
		titleDy,
		artistDy,
		rowsDy,
		notesDy,
		height,
		cover: coverOf(rec)
	};
}

/**
 * Play stats for the detail pages: one batched count query plus a last-play
 * lookup per record that has at least one play. Only non-zero records appear.
 */
export function recordPlays(recordIds: number[]): CataloguePlays {
	const counts = playCounts(recordIds);
	const out: CataloguePlays = {};
	for (const id of recordIds) {
		const count = counts[id] ?? 0;
		if (count > 0) out[id] = { count, lastPlayedAt: latestPlayedAt(id) };
	}
	return out;
}

/**
 * Lay the collection out: an index (two columns, filled column-major — the
 * reading order of a printed book; entries never span a page break; page 1
 * yields to the masthead) followed by the record details in a sequential flow
 * with a small rule between records. A record's block never spans a page.
 */
export function buildCatalogue(records: RecordRow[], plays: CataloguePlays = {}): Catalogue {
	const entries = records.map(toEntry);
	const details = records.map((rec, i) => toDetail(rec, i, plays[rec.id]));

	// Flow the detail blocks down the page: a block takes its measured height,
	// a rule-break separates siblings, and an unbroken block never splits.
	const detailPages: CatalogueDetailPage[] = [];
	let blocks: PlacedDetail[] = [];
	let y = DETAIL_TOP_FIRST;
	for (const d of details) {
		const gap = blocks.length > 0 ? DETAIL_BREAK : 0;
		if (blocks.length > 0 && y + gap + d.height > CONTENT_BOTTOM) {
			detailPages.push({ number: detailPages.length + 1, first: detailPages.length === 0, blocks });
			blocks = [];
			y = DETAIL_TOP;
		}
		const breakBefore = blocks.length > 0;
		if (breakBefore) y += DETAIL_BREAK;
		blocks.push({ ...d, top: y, breakBefore });
		y += d.height;
	}
	if (blocks.length > 0) {
		detailPages.push({ number: detailPages.length + 1, first: detailPages.length === 0, blocks });
	}
	const pages: CataloguePage[] = [];
	let page: CataloguePage | null = null;
	let col = 0;
	let row = 0;

	for (const entry of entries) {
		// The CURRENT page's capacity — the first page yields to the masthead, so it
		// holds fewer. (Not pages.length === 0: by the time page 1 is full that is
		// false and a 12th entry would overflow its 10 slots.)
		const capacity = page ? (page.first ? CAPACITY_FIRST : CAPACITY_LATER) : CAPACITY_FIRST;
		if (!page || page.entries.length >= capacity) {
			page = { number: pages.length + 1, first: pages.length === 0, entries: [] };
			pages.push(page);
			col = 0;
			row = 0;
		}
		const rowsThisCol = page.first ? ROWS_FIRST : ROWS_LATER;
		page.entries.push({
			...entry,
			x: col === 0 ? COL1_X : COL2_X,
			y: (page.first ? FIRST_TOP : LATER_TOP) + row * ROW_H,
			rule: row < rowsThisCol - 1
		});
		row++;
		if (row >= rowsThisCol) {
			col = 1;
			row = 0;
		}
	}

	const monthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	return { pages, detailPages, total: entries.length, monthYear };
}

/** The catalogue dataset: the collection shelf (wishlist excluded), index order. */
export function listCatalogueRecords(): RecordRow[] {
	return listRecords({ sort: 'artist', dir: 'asc', exclude_status: 'wanted' });
}

/* ---------------- fonts ---------------- */

const FONT_FILES = ['source-serif-4-400', 'source-serif-4-italic-400', 'archivo-400', 'archivo-600'] as const;
export type CatalogueFont = (typeof FONT_FILES)[number];

/**
 * The bundled TTFs live in static/fonts (adapter-node copies them to the build
 * output root, so production reads build/fonts). pdfkit needs real font files
 * — no woff2, no system stacks.
 */
export function fontPath(name: CatalogueFont): string {
	const dir =
		process.env.NODE_ENV === 'production'
			? path.join(process.cwd(), 'build', 'fonts')
			: path.join(process.cwd(), 'static', 'fonts');
	return path.join(dir, `${name}.ttf`);
}

export function readFont(name: CatalogueFont): Buffer {
	return readFileSync(fontPath(name));
}

/* ---------------- covers ---------------- */

export interface CoverImage {
	bytes: Buffer; // normalized JPEG
	width: number;
	height: number;
}

const COVER_FETCH_TIMEOUT_MS = 8000;
const COVER_MAX_EDGE = 900; // px — plenty for a 72pt box at any renderer scale

/**
 * Resolve an entry's cover to normalized JPEG bytes (long edge ≤ 900,
 * transparency flattened white). Every failure — missing file, dead remote URL,
 * undecodable bytes — degrades to `null` so one absent cover renders the
 * placeholder tile instead of sinking the whole export.
 */
export async function resolveCover(cover: CatalogueCover): Promise<CoverImage | null> {
	try {
		let raw: Buffer;
		if (cover.kind === 'local') {
			const p = path.join(MEDIA_DIR, cover.filename);
			if (!path.resolve(p).startsWith(path.resolve(MEDIA_DIR) + path.sep)) return null;
			raw = readFileSync(p);
		} else if (cover.kind === 'remote') {
			const res = await fetch(cover.url, { signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS) });
			if (!res.ok) return null;
			raw = Buffer.from(await res.arrayBuffer());
		} else {
			return null;
		}

		const img = sharp(raw, { animated: false }).rotate();
		const meta = await img.metadata();
		if (!meta.width || !meta.height) return null;
		const bytes = await img
			.resize({ width: COVER_MAX_EDGE, height: COVER_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
			.flatten({ background: { r: 255, g: 255, b: 255 } })
			.jpeg({ quality: 85 })
			.toBuffer();
		const outMeta = await sharp(bytes).metadata();
		return { bytes, width: outMeta.width!, height: outMeta.height! };
	} catch {
		return null;
	}
}
