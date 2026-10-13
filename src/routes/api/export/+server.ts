/**
 * Collection export endpoint.
 *
 * GET /api/export?format=csv|json[&table=records|photos|plays|tracks]
 *   format  csv (default) or json
 *   table   records | photos | plays. CSV defaults to records; JSON defaults
 *           to all tables. For CSV the default filename reflects the table.
 *
 * Streams the local database as a download. Unknown format/table → 400 with
 * the list of supported values in the body, so curl/fetch users self-correct.
 */
import { error } from '@sveltejs/kit';
import { EXPORT_FORMATS, EXPORT_TABLES, renderExport, type ExportFormat, type ExportTable } from '$lib/server/export';

export function GET({ url }): Response {
	const rawFormat = (url.searchParams.get('format') ?? 'csv').toLowerCase();
	if (!EXPORT_FORMATS.includes(rawFormat as ExportFormat)) {
		error(400, `Unsupported format "${rawFormat}". Supported: ${EXPORT_FORMATS.join(', ')}`);
	}

	const tableParam = url.searchParams.get('table')?.toLowerCase() ?? '';
	let table: 'all' | ExportTable;
	if (tableParam === '') {
		table = rawFormat === 'json' ? 'all' : 'records';
	} else if (EXPORT_TABLES.includes(tableParam as ExportTable)) {
		table = tableParam as ExportTable;
	} else {
		error(400, `Unsupported table "${tableParam}". Supported: ${EXPORT_TABLES.join(', ')}`);
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const format = rawFormat as ExportFormat;
	const body = renderExport(format, { bom: format === 'csv', table });

	const namePart = table === 'all' ? 'collection' : table;
	return new Response(body, {
		headers: {
			'Content-Type': format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
			'Content-Disposition': `attachment; filename="spindle-${namePart}-${stamp}.${format}"`,
			'Cache-Control': 'no-store'
		}
	});
}
