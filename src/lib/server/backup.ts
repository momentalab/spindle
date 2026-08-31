/**
 * Backup & restore (server-only) — the local-first safety net (roadmap F8).
 *
 * Backup:  checkpoint+truncate the WAL so `mynyl.db` is a self-contained
 *          snapshot, then stream the db file (+ any live -wal/-shm sidecars)
 *          and every file under `media/` into an in-memory zip via archiver —
 *          no temp disk. Archive layout:  mynyl.db[, -wal, -shm] + media/<files>
 *
 * Restore: parse the uploaded zip (unzipper.Open.buffer), validate it —
 *          structure, path-safety of every entry, and a real open +
 *          PRAGMA integrity_check on the staged candidate DB BEFORE anything
 *          is touched — then shut the live handle down cleanly, preserve the
 *          outgoing files in `.pre-restore/` (one generation), move the
 *          incoming files into DATA_DIR, and let getDb() reopen lazily.
 *
 * Ordering is the whole safety story: nothing under DATA_DIR changes until the
 * candidate DB has opened and passed integrity_check. A failed restore leaves
 * the running collection byte-for-byte untouched.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ZipArchive, type EntryData } from 'archiver';
import * as unzipper from 'unzipper';
import Database from 'better-sqlite3';
import { checkpointAndClose, getDb } from '$lib/server/db';
import { DB_PATH, DATA_DIR, MEDIA_DIR, PRE_RESTORE_DIR, RESTORE_STAGING_DIR, ensureDataDirs } from '$lib/server/paths';

export interface BackupInfo {
	/** Bytes the zip will be. */
	size_bytes: number;
	/** Files packed (db files + media). */
	file_count: number;
	/** Media files packed (covers + photos). */
	media_count: number;
	/** True when -wal/-shm sidecars were present and packed alongside the db. */
	included_sidecars: boolean;
}

