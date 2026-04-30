import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `lib/rs.ts` is a thin glue layer that:
 *   1. picks the right identity API (`chrome.identity` for Chrome,
 *      `browser.identity` for Firefox / WebExtensions polyfill),
 *   2. resolves `getRedirectURL()` for the OAuth `redirect_uri`,
 *   3. forwards `launchWebAuthFlow` as the launcher,
 *   4. derives the OAuth `client_id` from the redirect URL's origin
 *      (the remoteStorage spec convention; servers like Armadietto reject
 *      anything else with `OAuth error: invalid_client`),
 *   5. delegates the rest to the shared `connectViaOAuth` in
 *      `@inbox-rs/rs-module`.
 *
 * Each of those wirings, if broken, causes a different production failure
 * (no auth at all, wrong scope, wrong client_id, hung popup). These tests
 * pin every one of them down so the same regression class can't recur in
 * Chrome the way it just did in Thunderbird.
 */

const {
  mockChromeGetRedirectURL,
  mockChromeLaunchWebAuthFlow,
  mockBrowserGetRedirectURL,
  mockBrowserLaunchWebAuthFlow,
  mockFetch,
} = vi.hoisted(() => ({
  mockChromeGetRedirectURL: vi.fn<() => string>(),
  mockChromeLaunchWebAuthFlow:
    vi.fn<(args: { url: string; interactive: boolean }) => Promise<string>>(),
  mockBrowserGetRedirectURL: vi.fn<() => string>(),
  mockBrowserLaunchWebAuthFlow:
    vi.fn<(args: { url: string; interactive: boolean }) => Promise<string>>(),
  mockFetch: vi.fn(),
}));

// `lib/rs.ts` uses a bare `browser` global (no `import browser from
// 'webextension-polyfill'` in that file specifically) — in production the
// polyfill loads elsewhere in the bundle and assigns `globalThis.browser`.
// The polyfill mock here covers files that DO import it; the global stub
// at the top covers `lib/rs.ts`'s direct use.
vi.mock('webextension-polyfill', () => ({
  default: {
    identity: {
      getRedirectURL: mockBrowserGetRedirectURL,
      launchWebAuthFlow: mockBrowserLaunchWebAuthFlow,
    },
  },
}));

vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('browser', {
  identity: {
    getRedirectURL: mockBrowserGetRedirectURL,
    launchWebAuthFlow: mockBrowserLaunchWebAuthFlow,
  },
});

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

// Import once for module-resolution; tests stub the chrome global before
// each invocation since `getIdentityApi` reads it lazily.
import { connectViaOAuth, DirectRS } from './rs';

