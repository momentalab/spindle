// place files you want to import through the `$lib` alias in this folder.

/**
 * Standardized page title: `Page · mynyl`. The brand always sits last so the
 * open-tab list reads as a catalogue ("Collection", "Stats", "Artist — Title"),
 * with a single consistent separator across every route.
 */
export function appTitle(page?: string): string {
	return page ? `${page} · mynyl` : 'mynyl';
}
