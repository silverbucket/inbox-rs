import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `lib/rs.ts` is a thin glue layer that:
 *   1. resolves Thunderbird's `browser.identity.getRedirectURL()` for the
 *      OAuth `redirect_uri`,
 *   2. forwards `browser.identity.launchWebAuthFlow` as the launcher,
 *   3. delegates the rest to the shared `connectViaOAuth` in `@inbox-rs/rs-module`.
 *
 * If any of those wirings break the user can't authenticate at all — the
 * symptom we just shipped a fix for. These tests pin the wiring down.
 */

const { mockGetRedirectURL, mockLaunchWebAuthFlow } = vi.hoisted(() => ({
  mockGetRedirectURL: vi.fn<() => string>(),
  mockLaunchWebAuthFlow:
    vi.fn<(args: { url: string; interactive: boolean }) => Promise<string>>(),
}));

// Stub the ambient `browser` global before importing the module under test.
// The Thunderbird code uses `browser.identity.*` directly with no polyfill.
vi.stubGlobal('browser', {
  identity: {
    getRedirectURL: mockGetRedirectURL,
    launchWebAuthFlow: mockLaunchWebAuthFlow,
  },
});

// Stub `fetch` for the WebFinger discovery call inside `connectViaOAuth`.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { connectViaOAuth, DirectRS } from './rs';

const REMOTESTORAGE_REL = 'http://tools.ietf.org/id/draft-dejong-remotestorage';
const AUTH_PROP_KEY = 'http://tools.ietf.org/html/rfc6749#section-4.2';

function webfingerResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      links: [
        {
          rel: REMOTESTORAGE_REL,
          href: 'https://storage.example.com/storage/alice',
          type: 'draft-dejong-remotestorage-12',
          properties: { [AUTH_PROP_KEY]: 'https://storage.example.com/oauth' },
        },
      ],
    }),
  } as unknown as Response;
}

describe('connectViaOAuth (thunderbird)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedirectURL.mockReturnValue(
      'https://thunderbird.example/oauth-redirect',
    );
    mockFetch.mockResolvedValue(webfingerResponse());
    mockLaunchWebAuthFlow.mockResolvedValue(
      'https://thunderbird.example/oauth-redirect#access_token=tok-xyz',
    );
  });

  it('uses Thunderbird identity API and returns a populated RSConfig', async () => {
    const config = await connectViaOAuth('alice@example.com');

    expect(config).toEqual({
      userAddress: 'alice@example.com',
      token: 'tok-xyz',
      href: 'https://storage.example.com/storage/alice',
      storageApi: 'draft-dejong-remotestorage-12',
    });
    expect(mockGetRedirectURL).toHaveBeenCalled();
    expect(mockLaunchWebAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({ interactive: true }),
    );
  });

  /**
   * REGRESSION: a previous version passed a static `'inbox-rs-thunderbird'`
   * as `client_id`. Most spec-compliant remoteStorage servers (Armadietto in
   * particular) require `client_id` to match the origin of `redirect_uri`
   * and reject anything else with `OAuth error: invalid_client`. Pin the
   * derivation so this can't silently regress to a static identifier.
   */
  it('derives client_id from the redirect_uri origin (not a static identifier)', async () => {
    await connectViaOAuth('alice@example.com');

    const launchedUrl = mockLaunchWebAuthFlow.mock.calls[0]![0].url;
    const params = new URL(launchedUrl).searchParams;
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');

    expect(redirectUri).toBe('https://thunderbird.example/oauth-redirect');
    expect(clientId).toBe('https://thunderbird.example');
    // The invariant: client_id must equal the origin of redirect_uri.
    expect(clientId).toBe(new URL(redirectUri!).origin);
    expect(params.get('response_type')).toBe('token');
    expect(params.get('scope')).toBe('inbox:rw');
  });

  it('uses a different origin when the redirect URL changes', async () => {
    // If Thunderbird ever rotates the per-extension redirect host (it does,
    // periodically), the client_id must follow. This guards against any
    // cached/static derivation creeping back in.
    mockGetRedirectURL.mockReturnValueOnce('https://other-host.allizom.org/cb');
    mockLaunchWebAuthFlow.mockResolvedValueOnce(
      'https://other-host.allizom.org/cb#access_token=t',
    );

    await connectViaOAuth('alice@example.com');

    const launchedUrl = mockLaunchWebAuthFlow.mock.calls[0]![0].url;
    const params = new URL(launchedUrl).searchParams;
    expect(params.get('client_id')).toBe('https://other-host.allizom.org');
    expect(params.get('redirect_uri')).toBe(
      'https://other-host.allizom.org/cb',
    );
  });

  it('issues the WebFinger request to the user-supplied host', async () => {
    await connectViaOAuth('alice@example.com');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/.well-known/webfinger?resource=acct:alice%40example.com',
    );
  });

  /**
   * REGRESSION: WebFinger discovery `fetch()` must be allowed to reach the
   * RS host. The Thunderbird MV2 manifest used to omit host_permissions
   * entirely, so this fetch was blocked by CORS and the Connect flow died
   * before OAuth even started. The test for the *manifest* lives in
   * `manifest.test.ts` — this test pins down the connection logic itself
   * so a future refactor can't silently regress to "swallow the WebFinger
   * error and pretend everything succeeded".
   */
  it('propagates a WebFinger failure as an error (does not silently succeed)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 0, // What MV2 CORS rejection looks like in practice.
    } as Response);

    await expect(connectViaOAuth('alice@example.com')).rejects.toThrow(
      /WebFinger failed/,
    );
  });

  it('propagates an OAuth error in the redirect URL', async () => {
    mockLaunchWebAuthFlow.mockResolvedValueOnce(
      'https://thunderbird.example/oauth-redirect#error=access_denied',
    );

    await expect(connectViaOAuth('alice@example.com')).rejects.toThrow(
      /access_denied/,
    );
  });

  it('propagates a malformed user address before any network call', async () => {
    await expect(connectViaOAuth('not-a-user-address')).rejects.toThrow(
      /Invalid remoteStorage address/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLaunchWebAuthFlow).not.toHaveBeenCalled();
  });
});

describe('DirectRS export (thunderbird)', () => {
  it('re-exports DirectRS from @inbox-rs/rs-module', () => {
    expect(DirectRS).toBeDefined();
    expect(typeof DirectRS).toBe('function');
  });
});
