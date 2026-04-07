import RemoteStorage from 'remotestoragejs';
import InboxModule from '@inbox-rs/rs-module';
import SharesModule from 'remotestorage-module-shares';

const rs = new RemoteStorage({
  modules: [InboxModule, SharesModule],
  changeEvents: { local: true, window: false, remote: true, conflict: true }
});

rs.access.claim('inbox', 'rw');
rs.access.claim('shares', 'rw');
rs.caching.enable('/inbox/');
rs.setSyncInterval(3000);

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

/**
 * @deprecated Use fetchFileBlobUrl instead — query-param auth doesn't work on all RS servers (e.g. 5apps).
 */
export function getFileUrl(path: string): string | null {
  const remote = (rs as any).remote;
  if (!remote?.href || !remote?.token) return null;
  return `${remote.href}/inbox/${path}?access_token=${encodeURIComponent(remote.token)}`;
}

export default rs;
