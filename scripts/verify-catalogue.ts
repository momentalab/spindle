/**
 * Verify F12 "Printable catalogue" on a scratch database (never the real one):
 *   - page model: 10/12 index entries per page, column-major placement, no
 *     entry spanning a page boundary, empty-collection case, two-line title
 *     wrap, sequential detail pages with precomputed geometry (no block
 *     splits a page),
 *   - listCatalogueRecords(): collection shelf only (wanted excluded), artist asc,
 *   - PDF: %PDF- header, page count matches the model (index + details),
 *     embedded font + cover xrefs, real text operators that decode (via the
 *     ToUnicode CMap) to known artist strings and detail-only content,
 *   - cover fallback: dead remote URLs / missing local files degrade to the
 *     placeholder tile, never an export failure.
 *
 * Run (bundled — catalogue.ts pulls in SvelteKit-aliased modules; sharp is
 * native and stays external. verify-bundle.mjs uses rolldown, since esbuild is
 * not installed in this environment):
 *   node scripts/verify-bundle.mjs scripts/verify-catalogue.ts .verify-catalogue.mjs \
 *     && node .verify-catalogue.mjs; rm -f .verify-catalogue.mjs
 */
import assert from 'node:assert';
import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const SCRATCH = path.join(os.tmpdir(), 'spindle-catalogue-verify');
rmSync(SCRATCH, { recursive: true, force: true });
const DATA = path.join(SCRATCH, 'data');
mkdirSync(path.join(DATA, 'media'), { recursive: true });
process.env.DATA_DIR = DATA; // must precede the dynamic import (paths read env at init)

const sharp = (await import('sharp')).default;
const db = (await import('../src/lib/server/db')).getDb(); // fresh DB — runs migrations on the scratch copy
const {
	buildCatalogue,
	listCatalogueRecords,
	prepareMeasurement,
	recordPlays,
	resolveCover,
	readFont,
	COL1_X,
	COL2_X,
	CONTENT_BOTTOM,
	DETAIL_COVER,
	DETAIL_TOP_FIRST,
	DETAIL_TOP,
	FIRST_TOP,
	LATER_TOP,
	ROW_H
} = await import('../src/lib/server/catalogue');
const { renderCataloguePdf } = await import('../src/lib/server/catalogue-pdf');

/* --- seed -------------------------------------------------------------------- */

/** One small JPEG so the local-cover path has something real to embed. */
await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 200, g: 60, b: 60 } } })
	.jpeg()
	.toFile(path.join(DATA, 'media', 'cover-test.jpg'));

const ins = db.prepare(
	`INSERT INTO records (artist, title, year, status, discogs_id, copies, cover_filename, cover_remote_url)
	 VALUES (@artist, @title, @year, @status, NULL, 1, @cover_filename, @cover_remote_url)`
);
const SEED_DEFAULTS: {
	artist: string;
	title: string;
	year: string | null;
	status: string;
	cover_filename: string | null;
	cover_remote_url: string | null;
} = {
	artist: '',
	title: '',
	year: null,
	status: 'in_collection',
	cover_filename: null,
	cover_remote_url: null
};
function seed(p: Partial<typeof SEED_DEFAULTS>): number {
	return Number(ins.run({ ...SEED_DEFAULTS, ...p }).lastInsertRowid);
}

// The first two in artist order pin the cover paths (dead remote + local JPEG).
seed({ artist: 'AAA Cover Dead', title: 'Broken Link', cover_remote_url: 'http://127.0.0.1:9/nope.jpg' });
const localId = seed({
	artist: 'AAA Cover Local',
	title: 'Local Sleeve',
	year: '1974',
	cover_filename: 'cover-test.jpg'
});
for (let i = 3; i <= 118; i++) {
	seed({ artist: `Cat Artist ${String(i).padStart(3, '0')}`, title: `Title ${i}`, year: String(1970 + (i % 56)) });
}
seed({ artist: 'Zed Wanted', title: 'Out Of Reach', status: 'wanted' });

// Decorate the local record so the spec lines and the detail page have
// something to assert on.
db.prepare(
	'UPDATE records SET format = ?, condition_media = ?, condition_sleeve = ?, limited_edition = 1, copies = 2, notes = ?, source = ?, price_paid = ? WHERE id = ?'
).run('12" LP', 'VG+', 'VG+', 'Test note for the detail page.', 'Record shop', 1599, localId);
db.prepare('INSERT INTO record_labels (record_id, label, catno) VALUES (?, ?, ?)').run(localId, 'TestPress', 'TP-001');
// A few plays so the detail page's Plays row has something to say.
for (let i = 0; i < 3; i++) {
	db.prepare('INSERT INTO plays (record_id, played_at) VALUES (?, ?)').run(localId, '2026-08-30');
}
// A long title that must wrap to two lines in the shared model.
db.prepare(
	"UPDATE records SET title = 'The Absolutely Enormously Long Title That Must Wrap' WHERE artist = 'Cat Artist 003'"
).run();

