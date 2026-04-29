/**
 * Shared remoteStorage runtime helpers.
 *
 * Browser-extension environments (Chrome MV3, Firefox WebExtensions, Thunderbird)
 * share the same end-to-end flow: WebFinger discovery → implicit-grant OAuth →
 * direct HTTP PUTs against the storage API. The full `remotestoragejs` stack
 * isn't a great fit there — service workers are short-lived, sync state can't
 * persist across wake-ups, and we only ever need a few storage operations.
 *
 * This module captures that shared flow as small, environment-agnostic
 * primitives. Each app surface (extension, thunderbird) supplies the platform
 * glue (a launcher for `*.identity.launchWebAuthFlow`, a client id, and a
 * `browser.storage.local`-shaped storage area). Everything else — discovery,
 * token extraction, the direct-PUT client, and config persistence — lives here
 * so it stays consistent across packages and is independently testable.
 */

/** Persisted storage configuration. */
export interface RSConfig {
  userAddress: string;
  token?: string;
  href?: string;
  storageApi?: string;
}

/** Result of WebFinger discovery for a remoteStorage user address. */
export interface RSDiscovery {
  /** Storage root URL (no trailing slash). */
  href: string;
  /** Reported RS spec version, when present. */
  storageApi?: string;
  /** OAuth authorization endpoint. */
  authUrl: string;
}

/** Subset of the `fetch` API we use — narrow so it's easy to stub in tests. */
type FetchLike = typeof fetch;

/** Default storage key used by `createConfigStore`. */
export const DEFAULT_CONFIG_STORAGE_KEY = 'inbox-rs-config';

const RS_LINK_RELS = new Set([
  'http://tools.ietf.org/id/draft-dejong-remotestorage',
  'remotestorage',
]);

const AUTH_URL_PROPS = [
  'http://tools.ietf.org/html/rfc6749#section-4.2',
  'http://tools.ietf.org/html/rfc6749#section-4.2.1',
  'auth-endpoint',
  'auth-url',
] as const;

/**
 * Validate and split a remoteStorage user address into its `[user, host]`
 * components. Throws if the address isn't of the form `user@host`.
 */
export function parseUserAddress(userAddress: string): {
  user: string;
  host: string;
} {
  const parts = userAddress.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      'Invalid remoteStorage address. Expected format: user@host',
    );
  }
  return { user: parts[0], host: parts[1] };
}

/**
 * Pick the right URL scheme for a host. Localhost dev servers don't have TLS,
 * so we fall back to plain HTTP for them — every other host gets HTTPS.
 */
export function schemeForHost(host: string): 'http' | 'https' {
  return host === 'localhost' || host.startsWith('localhost:')
    ? 'http'
    : 'https';
}

/**
 * Run WebFinger discovery for a remoteStorage user address.
 *
 * Returns the storage root URL, the reported RS spec version (if any), and
 * the OAuth authorization endpoint. Throws on any malformed input or response.
 */
export async function discoverStorage(
  userAddress: string,
  fetchImpl: FetchLike = fetch,
): Promise<RSDiscovery> {
  const { host } = parseUserAddress(userAddress);
  const scheme = schemeForHost(host);
  const webfingerUrl = `${scheme}://${host}/.well-known/webfinger?resource=acct:${encodeURIComponent(userAddress)}`;

  const response = await fetchImpl(webfingerUrl);
  if (!response.ok) throw new Error(`WebFinger failed: ${response.status}`);
  const data = await response.json();

  const rsLink = Array.isArray(data?.links)
    ? data.links.find((link: any) => RS_LINK_RELS.has(link?.rel))
    : undefined;
  if (!rsLink) throw new Error('No remoteStorage link found in WebFinger');

  const href: string | undefined = rsLink.href;
  if (!href) throw new Error('remoteStorage link missing href');

  const props = rsLink.properties ?? {};
  const storageApi: string | undefined =
    rsLink.type ?? props['http://remotestorage.io/spec/version'];

  let authUrl: string | undefined;
  for (const key of AUTH_URL_PROPS) {
    if (typeof props[key] === 'string') {
      authUrl = props[key];
      break;
    }
  }
  if (!authUrl) throw new Error('No OAuth endpoint found');

  return { href, storageApi, authUrl };
}

/**
 * Extract the access token from an OAuth implicit-grant redirect URL.
 *
 * remoteStorage providers may put the token in either the URL fragment
 * (`#access_token=...`) or the query string (`?access_token=...`). Errors
 * follow the same convention. Throws on any error response or missing token.
 */
export function extractTokenFromRedirect(resultUrl: string): string {
  const parsed = new URL(resultUrl);
  const hashParams = new URLSearchParams(
    parsed.hash.startsWith('#') ? parsed.hash.substring(1) : parsed.hash,
  );
  const queryParams = parsed.searchParams;

  const oauthError = hashParams.get('error') || queryParams.get('error');
  if (oauthError) {
    const desc =
      hashParams.get('error_description') ||
      queryParams.get('error_description') ||
      '';
    throw new Error(`OAuth error: ${oauthError}${desc ? ` — ${desc}` : ''}`);
  }

  const token =
    hashParams.get('access_token') || queryParams.get('access_token');
  if (!token) throw new Error('No access token in OAuth response');
  return token;
}

