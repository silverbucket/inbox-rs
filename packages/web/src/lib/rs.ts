import RemoteStorage from 'remotestoragejs';
import InboxModule from '@inbox-rs/rs-module';
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
 */
export async function fetchFileWithAuth(
  href: string,
  token: string,
  path: string,
): Promise<string | null> {
  try {
    const url = `${href}/inbox/${path}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * Fetch an RS file using Authorization header and return a blob URL.
 * Works with all RS servers (5apps requires Bearer header, not query params).
 * Returns null if not connected or fetch fails.
 */
export async function fetchFileBlobUrl(path: string): Promise<string | null> {
  const remote = (rs as any).remote;
  if (!remote?.href || !remote?.token) return null;
  return fetchFileWithAuth(remote.href, remote.token, path);
}

export default rs;
