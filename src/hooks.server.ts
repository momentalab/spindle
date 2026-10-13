/**
 * Response security headers (server-only).
 *
 * The app has no auth of its own and is designed to sit behind a
 * TLS-terminating reverse proxy, so the baseline headers come from here
 * rather than from every deployer's proxy config. HSTS is deliberately NOT
 * set in-app — it belongs at the TLS edge and would break plain-HTTP LAN
 * setups. The CSP carries frame-ancestors only: a full script-src policy
 * would break SvelteKit's inline scripts (the app.html theme boot runs
 * inline by design).
 */
import type { Handle } from '@sveltejs/kit';

const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'same-origin',
	// Clickjacking protection: the app must never render inside a frame.
	'Content-Security-Policy': "frame-ancestors 'none'",
	// Redundant with frame-ancestors where both are honored; kept for older browsers.
	'X-Frame-Options': 'DENY'
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(header, value);
	}
	return response;
};
