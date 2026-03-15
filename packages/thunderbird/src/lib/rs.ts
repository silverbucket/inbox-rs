import type { RSConfig } from './storage';

/**
 * Discover storage info via WebFinger, then do OAuth via
 * browser.identity.launchWebAuthFlow.
 */
export async function connectViaOAuth(userAddress: string): Promise<RSConfig> {
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

  const redirectUrl = browser.identity.getRedirectURL();
  const oauthParams = new URLSearchParams({
    client_id: 'inbox-rs-thunderbird',
    redirect_uri: redirectUrl,
    response_type: 'token',
    scope: 'inbox:rw'
  });
  const fullAuthUrl = `${authUrl}?${oauthParams}`;

  const resultUrl = await browser.identity.launchWebAuthFlow({
    url: fullAuthUrl,
    interactive: true
  });

  const hash = new URL(resultUrl).hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  if (!token) throw new Error('No access token in OAuth response');

  return { userAddress, token, href, storageApi };
}

/**
 * Direct HTTP client for RS storage operations.
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

  async store(item: any): Promise<void> {
    await this.storeObject(`items/${item.id}`, item);
  }
}
