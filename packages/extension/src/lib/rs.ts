import RemoteStorage from 'remotestoragejs';
import InboxModule from '@inbox-rs/rs-module';
import type { RSConfig } from './storage';

export function createRS(): RemoteStorage {
  const rs = new RemoteStorage({
    modules: [InboxModule],
    changeEvents: { local: false, window: false, remote: false, conflict: false }
  });

  rs.access.claim('inbox', 'rw');
  // No caching — extension makes direct remote requests
  return rs;
}

/**
 * Discover storage info via WebFinger, then do OAuth via
 * chrome.identity.launchWebAuthFlow so it works in extension context.
 */
export async function connectViaOAuth(userAddress: string): Promise<RSConfig> {
  // 1. WebFinger discovery
  const parts = userAddress.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid remoteStorage address. Expected format: user@host');
  }
  const host = parts[1];
  const scheme = (host === 'localhost' || host.startsWith('localhost:')) ? 'http' : 'https';
  const webfingerUrl = `${scheme}://${host}/.well-known/webfinger?resource=acct:${encodeURIComponent(userAddress)}`;
  const wfResp = await fetch(webfingerUrl);
  if (!wfResp.ok) throw new Error(`WebFinger failed: ${wfResp.status}`);
  const wfData = await wfResp.json();

  // Find remoteStorage link
  const rsLink = wfData.links?.find((l: any) =>
    l.rel === 'http://tools.ietf.org/id/draft-dejong-remotestorage' ||
    l.rel === 'remotestorage'
  );
  if (!rsLink) throw new Error('No remoteStorage link found in WebFinger');

  const href = rsLink.href;
  const storageApi = rsLink.type || rsLink.properties?.['http://remotestorage.io/spec/version'];
  const props = rsLink.properties || {};
  const authUrl = props['http://tools.ietf.org/html/rfc6749#section-4.2']
    || props['http://tools.ietf.org/html/rfc6749#section-4.2.1']
    || props['auth-endpoint']
    || props['auth-url'];
  if (!authUrl) throw new Error('No OAuth endpoint found');

  // 2. Build OAuth URL
  const redirectUrl = typeof chrome !== 'undefined' && chrome.identity
    ? chrome.identity.getRedirectURL()
    : browser.identity.getRedirectURL();

  const oauthParams = new URLSearchParams({
    client_id: 'inbox-rs-extension',
    redirect_uri: redirectUrl,
    response_type: 'token',
    scope: 'inbox:rw'
  });
  const fullAuthUrl = `${authUrl}?${oauthParams}`;

  // 3. Launch OAuth flow in a browser window
  const api = (typeof chrome !== 'undefined' && chrome.identity) ? chrome.identity : browser.identity;
  const resultUrl = await api.launchWebAuthFlow({
    url: fullAuthUrl,
    interactive: true
  });

  // 4. Extract token from redirect URL fragment
  const hash = new URL(resultUrl).hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  if (!token) throw new Error('No access token in OAuth response');

  return { userAddress, token, href, storageApi };
}

/**
 * Configure an RS instance with a previously obtained token.
 */
export function configureRS(rs: RemoteStorage, config: RSConfig): void {
  rs.remote.configure({
    userAddress: config.userAddress,
    href: config.href!,
    storageApi: config.storageApi!,
    token: config.token!,
    properties: undefined
  });
}

/**
 * Direct HTTP client for RS storage operations.
 * More reliable than the full RS stack in service worker context.
 */
export class DirectRS {
  constructor(private config: RSConfig) {}

  private get headers() {
    return { 'Authorization': `Bearer ${this.config.token}` };
  }

  private url(path: string): string {
    return `${this.config.href}/inbox/${path}`;
  }

  async storeObject(path: string, obj: object): Promise<void> {
    const resp = await fetch(this.url(path), {
      method: 'PUT',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });
    if (!resp.ok) throw new Error(`Store failed: ${resp.status}`);
  }

  async storeFile(path: string, data: ArrayBuffer, mimeType: string): Promise<void> {
    const resp = await fetch(this.url(path), {
      method: 'PUT',
      headers: { ...this.headers, 'Content-Type': mimeType },
      body: data
    });
    if (!resp.ok) throw new Error(`Store file failed: ${resp.status}`);
  }

  async store(item: any, fileData?: ArrayBuffer): Promise<void> {
    if (fileData && item.filePath) {
      await this.storeFile(item.filePath, fileData, item.mimeType);
    }
    await this.storeObject(`items/${item.id}`, item);
  }
}
