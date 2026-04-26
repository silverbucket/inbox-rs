import RemoteStorage from 'remotestoragejs';
import InboxModule, { recoverLegacyBinaryStringEncoding } from '@inbox-rs/rs-module';
import SharesModule from 'remotestorage-module-shares';

// remotestoragejs' `Authorize._rs_init` unconditionally clears
// `location.hash` during construction — its `extractParams()` helper returns
// an empty object (truthy) even when the URL has no OAuth params, and the
// init code's `if (params) { location.hash = '' }` then wipes our route hash
// (e.g. `#/todos` → `#`). That breaks our hash-based router on page refresh.
//
// Snapshot the hash immediately before construction and replaceState it back
// if RS cleared it. replaceState avoids firing a spurious hashchange event,
// and we only restore when the hash actually looks like one of our routes
// (leading `/`) to stay clear of any legitimate OAuth-callback flow the RS
// init is trying to handle.
const savedHash = typeof window !== 'undefined' ? window.location.hash : '';

// Detect and auto-recover a corrupt `remotestorage` IndexedDB before RS opens it.
//
// The corrupt state we're guarding against: a `remotestorage` DB at version 1
// with NO object stores. RS's upgrade handler (`indexeddb.ts:327-340`) has
// `if (event.oldVersion !== 1) { createObjectStore('nodes') }` — i.e. it
// SKIPS creating `nodes` when upgrading from v1, on the assumption that v1
// already has it. When the v1 DB is empty, the upgrade ends up creating only
// `changes`, then RS's onsuccess notices `nodes` is missing and calls
// `IndexedDB.clean()` to recover. But `clean()` doesn't close its own open
// connection first, so `deleteDatabase` blocks indefinitely until RS's 10s
// timeout fires and the feature falls back to LocalStorage. Net effect: a
// 10-second hang on every page load and reads/writes silently dropped.
//
// Strategy: prefer `indexedDB.databases()` (Chrome 71+, Safari 14+, Firefox
// 126+) to read the DB's existence and version WITHOUT opening it. If we see
// the DB present at v<2, delete it and let RS construct a clean v2 from
// `oldVersion=0`. We never call `indexedDB.open()` ourselves — that's
// important because in some Chrome states (a previous-session aborted
// `deleteDatabase` from RS's failed clean()), `open()` itself stays pending
// forever, and using it as our probe would just inherit the hang.
//
// For browsers without `databases()`, we fall back to the open-probe. That
// path can hang if the DB is in the same stuck state — we time out after 2s
// and proceed, accepting that very-old-browser users with a previously-
// corrupted DB still hit RS's 10s timeout (one-time, until they manually
// run `__cleanupRSDb()`).
async function detectAndRecoverCorruptDb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  if (typeof (indexedDB as any).databases === 'function') {
    let dbs: Array<{ name?: string; version?: number }> | null = null;
    try {
      dbs = await (indexedDB as any).databases();
    } catch (e) {
      console.warn(`[idb-probe] databases() threw — falling back to open-probe`, e);
    }
    if (dbs) {
      const rsDb = dbs.find((db) => db.name === 'remotestorage');
      if (!rsDb) {
        console.log(`[idb-probe] no existing 'remotestorage' DB — RS will create one fresh`);
        return;
      }
      // Anything below v2 hits the bug. v1 is the well-known corrupt state;
      // v0/undefined shouldn't normally happen but is also pre-bug.
      if ((rsDb.version ?? 0) < 2) {
        console.warn(`[idb-probe] 'remotestorage' is at v${rsDb.version ?? '?'} — pre-upgrade-bug version, auto-cleaning before RS init`);
        await deleteRsDb();
        return;
      }
      console.log(`[idb-probe] 'remotestorage' is at v${rsDb.version} — healthy, RS can open it directly`);
      return;
    }
  }

  // Fallback for browsers without databases(). The open-probe can be hung by
  // a previous-session abort, so we cap it at 2s and proceed.
  const probeStart = Date.now();
  console.log(`[idb-probe] T+0ms (fallback) opening 'remotestorage' to inspect state`);

  type ProbeOk = { version: number; stores: string[] };
  const result: ProbeOk | 'failed' = await new Promise((resolve) => {
    let settled = false;
    const settle = (v: ProbeOk | 'failed') => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const probe = indexedDB.open('remotestorage');
    probe.onsuccess = () => {
      const db = probe.result;
      const stores = Array.from(db.objectStoreNames);
      console.log(`[idb-probe] T+${Date.now() - probeStart}ms onsuccess — version=${db.version}, stores=[${stores.join(',')}]`);
      db.close();
      settle({ version: db.version, stores });
    };
    probe.onerror = () => {
      console.warn(`[idb-probe] T+${Date.now() - probeStart}ms onerror`, probe.error);
      settle('failed');
    };
    probe.onblocked = (event: any) => {
      console.warn(`[idb-probe] T+${Date.now() - probeStart}ms ONBLOCKED — old=${event?.oldVersion} new=${event?.newVersion}`);
      settle('failed');
    };
    setTimeout(() => {
      if (!settled) {
        console.warn(`[idb-probe] T+${Date.now() - probeStart}ms still pending after 2s — proceeding without cleanup. readyState=${probe.readyState}`);
        settle('failed');
      }
    }, 2000);
  });

  if (result === 'failed') return;
  if ((result.version ?? 0) >= 2) return;
  // The fallback open-probe creates an empty v1 DB if none existed; either
  // way we delete-and-let-RS-recreate.
  console.warn(`[idb-probe] DB is at v${result.version} with stores=[${result.stores.join(',')}] — auto-cleaning before RS init`);
  await deleteRsDb();
}