/** Options accepted by {@link connectViaOAuth}. */
export interface ConnectViaOAuthOptions {
  /** OAuth `client_id` to send. Extension uses the redirect origin; Thunderbird uses a static id. */
  clientId: string;
  /** OAuth `redirect_uri` to send. Should match what `launchAuthFlow` will receive. */
  redirectUrl: string;
  /** OAuth scope. Defaults to `inbox:rw`. */
  scope?: string;
  /** Launches the OAuth flow at `authUrl` and resolves with the redirect URL. */
  launchAuthFlow: (authUrl: string) => Promise<string>;
  /** Override `fetch` for testing or for environments without a global. */
  fetchImpl?: FetchLike;
}

const DEFAULT_OAUTH_SCOPE = 'inbox:rw';

/**
 * End-to-end OAuth connect: discovery → implicit-grant flow → token extraction.
 *
 * The caller supplies the platform-specific bits (client id, redirect URL,
 * launcher) — everything else is shared across extensions.
 */
export async function connectViaOAuth(
  userAddress: string,
  options: ConnectViaOAuthOptions,
): Promise<RSConfig> {
  const discovery = await discoverStorage(userAddress, options.fetchImpl);

  const oauthParams = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUrl,
    response_type: 'token',
    scope: options.scope ?? DEFAULT_OAUTH_SCOPE,
  });
  const fullAuthUrl = `${discovery.authUrl}?${oauthParams.toString()}`;

  const resultUrl = await options.launchAuthFlow(fullAuthUrl);
  const token = extractTokenFromRedirect(resultUrl);

  return {
    userAddress,
    token,
    href: discovery.href,
    storageApi: discovery.storageApi,
  };
}

/**
 * Direct HTTP client for remoteStorage object/file PUTs.
 *
 * Used in extension/Thunderbird contexts where the full remotestoragejs sync
 * stack is impractical. Operates against the configured `inbox/` namespace.
 */
export class DirectRS {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: RSConfig,
    fetchImpl: FetchLike = fetch,
  ) {
    if (!config.href) throw new Error('DirectRS requires config.href');
    if (!config.token) throw new Error('DirectRS requires config.token');
    // Bind to globalThis so member-access calls (`this.fetchImpl(...)`) don't
    // trip the browser's "Illegal invocation" check, which requires `this`
    // on the global `fetch` to be the Window. Without this, calling
    // `this.fetchImpl(...)` resolves `this` to the DirectRS instance and
    // browsers throw `TypeError: Failed to execute 'fetch' on 'Window':
    // Illegal invocation`. Bind is a no-op for already-bound impls (the
    // first bind wins) and for test mocks, whose call records still update
    // through the bound delegate.
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  private get headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.token!}` };
  }

  private url(path: string): string {
    return `${this.config.href}/inbox/${path}`;
  }

  /** PUT a JSON object to `inbox/<path>`. Throws on non-2xx. */
  async storeObject(path: string, obj: object): Promise<void> {
    const response = await this.fetchImpl(this.url(path), {
      method: 'PUT',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    if (!response.ok) throw new Error(`Store failed: ${response.status}`);
  }

  /** PUT raw bytes to `inbox/<path>`. Throws on non-2xx. */
  async storeFile(
    path: string,
    data: ArrayBuffer,
    mimeType: string,
  ): Promise<void> {
    const response = await this.fetchImpl(this.url(path), {
      method: 'PUT',
      headers: { ...this.headers, 'Content-Type': mimeType },
      body: data,
    });
    if (!response.ok) throw new Error(`Store file failed: ${response.status}`);
  }

  /**
   * Store an inbox item. If `fileData` is provided and the item declares a
   * `filePath`/`mimeType`, the file is uploaded first, then the item metadata.
   */
  async store(
    item: { id: string; filePath?: string; mimeType?: string },
    fileData?: ArrayBuffer,
  ): Promise<void> {
    if (fileData && item.filePath && item.mimeType) {
      await this.storeFile(item.filePath, fileData, item.mimeType);
    }
    await this.storeObject(`items/${item.id}`, item);
  }
}

/**
 * Subset of `browser.storage.local` (and `chrome.storage.local`) we use.
 * Defining it here lets `createConfigStore` accept either polyfilled or
 * native storage areas without dragging in a webextension-polyfill dep.
 *
 * Only single-string keys are required because that's all the config store
 * ever passes — keeping the interface narrow lets it match Thunderbird's
 * stricter type declarations as well as the more permissive polyfill types.
 */
export interface BrowserStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Persistence wrapper for {@link RSConfig} on top of a browser storage area. */
export interface ConfigStore {
  get(): Promise<RSConfig | null>;
  save(config: RSConfig): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Build a {@link ConfigStore} on top of a browser-storage area. Each app
 * surface wires this up once with its preferred storage backend.
 */
export function createConfigStore(
  storage: BrowserStorageArea,
  storageKey: string = DEFAULT_CONFIG_STORAGE_KEY,
): ConfigStore {
  return {
    async get(): Promise<RSConfig | null> {
      const result = await storage.get(storageKey);
      const value = result?.[storageKey];
      return (value as RSConfig | undefined) ?? null;
    },
    async save(config: RSConfig): Promise<void> {
      await storage.set({ [storageKey]: config });
    },
    async clear(): Promise<void> {
      await storage.remove(storageKey);
    },
  };
}
