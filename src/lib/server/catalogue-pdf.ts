/**
 * Catalogue PDF renderer (F12) — draws the shared page model with pdfkit.
 *
 * Real text, not a flattened screenshot: every artist/title/spec line is an
 * embedded-font text run (selectable, searchable, copyable), covers are
 * embedded JPEGs. Deterministic pagination straight from buildCatalogue().
 *
 * The document is the index pages (two columns) followed by one detail page
 * per record: cover, wrapped title/artist, the record page's spec sheet, and
 * a notes block when the record has notes.
 */
import PDFDocument from 'pdfkit';
import {
	buildCatalogue,
	CELL_CONDITION_Y,
	CELL_LABEL_Y1,
	CELL_LABEL_Y2,
	CELL_TITLE_Y1,
	CELL_TITLE_Y2,
	CELL_YEARFORMAT_Y,
	COL_W,
	COVER_PAD,
	COVER_SIZE,
	DETAIL_ARTIST_LH,
	DETAIL_BREAK,
	DETAIL_COVER,
	DETAIL_COL_W,
	DETAIL_COL_X,
	DETAIL_NOTES_LH,
	DETAIL_NOTES_PAD,
	DETAIL_ROW_DD_LH,
	DETAIL_ROW_DT_H,
	DETAIL_TITLE_LH,
	fontPath,
	MARGIN_X,
	PAGE_H,
	PAGE_W,
	PALETTE,
	prepareMeasurement,
	resolveCover,
	ROW_H,
	TEXT_W,
	TEXT_X_OFF,
	type Catalogue,
	type CatalogueCover,
	type CatalogueDetailPage,
	type CataloguePlays,
	type CoverImage,
	type PlacedDetail,
	type PlacedEntry
} from './catalogue';
import type { RecordRow } from '$lib/types';

/** @types/pdfkit exposes the document as the global `PDFKit.PDFDocument` interface. */
type PDFDoc = PDFKit.PDFDocument;

const SERIF = fontPath('source-serif-4-400');
const SERIF_ITALIC = fontPath('source-serif-4-italic-400');
const ARCHIVO = fontPath('archivo-400');
const ARCHIVO_SEMI = fontPath('archivo-600');

/** Truncate to fit `maxWidth` with a terminal ellipsis (exact, measured). */
function fitText(doc: PDFDoc, text: string, font: string, size: number, maxWidth: number): string {
	doc.font(font).fontSize(size);
	if (doc.widthOfString(text) <= maxWidth) return text;
	let t = text;
	while (t.length > 1 && doc.widthOfString(`${t}…`) > maxWidth) t = t.slice(0, -1);
	return `${t}…`;
}

/** A cover in a square frame at (x, y): contain-fit, or the quiet vinyl tile. */
function drawCover(doc: PDFDoc, x: number, y: number, size: number, image: CoverImage | null): void {
	if (image) {
		const scale = Math.min(size / image.width, size / image.height);
		const w = image.width * scale;
		const h = image.height * scale;
		doc.image(image.bytes, x + (size - w) / 2, y + (size - h) / 2, { width: w, height: h });
	} else {
		doc.rect(x, y, size, size).fill(PALETTE.surface);
		doc
			.circle(x + size / 2, y + size / 2, size / 4.5)
			.strokeColor(PALETTE.hair)
			.lineWidth(1)
			.stroke();
		doc.circle(x + size / 2, y + size / 2, 2.5).fill(PALETTE.faint);
	}
	doc
		.rect(x + 0.5, y + 0.5, size - 1, size - 1)
		.strokeColor(PALETTE.hair)
		.lineWidth(0.75)
		.stroke();
}

