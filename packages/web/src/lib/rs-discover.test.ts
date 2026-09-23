import RemoteStorage from 'remotestoragejs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const REMOTESTORAGE_REL = 'http://tools.ietf.org/id/draft-dejong-remotestorage';
const AUTH_PROP_KEY = 'http://tools.ietf.org/html/rfc6749#section-4.2';

/** Minimal WebFinger JRD accepted by webfinger.js v3. */
function webfingerJrd(host: string) {
  return {
    subject: `acct:alice@${host}`,
    links: [
      {
        rel: REMOTESTORAGE_REL,
        href: `http://${host}/storage/alice`,
        type: 'draft-dejong-remotestorage-12',
        properties: {
          [AUTH_PROP_KEY]: `http://${host}/oauth`,
        },
      },
    ],
  };
}

function mockWebfingerFetch() {
  return vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/jrd+json' },
    json: async () => {
      const host = new URL(url).host;
      return webfingerJrd(host);
    },
    text: async () => JSON.stringify(webfingerJrd(new URL(url).host)),
  }));
}

/**
 * Regression guard for remotestoragejs beta.10 (regression #1384, fix #1386).
 *
 * beta.9 pulled in webfinger.js v3, which blocks localhost/private hosts
 * unless `allow_private_addresses` is set. The web app calls `rs.connect()`
 * (AccountSettings), which uses upstream `RemoteStorage.Discover` — not our
 * rs-module `discoverStorage` fetch helper. A custom Discover override lived
 * in rs.ts until beta.10 enabled private discovery by default upstream.
 */
describe('RemoteStorage.Discover (upstream beta.10)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockWebfingerFetch());
  });

  it('discovers localhost without the pre-beta.10 private-address rejection', async () => {
    const result = await RemoteStorage.Discover('alice@localhost:8000');

    expect(result.href).toBe('http://localhost:8000/storage/alice');
    const [webfingerUrl] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(webfingerUrl).toContain('localhost:8000/.well-known/webfinger');
    expect(webfingerUrl).toContain('acct:alice@localhost:8000');
  });

  it('discovers private-LAN hosts when upstream allowPrivateAddresses is enabled', async () => {
    const result = await RemoteStorage.Discover('alice@192.168.1.50:8000');

    expect(result.href).toBe('http://192.168.1.50:8000/storage/alice');
    const [webfingerUrl] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(webfingerUrl).toContain('192.168.1.50:8000/.well-known/webfinger');
  });

  it('rejects localhost before fetch when private addresses are disabled', async () => {
    const rs = new RemoteStorage({
      discovery: { allowPrivateAddresses: false },
    });
    rs.access.claim('inbox', 'rw');
    try {
      // Use an address not cached by the successful discovery above. connect()
      // translates WebFinger's rejection into the app-facing DiscoveryError.
      const error = await new Promise<unknown>((resolve) => {
        rs.on('error', resolve);
        rs.connect('alice@localhost:8001');
      });
      expect(error).toMatchObject({
        name: 'DiscoveryError',
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      // The discovery configuration is shared across instances.
      new RemoteStorage({ discovery: { allowPrivateAddresses: true } });
    }
  });
});
