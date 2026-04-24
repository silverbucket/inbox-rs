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
const rs = new RemoteStorage({
  modules: [InboxModule, SharesModule],
  changeEvents: { local: true, window: false, remote: true, conflict: true }
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