async function deleteRsDb(): Promise<void> {
  return new Promise<void>((resolve) => {
    const start = Date.now();
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const req = indexedDB.deleteDatabase('remotestorage');
    req.onsuccess = () => {
      console.log(`[idb-cleanup] T+${Date.now() - start}ms deleted — RS will create a clean v2 DB`);
      settle();
    };
    req.onerror = () => {
      console.error(`[idb-cleanup] T+${Date.now() - start}ms error — proceeding anyway, RS may fall back to LocalStorage`, req.error);
      settle();
    };
    req.onblocked = () => {
      console.warn(`[idb-cleanup] T+${Date.now() - start}ms BLOCKED — proceeding anyway`);
      settle();
    };
    setTimeout(() => {
      if (!settled) {
        console.warn(`[idb-cleanup] T+${Date.now() - start}ms timeout after 3s — proceeding anyway`);
        settle();
      }
    }, 3000);
  });
}

// Console-callable recovery helper. Available as a fallback for users in a
// tab that hit the bug before the auto-cleanup shipped (or in any future
// scenario where the auto-cleanup couldn't run). Drops the DB so RS can
// recreate it cleanly on the next reload. Resolves once the deletion
// completes, or rejects with `'blocked'` if a stuck connection prevents it
// — at which point the user needs to close other tabs or quit Chrome.
if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  (window as any).__cleanupRSDb = () => new Promise<void>((resolve, reject) => {
    console.log(`[idb-cleanup] manual: deleteDatabase('remotestorage')`);
    const req = indexedDB.deleteDatabase('remotestorage');
    req.onsuccess = () => {
      console.log(`[idb-cleanup] deleted — reload the page now`);
      resolve();
    };
    req.onerror = () => {
      console.error(`[idb-cleanup] error`, req.error);
      reject(req.error);
    };
    req.onblocked = () => {
      console.warn(`[idb-cleanup] BLOCKED — close other tabs of this app, or quit Chrome and reopen`);
      reject(new Error('blocked'));
    };
  });
}

// Block module exports until the corrupt-DB recovery has run. Importers
// (stores.ts, etc.) get a guaranteed-clean RS instance with no race against
// the IDB feature init.
await detectAndRecoverCorruptDb();

const rs = new RemoteStorage({
  modules: [InboxModule, SharesModule],
  changeEvents: { local: true, window: false, remote: true, conflict: true },
});
if (
  typeof window !== 'undefined'
  && savedHash.startsWith('#/')
  && window.location.hash !== savedHash
) {
  window.history.replaceState(null, '', savedHash);
}

rs.access.claim('inbox', 'rw');
rs.access.claim('shares', 'rw');
rs.caching.enable('/inbox/');

/**
 * Fetch a file from an RS server using Authorization header and return a blob URL.
 * Exported separately for testability; the default export uses the singleton RS instance.
 *
 * The blob's MIME type is taken from `expectedMimeType` when provided, otherwise
 * from the server's Content-Type (with any `; charset=...` parameter stripped).
 * This matters because remotestoragejs's wireclient auto-appends `; charset=binary`
 * to binary uploads, and 5apps echoes that suffix back on GET. Some browsers —
 * Chrome among them — then refuse to render an `<img>` whose Blob type carries
 * the charset suffix, producing a valid-looking `blob:` URL that never paints.
 * Callers who know the intended type (all current call sites read `item.mimeType`)
 * should pass it so we never depend on the server's Content-Type staying clean.
 *
 * The bytes are passed through `recoverLegacyBinaryStringEncoding` to repair
 * files that were uploaded by the v1.8-and-earlier store path, which sent
 * the file body to the server as a UTF-8-encoded binary string. New uploads
 * are raw binary and pass through unchanged. See the helper's JSDoc for the
 * detection invariant.
 */
export async function fetchFileWithAuth(
  href: string,
  token: string,
  path: string,
  expectedMimeType?: string,
): Promise<string | null> {
  try {
    const url = `${href}/inbox/${path}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    const serverType = resp.headers.get('Content-Type') ?? '';
    const cleanType =
      expectedMimeType?.trim() ||
      serverType.split(';')[0].trim() ||
      'application/octet-stream';
    const buffer = recoverLegacyBinaryStringEncoding(await resp.arrayBuffer());
    return URL.createObjectURL(new Blob([buffer], { type: cleanType }));
  } catch {
    return null;
  }
}

/**
 * Fetch an RS file using Authorization header and return a blob URL.
 * Works with all RS servers (5apps requires Bearer header, not query params).
 * Returns null if not connected or fetch fails.
 */
export async function fetchFileBlobUrl(path: string, expectedMimeType?: string): Promise<string | null> {
  const remote = (rs as any).remote;
  if (!remote?.href || !remote?.token) return null;
  return fetchFileWithAuth(remote.href, remote.token, path, expectedMimeType);
}

export default rs;
