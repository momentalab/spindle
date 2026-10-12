/**
 * /print — the collection as a bound catalogue (F12). The shareable link
 * surface: it renders from the local DB alone (offline-safe), mirrors the
 * server-side PDF/image page model, and prints to PDF via the browser dialog.
 */
import { buildCatalogue, listCatalogueRecords, prepareMeasurement, recordPlays } from '$lib/server/catalogue';

export const load = async () => {
	await prepareMeasurement();
	const records = listCatalogueRecords();
	const plays = recordPlays(records.map((r) => r.id));
	return { cat: buildCatalogue(records, plays) };
};
