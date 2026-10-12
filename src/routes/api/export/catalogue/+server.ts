/**
 * Catalogue export (F12): the collection as a bound-catalogue artifact.
 *
 * GET /api/export/catalogue — server-side pdfkit: real, selectable text +
 * embedded covers. The /print route is the link/shareable surface.
 *
 * Sibling of GET /api/export (CSV/JSON data dumps): same attachment conventions,
 * no-store so a fresh catalogue is always rendered on demand.
 */
import { error } from '@sveltejs/kit';
import { listCatalogueRecords, recordPlays } from '$lib/server/catalogue';
import { renderCataloguePdf } from '$lib/server/catalogue-pdf';

function fileHeaders(contentType: string, filename: string): Record<string, string> {
	return {
		'Content-Type': contentType,
		'Content-Disposition': `attachment; filename="${filename}"`,
		'Cache-Control': 'no-store'
	};
}

export async function GET({}): Promise<Response> {
	const records = listCatalogueRecords();
	if (records.length === 0) {
		error(400, 'The collection is empty — nothing to render.');
	}

	const plays = recordPlays(records.map((r) => r.id));
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

	const bytes = await renderCataloguePdf(records, plays);
	return new Response(new Uint8Array(bytes), {
		headers: fileHeaders('application/pdf', `spindle-catalogue-${stamp}.pdf`)
	});
}
