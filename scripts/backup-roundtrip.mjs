/**
 * End-to-end smoke test for backup/restore (F8). Requires a running server:
 *   mkdir -p /tmp/mynyl-f8/data/media
 *   PORT=3199 DATA_DIR=/tmp/mynyl-f8/data node build/index.js &
 *   curl -s http://127.0.0.1:3199/          # force lazy DB creation
 *   DATA_DIR=/tmp/mynyl-f8/data node scripts/backup-seed.mjs
 *   DATA_DIR=/tmp/mynyl-f8/data node scripts/backup-roundtrip.mjs [baseUrl]
 *
 * Steps:
 *   1. POST /api/backup            → expect a zip with mynyl.db + media files
 *   2. verify the zip's db is openable and integrity_check=ok, and the db inside
 *      matches what the live server reports (record count)
 *   3. delete one record + one media file from the live DATA_DIR (simulate loss)
 *   4. POST /api/restore with the zip → expect ok + pre_restore_dir created
 *   5. verify the record and media are back, and .pre-restore holds the wiped gen
 *   6. negative: restore a garbage body → 400, live data untouched
 *
 * NOTE: adapter-node derives the request origin assuming https (behind-TLS
 * proxy deployment), so mutating form POSTs must carry a matching Origin —
 * the same rule the photo-upload route already lives under.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3199';
const DATA = process.env.DATA_DIR ?? '/tmp/mynyl-f8/data';
let failures = 0;
function check(label, cond, extra = '') {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
	if (!cond) failures++;
}

const liveDbPath = `${DATA}/mynyl.db`;
const dbBefore = new Database(liveDbPath, { readonly: true });
const recordsBefore = dbBefore.prepare('SELECT COUNT(*) n FROM records').get().n;
dbBefore.close();
console.log(`live collection: ${recordsBefore} records`);

// ---- 1. backup -----------------------------------------------------------
const res = await fetch(`${BASE}/api/backup`, { method: 'POST' });
check('backup responds 200', res.status === 200, `status=${res.status}`);
const cd = res.headers.get('content-disposition') ?? '';
check('attachment with stamped zip name', /attachment; filename="mynyl-backup-.*\.zip"/.test(cd), cd);
const zip = Buffer.from(await res.arrayBuffer());
writeFileSync('/tmp/mynyl-f8/backup.zip', zip);
check('zip magic', zip.subarray(0, 2).toString() === 'PK', `${zip.length} bytes`);

// ---- 2. inspect the archive (unzipper from the app's own node_modules) ---
const unzipper = await import('unzipper');
const cdDir = await unzipper.Open.buffer(zip);
const names = cdDir.files.map((f) => f.path).sort();
console.log('archive entries:', names.join(', '));
check('archive has mynyl.db', names.includes('mynyl.db'));
check('archive has both covers', names.includes('media/1-cover.jpg') && names.includes('media/2-cover.jpg'));

const dbInZip = await cdDir.files.find((f) => f.path === 'mynyl.db').buffer();
writeFileSync('/tmp/mynyl-f8/in-zip.db', dbInZip);
const zippedDb = new Database('/tmp/mynyl-f8/in-zip.db', { readonly: true });
const integrity = zippedDb.pragma('integrity_check');
check('zipped db integrity_check ok', integrity[0].integrity_check === 'ok', JSON.stringify(integrity[0]));
const zipRecords = zippedDb.prepare('SELECT COUNT(*) n FROM records').get().n;
zippedDb.close();
check('zipped record count matches live', zipRecords === recordsBefore, `${zipRecords} vs ${recordsBefore}`);

// ---- 3. simulate loss ------------------------------------------------------
const victimCover = `${DATA}/media/1-cover.jpg`;
new Database(liveDbPath).prepare('DELETE FROM records WHERE barcode = ?').run('0123456789012');
if (existsSync(victimCover)) unlinkSync(victimCover);
check('simulated loss (record deleted, cover removed)', !existsSync(victimCover));

// ---- 4. restore -------------------------------------------------------------
const host = new URL(BASE).host;
const ORIGIN_HEADERS = { Origin: `https://${host}` };

const form = new FormData();
form.append('file', new File([zip], 'backup.zip', { type: 'application/zip' }));
const rres = await fetch(`${BASE}/api/restore`, { method: 'POST', body: form, headers: ORIGIN_HEADERS });
const rjson = await rres.json().catch(() => ({}));
check('restore responds ok', rres.status === 200 && rjson.ok === true, JSON.stringify(rjson));
check('restore reports pre_restore_dir', typeof rjson.pre_restore_dir === 'string' && rjson.pre_restore_dir.includes('.pre-restore'));

const dbAfter = new Database(liveDbPath, { readonly: true });
const recordsAfter = dbAfter.prepare('SELECT COUNT(*) n FROM records').get().n;
dbAfter.close();
check('record count restored', recordsAfter === recordsBefore, `${recordsAfter} vs ${recordsBefore}`);
check('cover file restored', existsSync(victimCover));

const pre = `${DATA}/.pre-restore`;
check('.pre-restore snapshot exists with wiped-gen db', existsSync(`${pre}/mynyl.db`));
check('.pre-restore snapshot has wiped-gen media (2-cover only)', existsSync(`${pre}/media/2-cover.jpg`) && !existsSync(`${pre}/media/1-cover.jpg`));

// ---- 5. negative: garbage upload -------------------------------------------
const badForm = new FormData();
badForm.append('file', new File([Buffer.from('this is not a zip')], 'bad.zip'));
const bres = await fetch(`${BASE}/api/restore`, { method: 'POST', body: badForm, headers: ORIGIN_HEADERS });
check('garbage upload rejected 400', bres.status === 400, `status=${bres.status}`);
const dbLive2 = new Database(liveDbPath, { readonly: true });
check('live collection untouched after bad restore', dbLive2.prepare('SELECT COUNT(*) n FROM records').get().n === recordsBefore);
dbLive2.close();

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