describe('connectViaOAuth (chrome/firefox)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(webfingerResponse());
  });

  afterEach(() => {
    // Each test sets up `chrome` itself; clear it after so the next test's
    // setup is the only signal. Re-stub the always-needed globals.
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('browser', {
      identity: {
        getRedirectURL: mockBrowserGetRedirectURL,
        launchWebAuthFlow: mockBrowserLaunchWebAuthFlow,
      },
    });
  });

  describe('identity API selection', () => {
    it('uses chrome.identity when present (Chrome)', async () => {
      vi.stubGlobal('chrome', {
        identity: {
          getRedirectURL: mockChromeGetRedirectURL,
          launchWebAuthFlow: mockChromeLaunchWebAuthFlow,
        },
      });
      mockChromeGetRedirectURL.mockReturnValue('https://abc.chromiumapp.org/');
      mockChromeLaunchWebAuthFlow.mockResolvedValue(
        'https://abc.chromiumapp.org/#access_token=tok-chrome',
      );

      const config = await connectViaOAuth('alice@example.com');

      expect(config.token).toBe('tok-chrome');
      expect(mockChromeGetRedirectURL).toHaveBeenCalled();
      expect(mockChromeLaunchWebAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({ interactive: true }),
      );
      // The Firefox/polyfill API must NOT have been used.
      expect(mockBrowserGetRedirectURL).not.toHaveBeenCalled();
      expect(mockBrowserLaunchWebAuthFlow).not.toHaveBeenCalled();
    });

    it('falls back to browser.identity when chrome is undefined (Firefox)', async () => {
      // Don't stub `chrome` — `typeof chrome !== 'undefined'` will be false
      // and the wrapper falls through to the polyfilled `browser.identity`.
      mockBrowserGetRedirectURL.mockReturnValue('https://abc.allizom.org/');
      mockBrowserLaunchWebAuthFlow.mockResolvedValue(
        'https://abc.allizom.org/#access_token=tok-firefox',
      );

      const config = await connectViaOAuth('alice@example.com');

      expect(config.token).toBe('tok-firefox');
      expect(mockBrowserGetRedirectURL).toHaveBeenCalled();
      expect(mockBrowserLaunchWebAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({ interactive: true }),
      );
      expect(mockChromeGetRedirectURL).not.toHaveBeenCalled();
    });

    it('falls back to browser.identity when chrome is defined but lacks identity', async () => {
      // Some old MV2 polyfill setups expose `chrome` without `identity`.
      vi.stubGlobal('chrome', { runtime: {} } as any);
      mockBrowserGetRedirectURL.mockReturnValue('https://abc.allizom.org/');
      mockBrowserLaunchWebAuthFlow.mockResolvedValue(
        'https://abc.allizom.org/#access_token=t',
      );

      await connectViaOAuth('alice@example.com');

      expect(mockBrowserGetRedirectURL).toHaveBeenCalled();
      expect(mockChromeGetRedirectURL).not.toHaveBeenCalled();
    });
  });

  describe('OAuth parameters', () => {
    beforeEach(() => {
      vi.stubGlobal('chrome', {
        identity: {
          getRedirectURL: mockChromeGetRedirectURL,
          launchWebAuthFlow: mockChromeLaunchWebAuthFlow,
        },
      });
      mockChromeGetRedirectURL.mockReturnValue(
        'https://abcdef.chromiumapp.org/',
      );
      mockChromeLaunchWebAuthFlow.mockResolvedValue(
        'https://abcdef.chromiumapp.org/#access_token=t',
      );
    });

    /**
     * REGRESSION: a previous version of the Thunderbird wrapper passed a
     * static identifier as `client_id` and Armadietto rejected it as
     * `invalid_client`. The Chrome wrapper has always derived it from the
     * redirect origin — pin that down here so it can't regress to a static
     * value the way Thunderbird did.
     */
    it('derives client_id from the redirect_uri origin', async () => {
      await connectViaOAuth('alice@example.com');

      const launchedUrl = mockChromeLaunchWebAuthFlow.mock.calls[0]?.[0].url;
      const params = new URL(launchedUrl).searchParams;
      const clientId = params.get('client_id');
      const redirectUri = params.get('redirect_uri');

      expect(redirectUri).toBe('https://abcdef.chromiumapp.org/');
      expect(clientId).toBe('https://abcdef.chromiumapp.org');
      expect(clientId).toBe(new URL(redirectUri!).origin);
    });

    it('uses a different client_id when the redirect URL changes', async () => {
      mockChromeGetRedirectURL.mockReturnValueOnce(
        'https://other.chromiumapp.org/cb',
      );
      mockChromeLaunchWebAuthFlow.mockResolvedValueOnce(
        'https://other.chromiumapp.org/cb#access_token=t',
      );

      await connectViaOAuth('alice@example.com');

      const launchedUrl = mockChromeLaunchWebAuthFlow.mock.calls[0]?.[0].url;
      const params = new URL(launchedUrl).searchParams;
      expect(params.get('client_id')).toBe('https://other.chromiumapp.org');
      expect(params.get('redirect_uri')).toBe(
        'https://other.chromiumapp.org/cb',
      );
    });

    it('uses inbox:rw as the OAuth scope', async () => {
      await connectViaOAuth('alice@example.com');

      const launchedUrl = mockChromeLaunchWebAuthFlow.mock.calls[0]?.[0].url;
      expect(new URL(launchedUrl).searchParams.get('scope')).toBe('inbox:rw');
    });

    it('uses implicit-grant response_type', async () => {
      await connectViaOAuth('alice@example.com');

      const launchedUrl = mockChromeLaunchWebAuthFlow.mock.calls[0]?.[0].url;
      expect(new URL(launchedUrl).searchParams.get('response_type')).toBe(
        'token',
      );
    });

    it('passes interactive:true to launchWebAuthFlow', async () => {
      await connectViaOAuth('alice@example.com');

      expect(mockChromeLaunchWebAuthFlow).toHaveBeenCalledWith({
        url: expect.any(String),
        interactive: true,
      });
    });
  });

  describe('discovery + token extraction wiring', () => {
    beforeEach(() => {
      vi.stubGlobal('chrome', {
        identity: {
          getRedirectURL: mockChromeGetRedirectURL,
          launchWebAuthFlow: mockChromeLaunchWebAuthFlow,
        },
      });
      mockChromeGetRedirectURL.mockReturnValue('https://abc.chromiumapp.org/');
    });

    it('issues the WebFinger request to the user-supplied host', async () => {
      mockChromeLaunchWebAuthFlow.mockResolvedValue(
        'https://abc.chromiumapp.org/#access_token=t',
      );

      await connectViaOAuth('alice@example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/.well-known/webfinger?resource=acct:alice%40example.com',
      );
    });

    it('uses http for localhost addresses (dev server case)', async () => {
      mockChromeLaunchWebAuthFlow.mockResolvedValue(
        'https://abc.chromiumapp.org/#access_token=t',
      );

      await connectViaOAuth('alice@localhost:8000');

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url.startsWith('http://localhost:8000/')).toBe(true);
    });

    it('returns a populated RSConfig on success', async () => {
      mockChromeLaunchWebAuthFlow.mockResolvedValue(
        'https://abc.chromiumapp.org/#access_token=tok-success',
      );

      const config = await connectViaOAuth('alice@example.com');

      expect(config).toEqual({
        userAddress: 'alice@example.com',
        token: 'tok-success',
        href: 'https://storage.example.com/storage/alice',
        storageApi: 'draft-dejong-remotestorage-12',
      });
    });

    it('propagates a WebFinger failure (does not silently succeed)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 0 } as Response);

      await expect(connectViaOAuth('alice@example.com')).rejects.toThrow(
        /WebFinger failed/,
      );
    });

    it('propagates an OAuth error in the redirect URL', async () => {
      mockChromeLaunchWebAuthFlow.mockResolvedValueOnce(
        'https://abc.chromiumapp.org/#error=access_denied',
      );

      await expect(connectViaOAuth('alice@example.com')).rejects.toThrow(
        /access_denied/,
      );
    });

    it('propagates an invalid_client OAuth error (the bug class that just bit Thunderbird)', async () => {
      mockChromeLaunchWebAuthFlow.mockResolvedValueOnce(
        'https://abc.chromiumapp.org/#error=invalid_client&error_description=client%20not%20registered',
      );

      await expect(connectViaOAuth('alice@example.com')).rejects.toThrow(
        /invalid_client/,
      );
    });

    it('rejects on a malformed user address before any network or OAuth call', async () => {
      await expect(connectViaOAuth('not-a-user-address')).rejects.toThrow(
        /Invalid remoteStorage address/,
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockChromeLaunchWebAuthFlow).not.toHaveBeenCalled();
    });
  });
});

describe('DirectRS export (chrome/firefox)', () => {
  it('re-exports DirectRS from @inbox-rs/rs-module', () => {
    expect(DirectRS).toBeDefined();
    expect(typeof DirectRS).toBe('function');
  });
});
