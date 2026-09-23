import InboxModule, {
  type InboxModuleExports,
  recoverLegacyBinaryStringEncoding,
} from '@inbox-rs/rs-module';
import SharesModule from 'remotestorage-module-shares';
import RemoteStorage from 'remotestoragejs';

/**
 * Shape of the remoteStorage instance once our modules are loaded.
 * remotestoragejs attaches each registered module's `exports` as a property
 * on the RS instance (e.g. `rs.inbox`), but its TypeScript types don't know
 * about our specific modules — this augments them.
 */
type SharesModuleExports = {
  list: (path?: string) => Promise<Record<string, unknown>>;
  get: (path: string) => Promise<unknown>;
  put: (
    path: string,
    body: ArrayBuffer | string,
    contentType: string,
  ) => Promise<unknown>;
  remove: (path: string) => Promise<unknown>;
  // The shares module exposes a couple of helper methods prefixed with `_`
  // — they're documented as semi-public utilities, but their typings aren't
  // exported. Listing them here keeps callers strongly typed.
  _formattedDate: (date: Date) => string;
  _isImage: (mime: string) => boolean;
};

/**
 * The internal `remote` object that remotestoragejs attaches to its main
 * instance. Only the bits we actually read are listed; everything else is
 * left untyped (the library's own published types don't expose any of this).
 */
type RSRemote = {
  href?: string;
  token?: string;
  connected?: boolean;
  put: (
    path: string,
    body: ArrayBuffer | string,
    contentType: string,
  ) => Promise<unknown>;
};

export type RSWithModules = RemoteStorage & {
  inbox: InboxModuleExports;
  shares: SharesModuleExports;
  remote: RSRemote;
};

const rs = new RemoteStorage({
  modules: [InboxModule, SharesModule],
  changeEvents: { local: true, window: false, remote: true, conflict: true },
}) as RSWithModules;

rs.access.claim('inbox', 'rw');
rs.access.claim('shares', 'rw');
rs.caching.enable('/inbox/');
// Binaries on demand: the parent ALL strategy would make sync proactively
// download EVERY file under /inbox/files/ to every device — gigabytes for a
// media-heavy inbox, and duplicated bandwidth since cards fetch bytes anyway.
// SEEN caches a file after the app first reads or writes it, so offline
// capture still lands in the local cache and viewed files stay available
// offline, but never-viewed files aren't pulled down. Nested caching rules
// override the parent by longest-prefix match. Metadata (items/, collections/,
// groups/, config/) keeps ALL and remains fully offline.
// NOTE: caching strategies are not persisted — this must run on every init,
// before the first sync (it does: module scope, ahead of any connect).
rs.caching.set('/inbox/files/', 'SEEN');

/**
 * Fetch a file from an RS server using Authorization header and return a blob URL.
 * Exported separately for testability; the default export uses the singleton RS instance.
 *
 * The blob's MIME type is taken from `expectedMimeType` when provided, otherwise
 * from the server's Content-Type (with any `; charset=...` parameter stripped).
 * Older remotestoragejs uploads included `; charset=binary`, which some
 * servers may still return for existing files. Some browsers cannot render
 * images from a Blob with that MIME parameter.
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
    // Encode each segment: paths are UUID-based today, but anything with a
    // space, '#', '?', or non-ASCII would otherwise fail silently (null).
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${href}/inbox/${encodedPath}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
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
export async function fetchFileBlobUrl(
  path: string,
  expectedMimeType?: string,
): Promise<string | null> {
  const remote = rs.remote;
  if (!remote?.href || !remote?.token) return null;
  return fetchFileWithAuth(remote.href, remote.token, path, expectedMimeType);
}

export default rs;
