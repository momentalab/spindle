/**
 * Portable storage paths (server-only).
 * All filesystem access goes through here so the Mac dev layout and the
 * Linux server layout behave identically. Override with DATA_DIR env var.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const DB_PATH = path.join(DATA_DIR, 'mynyl.db');

/** Ensure the data + media directories exist. Idempotent. */
export function ensureDataDirs(): void {
	mkdirSync(MEDIA_DIR, { recursive: true });
}