export interface RestoreInfo {
	db_size_bytes: number;
	media_count: number;
	/** Where the previous generation now lives (always PRE_RESTORE_DIR). */
	pre_restore_dir: string;
	/** Record count after reopening — proof the restore was readable. */
	record_count: number;
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

/**
 * Build a zip of the whole collection (db + media) and resolve it as a Buffer.
 * The WAL is checkpointed+truncated first, so the resulting db file is a
 * consistent snapshot on its own (sidecars are still packed when present).
 */
export async function createBackup(): Promise<{ buffer: Buffer; info: BackupInfo }> {
	// Flush + compact the WAL so mynyl.db alone is a consistent snapshot.
	const checkpoint = getDb().pragma('wal_checkpoint(TRUNCATE)') as unknown as Array<{ busy: number }>;
	if (checkpoint[0]?.busy) {
		// Another writer holds the WAL; yield briefly and retry once.
		await new Promise((r) => setTimeout(r, 50));
		const second = getDb().pragma('wal_checkpoint(TRUNCATE)') as unknown as Array<{ busy: number }>;
		if (second[0]?.busy) {
			throw new Error('Database is busy — could not checkpoint the WAL for backup. Try again in a moment.');
		}
	}

	const archive = new ZipArchive({ zlib: { level: 9 } });
	const chunks: Buffer[] = [];
	archive.on('data', (chunk: Buffer) => chunks.push(chunk));
	const done = new Promise<Buffer>((resolve, reject) => {
		archive.on('end', () => resolve(Buffer.concat(chunks)));
		archive.on('error', (err) => reject(err));
	});

	let db_count = 0;
	let media_count = 0;

	// The db file + any live -wal / -shm sidecars (usually gone after TRUNCATE).
	for (const suffix of ['', '-wal', '-shm']) {
		const p = DB_PATH + suffix;
		if (!existsSync(p)) continue;
		const entry: EntryData = { name: path.basename(p) };
		archive.append(createReadStream(p), entry);
		db_count++;
	}
	const included_sidecars = db_count > 1;

	// Everything under media/, preserving flat names.
	ensureDataDirs();
	for (const name of readdirSync(MEDIA_DIR)) {
		const full = path.join(MEDIA_DIR, name);
		if (!statSync(full).isFile()) continue; // media is flat, but be defensive
		const entry: EntryData = { name: path.join('media', name) };
		archive.append(createReadStream(full), entry);
		media_count++;
	}

	archive.finalize();
	const buffer = await done;

	return {
		buffer,
		info: {
			size_bytes: buffer.length,
			file_count: db_count + media_count,
			media_count,
			included_sidecars
		}
	};
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

/** Max uncompressed size per archive entry (defends against zip bombs). */
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
/** Max number of file entries in an archive. */
const MAX_ENTRIES = 50_000;

/**
 * Parse the uploaded zip into a sanitized entry map. Throws (user-safe Error)
 * on structural or path-safety problems — before any disk write happens.
 *
 * Allowed layout: `mynyl.db` at the root (optionally `mynyl.db-wal` /
 * `mynyl.db-shm` sidecars) plus single-segment files under `media/`.
 */
async function readBackupEntries(buf: Buffer): Promise<Map<string, Buffer>> {
	let cd: unzipper.CentralDirectory;
	try {
		cd = await unzipper.Open.buffer(buf);
	} catch {
		throw new Error('Not a valid zip file — upload the .zip a backup download produced.');
	}

	const entries = new Map<string, Buffer>();
	let count = 0;
	for (const f of cd.files) {
		if (f.type !== 'File') continue;
		count++;
		if (count > MAX_ENTRIES) throw new Error('Backup archive has too many files.');
		if (f.uncompressedSize > MAX_ENTRY_BYTES) {
			throw new Error(`Entry ${sanitizePath(f.path)} is too large to restore.`);
		}
		entries.set(sanitizePath(f.path), await f.buffer());
	}
	if (entries.size === 0) throw new Error('Backup archive contains no files.');
	if (!entries.has('mynyl.db')) throw new Error('Backup archive does not contain mynyl.db.');
	return entries;
}

/**
 * Zip path-safety: normalize to forward slashes, reject traversal segments,
 * then enforce the allowed layout. Returns the canonical key used in the
 * entry map; throws when an entry is outside it.
 */
function sanitizePath(raw: string): string {
	const normalized = raw.replace(/\\/g, '/');
	const parts = normalized.split('/').filter((p) => p !== '' && p !== '.');
	if (parts.some((p) => p === '..')) throw new Error(`Unsafe path in backup archive: ${raw}`);

	if (parts.length === 1) {
		const base = parts[0];
		if (!['mynyl.db', 'mynyl.db-wal', 'mynyl.db-shm'].includes(base)) {
			throw new Error(`Unexpected file at backup archive root: ${base}`);
		}
		return base;
	}
	if (parts.length === 2 && parts[0] === 'media' && !parts[1].startsWith('.')) {
		return `media/${parts[1]}`;
	}
	throw new Error(`Unsupported entry in backup archive: ${raw}`);
}

/** Open a copy of the candidate db out-of-band and prove it is sound SQLite. */
function verifyCandidateDb(dbBytes: Buffer): void {
	const staged = path.join(RESTORE_STAGING_DIR, 'mynyl.db');
	rmSync(RESTORE_STAGING_DIR, { recursive: true, force: true });
	mkdirSync(RESTORE_STAGING_DIR, { recursive: true });
	writeFileSync(staged, dbBytes);

	let check: Database.Database | null = null;
	try {
		check = new Database(staged, { readonly: true, fileMustExist: true });
		const result = check.pragma('integrity_check') as unknown as { integrity_check: string }[];
		if (!Array.isArray(result) || result[0]?.integrity_check !== 'ok') {
			throw new Error('integrity');
		}
	} catch (e) {
		throw new Error(
			e instanceof Error && e.message === 'integrity'
				? 'Backup database failed the SQLite integrity check — restore aborted, nothing was changed.'
				: 'Backup database could not be opened — restore aborted, nothing was changed.'
		);
	} finally {
		check?.close();
		rmSync(RESTORE_STAGING_DIR, { recursive: true, force: true });
	}
}

/**
 * Validate + apply a restore. Throws (user-safe Error) on any failure; DATA_DIR
 * is left untouched until the candidate DB has been verified.
 */
export async function restoreFromBackup(buf: Buffer): Promise<RestoreInfo> {
	if (buf.length === 0) throw new Error('No backup file received.');

	// 1. Parse + path-sanitize everything up front (no disk writes yet).
	const entries = await readBackupEntries(buf);
	const dbBytes = entries.get('mynyl.db')!;
	const mediaEntries = [...entries.entries()].filter(([k]) => k.startsWith('media/'));

	// 2. Prove the candidate DB is sound before touching the live collection.
	verifyCandidateDb(dbBytes);

	// 3. Shut the live handle down cleanly (WAL flushed, files released).
	checkpointAndClose();

	// 4. Preserve the outgoing generation, then move the incoming files in.
	rmSync(PRE_RESTORE_DIR, { recursive: true, force: true });
	mkdirSync(PRE_RESTORE_DIR, { recursive: true });
	for (const suffix of ['', '-wal', '-shm']) {
		const p = DB_PATH + suffix;
		if (existsSync(p)) renameSync(p, path.join(PRE_RESTORE_DIR, path.basename(p)));
	}
	if (existsSync(MEDIA_DIR)) {
		renameSync(MEDIA_DIR, path.join(PRE_RESTORE_DIR, 'media'));
	}
	mkdirSync(MEDIA_DIR, { recursive: true });

	writeFileSync(DB_PATH, dbBytes);
	for (const sidecar of ['mynyl.db-wal', 'mynyl.db-shm']) {
		const src = entries.get(sidecar);
		if (src) writeFileSync(path.join(DATA_DIR, sidecar), src);
	}
	for (const [key, data] of mediaEntries) {
		writeFileSync(path.join(MEDIA_DIR, key.slice('media/'.length)), data);
	}

	// 5. Reopen and confirm the restored collection is readable.
	const record_count = (getDb().prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n;

	return { db_size_bytes: dbBytes.length, media_count: mediaEntries.length, pre_restore_dir: PRE_RESTORE_DIR, record_count };
}