/* --- page model ---------------------------------------------------------------- */

const records = listCatalogueRecords();
assert.equal(records.length, 118, 'shelf only — the wanted row is excluded');
assert.equal(records[0]?.artist, 'AAA Cover Dead', 'sorted artist asc');
assert.ok(!records.some((r) => r.artist === 'Zed Wanted'), 'wanted record off the shelf');

await prepareMeasurement();

const empty = buildCatalogue([]);
assert.deepEqual(
	{ ...empty, monthYear: 'x' },
	{ pages: [], detailPages: [], total: 0, monthYear: 'x' },
	'empty collection → no index pages and no details'
);

const plays = recordPlays(records.map((r) => r.id));
const cat = buildCatalogue(records, plays);
assert.equal(cat.total, 118);
assert.match(cat.monthYear, /^[A-Z][a-z]+ \d{4}$/, 'masthead meta line is "Month Year"');
assert.equal(cat.pages.length, 10, '118 records → 10 + 9×12 index pages');
const details = cat.detailPages.flatMap((p) => p.blocks);
assert.equal(details.length, 118, 'one detail block per record, flowing sequentially');
assert.ok(
	cat.detailPages[0].first && cat.detailPages.slice(1).every((p) => !p.first),
	'detail section header on the first page only'
);
for (const dp of cat.detailPages) {
	assert.equal(dp.blocks[0].breakBefore, false, `no hairline above a page's first record (d${dp.number})`);
	for (const b of dp.blocks) {
		assert.ok(b.top + b.height <= CONTENT_BOTTOM, `detail block stays on its page (d${dp.number} #${b.number})`);
	}
}
assert.deepEqual(
	cat.pages.map((p) => p.entries.length),
	[10, 12, 12, 12, 12, 12, 12, 12, 12, 12]
);
assert.ok(cat.pages[0].first && !cat.pages[1].first, 'masthead yields on page 1 only');

// Column-major placement (left column top→bottom, then right), nothing past the bottom edge.
for (const page of cat.pages) {
	const top = page.first ? FIRST_TOP : LATER_TOP;
	const rows = page.first ? 5 : 6;
	page.entries.forEach((e, i) => {
		assert.equal(e.x, Math.floor(i / rows) === 0 ? COL1_X : COL2_X, `column-major x (p${page.number} #${i})`);
		assert.equal(e.y, top + (i % rows) * ROW_H, `row y (p${page.number} #${i})`);
		assert.ok(e.y + ROW_H <= CONTENT_BOTTOM, 'no entry spans the page boundary');
	});
}
assert.equal(cat.pages[0].entries[0].number, '01', 'bound-catalogue numbering starts at 01');
assert.equal(cat.pages[9].entries[11].number, '118', 'numbering runs to the last entry');

// Spec micro-lines + cover kinds from the shared model. Labels get their own
// line(s) so they wrap instead of being clipped.
const dead = cat.pages[0].entries[0];
const local = cat.pages[0].entries[1];
assert.equal(dead.cover.kind, 'remote');
assert.equal(local.cover.kind, 'local');
assert.deepEqual(local.titleLines, ['Local Sleeve', null], 'short title stays one line');
assert.equal(local.yearFormat, '1974 · 12" LP');
assert.deepEqual(local.labelLines, ['TestPress (TP-001)', null], 'label on its own line, unwrapped');
assert.equal(local.artistY, 32, 'one-line title pulls the artist up into its group');
assert.equal(cat.pages[0].entries[2].artistY, 41, 'two-line title keeps the artist clear of the second line');
assert.equal(local.condition, 'VG+/VG+ · In collection · ×2 · Limited');
assert.deepEqual(
	cat.pages[0].entries[2].titleLines,
	['The Absolutely Enormously', 'Long Title That Must Wrap'],
	'long title wraps to two lines'
);

