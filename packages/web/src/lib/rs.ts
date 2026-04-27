import RemoteStorage from 'remotestoragejs';
import WebFinger from 'webfinger.js';
import InboxModule, { recoverLegacyBinaryStringEncoding } from '@inbox-rs/rs-module';
import SharesModule from 'remotestorage-module-shares';

// Re-enable WebFinger lookups against localhost / private-IP RS servers.
//
// webfinger.js v3 (a transitive dep of remotestoragejs >=2.0.0-beta.9) added an
// `allow_private_addresses` config flag that defaults to `false`. With it off,
// `WebFinger#resolveAndValidateHost` throws `private or internal addresses are
// not allowed` *before* any HTTP request fires for any host that matches its
// private/localhost regex. rs.js's `Discover` constructs WebFinger without the
// flag, so `rs.connect("user@localhost:8000")` (and any private-LAN address)
// fails synchronously with a `DiscoveryError` and the app sits on
// "Connecting…" forever.
//
// The flag's threat model is server-side SSRF — it has no security value in a
// browser, where same-origin / CORS already gates cross-origin requests. We
// patch the prototype so every `lookup()` call from inside rs.js sees
// `allow_private_addresses: true`. This unblocks local dev against Armadietto
// and our e2e suite.
//
// Track removal at remotestorage/remotestorage.js#1384 — once rs.js sets the
// flag itself (or exposes it as a constructor option), this hack goes away.
{
  const proto = WebFinger.prototype as { lookup: (address: string) => Promise<unknown>; config: { allow_private_addresses: boolean } };
  const origLookup = proto.lookup;
  proto.lookup = function (address: string) {
    this.config.allow_private_addresses = true;
    return origLookup.call(this, address);
  };
}

// Detect and auto-recover a corrupt `remotestorage` IndexedDB before RS opens it.
//
// The corrupt state we're guarding against: any `remotestorage` DB that's
// missing one of the required object stores (`nodes`, plus `changes` at v2).
// RS's upgrade handler (`indexeddb.ts:327-340`) has
// `if (event.oldVersion !== 1) { createObjectStore('nodes') }` — i.e. it
// SKIPS creating `nodes` when upgrading from v1, on the assumption that v1
// already has it. When v1 is empty, the upgrade ends up creating only
// `changes`, then RS's onsuccess notices `nodes` is missing and calls
// `IndexedDB.clean()` to recover. But `clean()` doesn't close its own open
// connection first, so `deleteDatabase` blocks (no `onblocked` handler) and
// `clean()`'s callback never fires — leaving RS's IDB feature init Promise
// pending indefinitely. The 10s `IndexedDB.open` timer doesn't help: it was
// already cleared at onsuccess before `clean()` ran. In practice the app
// stalls for ~10s on every reload and falls back to LocalStorage; the exact
// mechanism for the wall-clock delay is browser-dependent (likely related
// to `deleteDatabase` blocked behavior). See remotestorage/remotestorage.js#1376.
//
// We key the deletion decision on the actual object-store schema, NOT on
// version. A healthy v1 DB with `nodes` is a legitimate state RS upgrades
// cleanly; deleting it would discard cached nodes and any queued offline
// changes. Only DBs missing the required stores actually hit the upstream
// bug.
//
// We use `indexedDB.databases()` (Chrome 71+, Safari 14+, Firefox 126+) as
// an existence gate so we never call `indexedDB.open(name)` without a
// version on a non-existent DB — that itself creates an empty v1, the very
// trap we're recovering from. After confirming the DB exists, we open it
// without a version (which doesn't trigger an upgrade) to read its actual
// `objectStoreNames`. The open-probe can hang if a previous-session
// `deleteDatabase` was aborted; we cap it at 2s and proceed.
async function detectAndRecoverCorruptDb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  if (typeof (indexedDB as any).databases === 'function') {
    try {
      const dbs = await (indexedDB as any).databases() as Array<{ name?: string; version?: number }>;
      if (!dbs.find((db) => db.name === 'remotestorage')) {
        console.log(`[idb-probe] no existing 'remotestorage' DB — RS will create one fresh`);
        return;
      }
    } catch (e) {
      // Fall through to the open-probe; on ancient browsers without
      // databases() we accept the empty-v1 risk for the rare no-DB case.
      console.warn(`[idb-probe] databases() threw — falling back to open-probe`, e);
    }
  }

  const probeStart = Date.now();
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

  // v1 schema: `nodes` only. v2 schema: `nodes` + `changes`. Either case
  // missing a required store is corrupt.
  const required = result.version >= 2 ? ['nodes', 'changes'] : ['nodes'];
  const missing = required.filter((s) => !result.stores.includes(s));
  if (missing.length === 0) {
    console.log(`[idb-probe] 'remotestorage' v${result.version} stores=[${result.stores.join(',')}] — healthy, RS can open it directly`);
    return;
  }
  console.warn(`[idb-probe] 'remotestorage' v${result.version} stores=[${result.stores.join(',')}] missing [${missing.join(',')}] — auto-cleaning before RS init`);
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