function drawEntry(doc: PDFDoc, entry: PlacedEntry, cover: CoverImage | null): void {
	const tx = entry.x + TEXT_X_OFF;

	drawCover(doc, entry.x, entry.y + COVER_PAD, COVER_SIZE, cover);

	// Quiet index number, top-right of the cell.
	doc.font(ARCHIVO).fontSize(7).fillColor(PALETTE.faint);
	doc.text(entry.number, entry.x + COL_W - 20, entry.y + 5, { width: 20, align: 'right', lineBreak: false });

	// Title — display serif, up to two lines.
	doc.font(SERIF).fontSize(11).fillColor(PALETTE.ink);
	const [t1, t2] = entry.titleLines;
	doc.text(fitText(doc, t1, SERIF, 11, TEXT_W), tx, entry.y + CELL_TITLE_Y1, { width: TEXT_W, lineBreak: false });
	if (t2)
		doc.text(fitText(doc, t2, SERIF, 11, TEXT_W), tx, entry.y + CELL_TITLE_Y2, { width: TEXT_W, lineBreak: false });

	// Artist — italic serif sub-line, one measured line.
	doc.font(SERIF_ITALIC).fontSize(10.5).fillColor(PALETTE.ink);
	doc.text(fitText(doc, entry.artist, SERIF_ITALIC, 10.5, TEXT_W), tx, entry.y + entry.artistY, {
		width: TEXT_W,
		lineBreak: false
	});

	// Spec micro-lines — Archivo. Labels get their own line(s) and wrap instead
	// of being clipped mid-label.
	doc.font(ARCHIVO).fontSize(7.5);
	if (entry.yearFormat) {
		doc.fillColor(PALETTE.muted);
		doc.text(fitText(doc, entry.yearFormat, ARCHIVO, 7.5, TEXT_W), tx, entry.y + CELL_YEARFORMAT_Y, {
			width: TEXT_W,
			lineBreak: false
		});
	}
	const [l1, l2] = entry.labelLines;
	if (l1) {
		doc.fillColor(PALETTE.muted);
		doc.text(fitText(doc, l1, ARCHIVO, 7.5, TEXT_W), tx, entry.y + CELL_LABEL_Y1, { width: TEXT_W, lineBreak: false });
	}
	if (l2) {
		doc.fillColor(PALETTE.muted);
		doc.text(fitText(doc, l2, ARCHIVO, 7.5, TEXT_W), tx, entry.y + CELL_LABEL_Y2, { width: TEXT_W, lineBreak: false });
	}
	if (entry.condition) {
		doc.fillColor(PALETTE.faint);
		doc.text(fitText(doc, entry.condition, ARCHIVO, 7.5, TEXT_W), tx, entry.y + CELL_CONDITION_Y, {
			width: TEXT_W,
			lineBreak: false
		});
	}

	// Hairline under the cell (not on a column's last row).
	if (entry.rule) {
		doc.moveTo(entry.x, entry.y + ROW_H).lineTo(entry.x + COL_W, entry.y + ROW_H);
		doc.strokeColor(PALETTE.hair).lineWidth(0.75).stroke();
	}
}

function drawMasthead(doc: PDFDoc, cat: Catalogue): void {
	const contentW = PAGE_W - 2 * MARGIN_X;
	doc.font(SERIF).fontSize(30).fillColor(PALETTE.ink);
	doc.text('spindle', MARGIN_X, 56, { lineBreak: false });
	doc.font(ARCHIVO_SEMI).fontSize(8).fillColor(PALETTE.muted);
	doc.text('A VINYL CATALOGUE', MARGIN_X, 76, { width: contentW, align: 'right', lineBreak: false });
	doc
		.moveTo(MARGIN_X, 98)
		.lineTo(PAGE_W - MARGIN_X, 98)
		.strokeColor(PALETTE.edge)
		.lineWidth(1)
		.stroke();
	doc.font(ARCHIVO).fontSize(8).fillColor(PALETTE.faint);
	doc.text(`${cat.monthYear.toUpperCase()} · ${cat.total} RECORDS`, MARGIN_X, 110, { lineBreak: false });
}

/** One record's block: cover left, wrapped spec sheet right. */
function drawDetailBlock(doc: PDFDoc, d: PlacedDetail, cover: CoverImage | null): void {
	// The small break between records — a hairline centred in the gap.
	if (d.breakBefore) {
		doc
			.moveTo(MARGIN_X, d.top - DETAIL_BREAK / 2)
			.lineTo(PAGE_W - MARGIN_X, d.top - DETAIL_BREAK / 2)
			.strokeColor(PALETTE.hair)
			.lineWidth(0.75)
			.stroke();
	}

	drawCover(doc, MARGIN_X, d.top, DETAIL_COVER, cover);

	const x = DETAIL_COL_X;
	const w = DETAIL_COL_W;

	doc.font(SERIF).fontSize(18).fillColor(PALETTE.ink);
	d.titleLines.forEach((line, i) => {
		doc.text(line, x, d.top + d.titleDy + i * DETAIL_TITLE_LH, { width: w, lineBreak: false });
	});

	doc.font(SERIF_ITALIC).fontSize(12.5).fillColor(PALETTE.muted);
	d.artistLines.forEach((line, i) => {
		doc.text(line, x, d.top + d.artistDy + i * DETAIL_ARTIST_LH, { width: w, lineBreak: false });
	});

	// Spec sheet — stacked label/value rows; values wrap, never clip.
	d.rows.forEach((row) => {
		doc.font(ARCHIVO).fontSize(6.5).fillColor(PALETTE.faint);
		doc.text(row.label.toUpperCase(), x, d.top + row.dy, {
			charSpace: 1,
			width: w,
			lineBreak: false
		} as PDFKit.Mixins.TextOptions);
		doc.font(ARCHIVO).fontSize(9.5).fillColor(PALETTE.ink);
		row.lines.forEach((line, j) => {
			doc.text(line, x, d.top + row.dy + DETAIL_ROW_DT_H + j * DETAIL_ROW_DD_LH, { width: w, lineBreak: false });
		});
	});

	// Notes — the surface block with the accent bar, when present.
	if (d.notesLines.length > 0) {
		const h = d.notesLines.length * DETAIL_NOTES_LH + 2 * DETAIL_NOTES_PAD;
		doc.rect(x, d.top + d.notesDy, w, h).fill(PALETTE.surface);
		doc.rect(x, d.top + d.notesDy, 2, h).fill(PALETTE.accent);
		doc.font(ARCHIVO).fontSize(10.5).fillColor(PALETTE.ink);
		d.notesLines.forEach((line, i) => {
			doc.text(line, x + DETAIL_NOTES_PAD + 6, d.top + d.notesDy + DETAIL_NOTES_PAD + i * DETAIL_NOTES_LH, {
				width: w - DETAIL_NOTES_PAD - 8,
				lineBreak: false
			});
		});
	}
}

