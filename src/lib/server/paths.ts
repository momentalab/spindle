/**
 * Portable storage paths (server-only).
 * All filesystem access goes through here so the Mac dev layout and the
 * Linux server layout behave identically. Override with DATA_DIR env var.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const DB_PATH = path.join(DATA_DIR, 'spindle.db');

/**
 * One-generation safety net for restore (F8): the pre-restore snapshot of
 * DB + media lives here until the next restore overwrites it.
 */
export const PRE_RESTORE_DIR = path.join(DATA_DIR, '.pre-restore');

/** Short-lived staging dir where a restored candidate DB is validated before it is swapped in. */
export const RESTORE_STAGING_DIR = path.join(DATA_DIR, '.restore-staging');

/** Ensure the data + media directories exist. Idempotent. */
export function ensureDataDirs(): void {
	mkdirSync(MEDIA_DIR, { recursive: true });
}