// Detail blocks: precomputed geometry + the record page's spec sheet.
const localDetail = details.find((d) => d.id === localId)!;
assert.equal(cat.detailPages[0].blocks[0].top, DETAIL_TOP_FIRST, 'first detail block yields to its header');
const laterDetailPage = cat.detailPages.find((p) => !p.first)!;
assert.equal(laterDetailPage.blocks[0].top, DETAIL_TOP, 'later detail pages start at the top margin');
assert.ok(localDetail.height >= DETAIL_COVER, 'block is at least as tall as its cover');
assert.ok(localDetail.notesDy > localDetail.rowsDy, 'notes block sits below the spec sheet');
const row = (label: string) => localDetail.rows.find((r) => r.label === label)?.lines[0];
assert.equal(row('Plays'), '3 · spun Aug 30, 2026', 'plays with an absolute date');
assert.equal(row('Year'), '1974');
assert.equal(row('Label'), 'TestPress (TP-001)');
assert.equal(row('Format'), '12" LP');
assert.equal(row('Condition'), 'media VG+ · sleeve VG+');
assert.equal(row('Price paid'), '$15.99');
assert.equal(row('Source'), 'Record shop');
assert.deepEqual(localDetail.notesLines, ['Test note for the detail page.'], 'notes wrapped by the shared model');

// Plays plumbing: batched counts, only records with plays appear.
assert.equal(Object.keys(plays).length, 1, 'only the played record appears');
assert.deepEqual(plays[localId], { count: 3, lastPlayedAt: '2026-08-30' });

/* --- fonts ---------------------------------------------------------------------- */

for (const name of ['source-serif-4-400', 'source-serif-4-italic-400', 'archivo-400', 'archivo-600'] as const) {
	assert.deepEqual([...readFont(name).subarray(0, 4)], [0x00, 0x01, 0x00, 0x00], `${name} is a real TTF`);
}

/* --- cover fallback --------------------------------------------------------------- */

assert.equal(await resolveCover({ kind: 'none' }), null, 'kind none → placeholder');
assert.equal(await resolveCover({ kind: 'local', filename: 'missing.jpg' }), null, 'missing file → placeholder');
assert.equal(await resolveCover({ kind: 'local', filename: '../spindle.db' }), null, 'path traversal blocked');
assert.equal(
	await resolveCover({ kind: 'remote', url: 'http://127.0.0.1:9/nope.jpg' }),
	null,
	'dead remote URL → placeholder'
);
const cover = await resolveCover({ kind: 'local', filename: 'cover-test.jpg' });
assert.ok(cover, 'local JPEG resolves');
assert.equal(cover!.width, 120);
assert.equal(cover!.height, 90);
assert.equal((await sharp(cover!.bytes).metadata()).format, 'jpeg', 'normalized to JPEG');

/* --- PDF --------------------------------------------------------------------------- */

/**
 * Decode a pdfkit PDF back to text. pdfkit embeds each TTF as a Type0/CID font
 * with its own ToUnicode CMap (GID→Unicode), so per-page /Font resources are
 * followed and the content streams' TJ hex runs are decoded against the font
 * currently selected by `Tf`. Objects are parsed via /Length-exact slices —
 * a naive indexOf('stream') scan derails on binary font data.
 * Empty string when no CMap is found (the assertions below fail loudly).
 */