function drawDetailPage(doc: PDFDoc, page: CatalogueDetailPage, covers: (CoverImage | null)[]): void {
	// Quiet section header on the first detail page only.
	if (page.first) {
		doc.font(ARCHIVO_SEMI).fontSize(8).fillColor(PALETTE.muted);
		// charSpace is supported by pdfkit but missing from the typed TextOptions.
		doc.text('THE RECORDS', MARGIN_X, 56, { charSpace: 2, lineBreak: false } as PDFKit.Mixins.TextOptions);
		doc
			.moveTo(MARGIN_X, 72)
			.lineTo(PAGE_W - MARGIN_X, 72)
			.strokeColor(PALETTE.edge)
			.lineWidth(1)
			.stroke();
	}
	page.blocks.forEach((d, i) => drawDetailBlock(doc, d, covers[i] ?? null));
}

function drawFooter(doc: PDFDoc, pageNumber: number): void {
	const contentW = PAGE_W - 2 * MARGIN_X;
	doc.font(ARCHIVO).fontSize(7).fillColor(PALETTE.faint);
	doc.text('SPINDLE · A VINYL INDEX', MARGIN_X, PAGE_H - 30, { lineBreak: false });
	doc.text(String(pageNumber), MARGIN_X, PAGE_H - 30, { width: contentW, align: 'right', lineBreak: false });
}

/** Render the whole catalogue to a PDF buffer. */
export async function renderCataloguePdf(records: RecordRow[], plays: CataloguePlays = {}): Promise<Buffer> {
	await prepareMeasurement();
	const cat = buildCatalogue(records, plays);
	const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, info: { Title: 'spindle — a vinyl catalogue' } });

	const chunks: Buffer[] = [];
	doc.on('data', (c: Buffer) => chunks.push(c));
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});

	// Resolve each cover once; the index and its detail page share the bytes.
	// (pdfkit only dedupes string-path images — a Buffer cover drawn twice is
	// embedded twice, so this keeps sharp from decoding it twice at least.)
	const coverCache = new Map<number, CoverImage | null>();
	const getCover = async (cover: CatalogueCover, id: number): Promise<CoverImage | null> => {
		if (!coverCache.has(id)) coverCache.set(id, await resolveCover(cover));
		return coverCache.get(id) ?? null;
	};

	for (const page of cat.pages) {
		// margin: 0 must be repeated — addPage() uses its options verbatim, so a
		// bare { size } silently falls back to pdfkit's 72pt default margins and
		// re-clips the drawable area (which made the footer trip auto page-breaks).
		if (!page.first) doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
		doc.rect(0, 0, PAGE_W, PAGE_H).fill(PALETTE.paper);
		if (page.first) drawMasthead(doc, cat);

		const covers = await Promise.all(page.entries.map((e) => getCover(e.cover, e.id)));
		page.entries.forEach((entry, i) => drawEntry(doc, entry, covers[i] ?? null));

		drawFooter(doc, page.number);
	}

	// The detail pages; the footer numbers continue the document.
	for (const page of cat.detailPages) {
		doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
		doc.rect(0, 0, PAGE_W, PAGE_H).fill(PALETTE.paper);
		const covers = await Promise.all(page.blocks.map((d) => getCover(d.cover, d.id)));
		drawDetailPage(doc, page, covers);
		drawFooter(doc, cat.pages.length + page.number);
	}

	doc.end();
	return done;
}