function extractPdfText(bytes: Buffer): string {
	const raw = bytes.toString('latin1');
	const objs = new Map<number, { dict: string; bin?: Buffer }>();
	for (const hm of raw.matchAll(/(\d+) 0 obj/g)) {
		const after = hm.index! + hm[0].length;
		const sIdx = raw.indexOf('stream', after);
		const eobj = raw.indexOf('endobj', after);
		// Stream object: the `stream` keyword precedes its own endobj, and it
		// follows the dict's closing `>>`.
		if (sIdx !== -1 && (eobj === -1 || sIdx < eobj) && /[^A-Za-z0-9]/.test(raw[sIdx - 1])) {
			let start = sIdx + 6;
			if (raw[start] === '\r') start++;
			if (raw[start] === '\n') start++;
			const lenM = /\/Length (\d+)/.exec(raw.slice(after, sIdx));
			if (lenM) {
				objs.set(Number(hm[1]), { dict: raw.slice(after, sIdx), bin: bytes.subarray(start, start + Number(lenM[1])) });
				continue;
			}
		}
		if (eobj !== -1) objs.set(Number(hm[1]), { dict: raw.slice(after, eobj) });
	}

	const inflate = (bin: Buffer | undefined): string | null => {
		if (!bin) return null;
		try {
			return inflateSync(bin).toString('latin1');
		} catch {
			return null;
		}
	};

	// CMap object number -> GID→Unicode.
	const cmaps = new Map<number, Map<number, string>>();
	for (const [num, o] of objs) {
		const txt = inflate(o.bin);
		if (!txt?.includes('begincmap')) continue;
		const map = new Map<number, string>();
		for (const block of txt.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
			for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f\s]+)>/g)) {
				map.set(parseInt(m[1], 16), Buffer.from(m[2].replace(/\s/g, ''), 'hex').swap16().toString('utf16le'));
			}
		}
		for (const block of txt.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
			for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
				const lo = parseInt(m[1], 16);
				(m[3].match(/<[^>]+>/g) ?? []).forEach((d, i) =>
					map.set(lo + i, Buffer.from(d.slice(1, -1).replace(/\s/g, ''), 'hex').swap16().toString('utf16le'))
				);
			}
		}
		cmaps.set(num, map);
	}
	if (cmaps.size === 0) return '';

	let text = '';
	for (const o of objs.values()) {
		if (!o.dict.includes('/Type /Page') || o.dict.includes('/Type /Pages')) continue;
		const content = inflate(objs.get(Number(o.dict.match(/\/Contents (\d+) 0 R/)?.[1] ?? ''))?.bin);
		if (!content?.includes('TJ') && !content?.includes(' Tj')) continue;

		// This page's font name → CMap (resources dict may be inline or indirect).
		const resRef = o.dict.match(/\/Resources (\d+) 0 R/)?.[1];
		const resDict = resRef ? (objs.get(Number(resRef))?.dict ?? '') : o.dict;
		const fonts = new Map<string, Map<number, string>>();
		for (const fm of resDict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
			const tRef = objs.get(Number(fm[2]))?.dict.match(/\/ToUnicode (\d+) 0 R/)?.[1];
			const cmap = tRef ? cmaps.get(Number(tRef)) : undefined;
			if (cmap) fonts.set(fm[1], cmap);
		}

		let cur: Map<number, string> | null = null;
		for (const m of content.matchAll(/\/(F\d+) [\d.]+ Tf|<([0-9A-Fa-f]+)>/g)) {
			if (m[1]) cur = fonts.get(m[1]) ?? null;
			else if (cur) {
				const hex = m[2];
				for (let i = 0; i + 4 <= hex.length; i += 4) text += cur.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
			}
		}
	}
	return text;
}

const pdf = await renderCataloguePdf(records, plays);
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'valid PDF header');
const pdfRaw = pdf.toString('latin1');
// Index pages + sequential detail pages — the count comes from the shared model.
assert.equal(
	(pdfRaw.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length,
	cat.pages.length + cat.detailPages.length,
	'PDF page count matches the model'
);
assert.ok((pdfRaw.match(/FontFile2/g) ?? []).length >= 4, 'all four bundled faces embedded');
assert.ok(pdfRaw.includes('CIDFontType2'), 'text drawn with embedded CID fonts (real text, not a raster)');
// The local JPEG appears on its index entry AND its detail page. pdfkit only
// dedupes string-path images, so Buffer covers embed once per page they're on.
assert.equal((pdfRaw.match(/\/Subtype\s*\/Image/g) ?? []).length, 2, 'the local cover embedded on index + detail');
assert.ok(pdfRaw.includes('/DCTDecode'), 'cover embedded as a JPEG');

const pdfText = extractPdfText(pdf);
assert.ok(pdfText.includes('AAA Cover Local'), 'decoded text carries the known artist string');
assert.ok(pdfText.includes('A VINYL CATALOGUE'), 'masthead is real, extractable text');
assert.ok(pdfText.includes('1974 · 12" LP'), 'spec micro-lines are real text too');
assert.ok(pdfText.includes('TestPress (TP-001)'), 'labels are real text on their own line');
assert.ok(pdfText.includes('VG+/VG+ · In collection · ×2 · Limited'), 'condition line is real text');
assert.ok(pdfText.includes('THE RECORDS'), 'detail section header is real text');
assert.ok(pdfText.includes('3 · spun Aug 30, 2026'), 'detail Plays row with an absolute date');
assert.ok(pdfText.includes('$15.99') && pdfText.includes('Record shop'), 'detail spec-sheet values are real text');
assert.ok(pdfText.includes('Test note for the detail page.'), 'detail notes are real text');

console.log('\nAll catalogue checks passed ✔');
console.log(
	JSON.stringify(
		{
			pages: cat.pages.map((p) => p.entries.length),
			pdf_bytes: pdf.length,
			text_sample: pdfText.slice(0, 120)
		},
		null,
		1
	)
);
