import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DirectRS,
  connectViaOAuth,
  createConfigStore,
  discoverStorage,
  extractTokenFromRedirect,
  parseUserAddress,
  schemeForHost,
  DEFAULT_CONFIG_STORAGE_KEY,
  type BrowserStorageArea,
  type RSConfig,
} from './runtime.js';

/** Build a minimal `Response`-like stub for fetch mocks. */
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function emptyResponse(init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
  } as unknown as Response;
}

const REMOTESTORAGE_REL = 'http://tools.ietf.org/id/draft-dejong-remotestorage';
const AUTH_PROP_KEY = 'http://tools.ietf.org/html/rfc6749#section-4.2';
const SPEC_VERSION_KEY = 'http://remotestorage.io/spec/version';

function webfingerBody(overrides?: { authProp?: string; href?: string; rel?: string; type?: string }) {
  const props: Record<string, string> = {};
  const authKey = overrides?.authProp ?? AUTH_PROP_KEY;
  props[authKey] = 'https://storage.example.com/oauth';
  return {
    links: [
      {
        rel: overrides?.rel ?? REMOTESTORAGE_REL,
        href: overrides?.href ?? 'https://storage.example.com/storage/alice',
        type: overrides?.type ?? 'draft-dejong-remotestorage-12',
        properties: props,
      },
    ],
  };
}

describe('parseUserAddress', () => {
  it('splits a valid address into user and host', () => {
    expect(parseUserAddress('alice@example.com')).toEqual({ user: 'alice', host: 'example.com' });
  });

  it('preserves a port in the host', () => {
    expect(parseUserAddress('alice@localhost:8000')).toEqual({ user: 'alice', host: 'localhost:8000' });
  });

  it.each([
    ['no @ sign', 'invalid'],
    ['empty user', '@example.com'],
    ['empty host', 'alice@'],
    ['empty string', ''],
  ])('throws on %s', (_label, address) => {
    expect(() => parseUserAddress(address)).toThrow(/Invalid remoteStorage address/);
  });
});

describe('schemeForHost', () => {
  it('uses http for localhost and localhost:<port>', () => {
    expect(schemeForHost('localhost')).toBe('http');
    expect(schemeForHost('localhost:8000')).toBe('http');
  });

  it('uses https for everything else', () => {
    expect(schemeForHost('example.com')).toBe('https');
    expect(schemeForHost('5apps.com')).toBe('https');
  });
});

describe('discoverStorage', () => {
  it('returns href, storageApi, and authUrl from a valid WebFinger response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));

    const result = await discoverStorage('alice@example.com', fetchImpl);

    expect(result).toEqual({
      href: 'https://storage.example.com/storage/alice',
      storageApi: 'draft-dejong-remotestorage-12',
      authUrl: 'https://storage.example.com/oauth',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/.well-known/webfinger?resource=acct:alice%40example.com',
    );
  });

  it('uses http scheme for localhost addresses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));

    await discoverStorage('alice@localhost:8000', fetchImpl);

    const calledUrl = fetchImpl.mock.calls[0]![0] as string;
    expect(calledUrl.startsWith('http://localhost:8000/')).toBe(true);
  });

  it('URL-encodes the user address in the resource parameter', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));

    await discoverStorage('user+tag@example.com', fetchImpl);

    const calledUrl = fetchImpl.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('resource=acct:user%2Btag%40example.com');
  });

  it('falls back to spec-version property when type is missing', async () => {
    const body = webfingerBody();
    delete (body.links[0] as any).type;
    body.links[0].properties[SPEC_VERSION_KEY] = 'draft-dejong-remotestorage-05';
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));

    const result = await discoverStorage('alice@example.com', fetchImpl);

    expect(result.storageApi).toBe('draft-dejong-remotestorage-05');
  });

  it('accepts the legacy `remotestorage` rel', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody({ rel: 'remotestorage' })));

    const result = await discoverStorage('alice@example.com', fetchImpl);

    expect(result.href).toBe('https://storage.example.com/storage/alice');
  });

  it('accepts auth URL via auth-endpoint property as fallback', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody({ authProp: 'auth-endpoint' })));

    const result = await discoverStorage('alice@example.com', fetchImpl);

    expect(result.authUrl).toBe('https://storage.example.com/oauth');
  });

  it('throws when WebFinger returns a non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 404 }));

    await expect(discoverStorage('alice@example.com', fetchImpl)).rejects.toThrow('WebFinger failed: 404');
  });

  it('throws when no remoteStorage link is present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ links: [{ rel: 'http://other' }] }));

    await expect(discoverStorage('alice@example.com', fetchImpl)).rejects.toThrow(
      /No remoteStorage link found/,
    );
  });

  it('throws when remoteStorage link has no auth URL', async () => {
    const body = webfingerBody();
    body.links[0].properties = {};
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));

    await expect(discoverStorage('alice@example.com', fetchImpl)).rejects.toThrow(
      /No OAuth endpoint found/,
    );
  });

  it('throws when remoteStorage link has no href', async () => {
    const body = webfingerBody();
    delete (body.links[0] as any).href;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));

    await expect(discoverStorage('alice@example.com', fetchImpl)).rejects.toThrow(
      /remoteStorage link missing href/,
    );
  });

  it('throws on a malformed user address before fetching', async () => {
    const fetchImpl = vi.fn();

    await expect(discoverStorage('bogus', fetchImpl)).rejects.toThrow(/Invalid remoteStorage address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('extractTokenFromRedirect', () => {
  it('reads access_token from the URL fragment', () => {
    const token = extractTokenFromRedirect('https://callback.example/#access_token=abc123&token_type=bearer');
    expect(token).toBe('abc123');
  });

  it('reads access_token from the query string', () => {
    const token = extractTokenFromRedirect('https://callback.example/?access_token=xyz789');
    expect(token).toBe('xyz789');
  });

  it('prefers fragment over query when both present', () => {
    const token = extractTokenFromRedirect(
      'https://callback.example/?access_token=query#access_token=fragment',
    );
    expect(token).toBe('fragment');
  });

  it('throws on OAuth error in fragment with description', () => {
    expect(() =>
      extractTokenFromRedirect(
        'https://callback.example/#error=access_denied&error_description=user%20declined',
      ),
    ).toThrow('OAuth error: access_denied — user declined');
  });

  it('throws on OAuth error in query', () => {
    expect(() =>
      extractTokenFromRedirect('https://callback.example/?error=invalid_scope'),
    ).toThrow('OAuth error: invalid_scope');
  });

  it('throws when no token and no error are present', () => {
    expect(() => extractTokenFromRedirect('https://callback.example/')).toThrow(
      'No access token in OAuth response',
    );
  });
});

describe('connectViaOAuth', () => {
  it('runs discovery, launches the flow, and returns a populated RSConfig', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));
    const launchAuthFlow = vi
      .fn()
      .mockResolvedValue('https://callback.example/#access_token=token-abc');

    const config = await connectViaOAuth('alice@example.com', {
      clientId: 'inbox-rs-test',
      redirectUrl: 'https://callback.example/',
      launchAuthFlow,
      fetchImpl,
    });

    expect(config).toEqual({
      userAddress: 'alice@example.com',
      token: 'token-abc',
      href: 'https://storage.example.com/storage/alice',
      storageApi: 'draft-dejong-remotestorage-12',
    });
  });

  it('passes the discovered authUrl + OAuth params to the launcher', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));
    const launchAuthFlow = vi
      .fn()
      .mockResolvedValue('https://callback.example/#access_token=t');

    await connectViaOAuth('alice@example.com', {
      clientId: 'my-client',
      redirectUrl: 'https://callback.example/',
      scope: 'inbox:rw shares:rw',
      launchAuthFlow,
      fetchImpl,
    });

    const calledUrl = launchAuthFlow.mock.calls[0]![0] as string;
    const parsed = new URL(calledUrl);
    expect(parsed.origin + parsed.pathname).toBe('https://storage.example.com/oauth');
    expect(parsed.searchParams.get('client_id')).toBe('my-client');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://callback.example/');
    expect(parsed.searchParams.get('response_type')).toBe('token');
    expect(parsed.searchParams.get('scope')).toBe('inbox:rw shares:rw');
  });

  it('uses inbox:rw as the default scope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));
    const launchAuthFlow = vi
      .fn()
      .mockResolvedValue('https://callback.example/#access_token=t');

    await connectViaOAuth('alice@example.com', {
      clientId: 'c',
      redirectUrl: 'https://callback.example/',
      launchAuthFlow,
      fetchImpl,
    });

    const parsed = new URL(launchAuthFlow.mock.calls[0]![0] as string);
    expect(parsed.searchParams.get('scope')).toBe('inbox:rw');
  });

  it('propagates errors from the launcher', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));
    const launchAuthFlow = vi.fn().mockRejectedValue(new Error('user cancelled'));

    await expect(
      connectViaOAuth('alice@example.com', {
        clientId: 'c',
        redirectUrl: 'https://callback.example/',
        launchAuthFlow,
        fetchImpl,
      }),
    ).rejects.toThrow('user cancelled');
  });

  it('propagates OAuth errors from the redirect URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));
    const launchAuthFlow = vi
      .fn()
      .mockResolvedValue('https://callback.example/#error=access_denied');

    await expect(
      connectViaOAuth('alice@example.com', {
        clientId: 'c',
        redirectUrl: 'https://callback.example/',
        launchAuthFlow,
        fetchImpl,
      }),
    ).rejects.toThrow('OAuth error: access_denied');
  });

  /**
   * REGRESSION: this is the failure mode the user just hit on Thunderbird.
   * If the wrapper passes a `client_id` the server doesn't recognise, the
   * server replies with `error=invalid_client` in the redirect — and the
   * shared helper must surface it (not swallow it as a generic error).
   */
  it('propagates invalid_client from the OAuth redirect (the bug class that bit Thunderbird)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));
    const launchAuthFlow = vi
      .fn()
      .mockResolvedValue(
        'https://callback.example/#error=invalid_client&error_description=client%20not%20registered',
      );

    await expect(
      connectViaOAuth('alice@example.com', {
        clientId: 'inbox-rs-thunderbird', // the kind of bare identifier that triggers it
        redirectUrl: 'https://callback.example/',
        launchAuthFlow,
        fetchImpl,
      }),
    ).rejects.toThrow(/invalid_client/);
  });

  it('honours a custom scope override and includes it in the auth URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));
    const launchAuthFlow = vi
      .fn()
      .mockResolvedValue('https://callback.example/#access_token=t');

    await connectViaOAuth('alice@example.com', {
      clientId: 'c',
      redirectUrl: 'https://callback.example/',
      scope: 'inbox:r contacts:rw',
      launchAuthFlow,
      fetchImpl,
    });

    const params = new URL(launchAuthFlow.mock.calls[0]![0] as string).searchParams;
    expect(params.get('scope')).toBe('inbox:r contacts:rw');
  });

  it('does not append params to the discovered authUrl twice', async () => {
    // Sanity check that the URL is well-formed and parseable.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(webfingerBody()));
    const launchAuthFlow = vi
      .fn()
      .mockResolvedValue('https://callback.example/#access_token=t');

    await connectViaOAuth('alice@example.com', {
      clientId: 'c',
      redirectUrl: 'https://callback.example/',
      launchAuthFlow,
      fetchImpl,
    });

    const launchedUrl = new URL(launchAuthFlow.mock.calls[0]![0] as string);
    // We expect exactly four query params (client_id, redirect_uri,
    // response_type, scope). Anything else means the helper is appending
    // more than it should.
    const keys = Array.from(launchedUrl.searchParams.keys()).sort();
    expect(keys).toEqual(['client_id', 'redirect_uri', 'response_type', 'scope']);
  });
});

describe('DirectRS', () => {
  const config: RSConfig = {
    userAddress: 'alice@example.com',
    token: 'tok',
    href: 'https://storage.example.com/storage/alice',
    storageApi: 'draft-dejong-remotestorage-12',
  };

  it('throws when constructed without href', () => {
    expect(() => new DirectRS({ userAddress: 'a@b', token: 't' })).toThrow(/href/);
  });

  it('throws when constructed without token', () => {
    expect(
      () => new DirectRS({ userAddress: 'a@b', href: 'https://x' }),
    ).toThrow(/token/);
  });

  describe('storeObject', () => {
    it('PUTs JSON with bearer auth and returns void on 2xx', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      await rs.storeObject('items/abc', { id: 'abc', type: 'note' });

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://storage.example.com/storage/alice/inbox/items/abc',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer tok',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ id: 'abc', type: 'note' }),
        }),
      );
    });

    it('throws on non-2xx', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse({ ok: false, status: 401 }));
      const rs = new DirectRS(config, fetchImpl);

      await expect(rs.storeObject('items/x', {})).rejects.toThrow('Store failed: 401');
    });
  });

  describe('storeFile', () => {
    it('PUTs binary body with the supplied MIME type', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);
      const data = new ArrayBuffer(8);

      await rs.storeFile('files/abc.png', data, 'image/png');

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://storage.example.com/storage/alice/inbox/files/abc.png',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer tok',
            'Content-Type': 'image/png',
          }),
          body: data,
        }),
      );
    });

    it('throws on non-2xx', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse({ ok: false, status: 500 }));
      const rs = new DirectRS(config, fetchImpl);

      await expect(rs.storeFile('files/x.png', new ArrayBuffer(0), 'image/png')).rejects.toThrow(
        'Store file failed: 500',
      );
    });
  });

  describe('store', () => {
    it('PUTs only the metadata when no fileData is supplied', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      await rs.store({ id: 'note-1' } as any);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const calledUrl = fetchImpl.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('/inbox/items/note-1');
    });

    it('uploads file before metadata when both are present', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      const item = { id: 'img-1', filePath: 'files/img-1.jpg', mimeType: 'image/jpeg' };
      await rs.store(item, new ArrayBuffer(16));

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const fileUrl = fetchImpl.mock.calls[0]![0] as string;
      const metaUrl = fetchImpl.mock.calls[1]![0] as string;
      expect(fileUrl).toContain('/inbox/files/img-1.jpg');
      expect(metaUrl).toContain('/inbox/items/img-1');
    });

    it('does not call storeFile when item lacks filePath/mimeType, even with fileData', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      await rs.store({ id: 'note-2' } as any, new ArrayBuffer(8));

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const calledUrl = fetchImpl.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('/inbox/items/note-2');
    });

    it('skips file upload when fileData is undefined even if filePath is present', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      await rs.store({ id: 'img-2', filePath: 'files/img-2.jpg', mimeType: 'image/jpeg' });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe('Authorization header format', () => {
    /**
     * Servers parse the `Authorization` header strictly. Some reject
     * anything that isn't exactly `Bearer <token>` with a single space.
     * Pin the format down so a future refactor can't subtly break OAuth.
     */
    it('uses the exact "Bearer <token>" format on storeObject', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      await rs.storeObject('items/x', {});

      const auth = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(auth.Authorization).toBe('Bearer tok');
      expect(auth.Authorization).toMatch(/^Bearer [^ ]+$/);
    });

    it('uses the exact "Bearer <token>" format on storeFile', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      await rs.storeFile('files/x.png', new ArrayBuffer(0), 'image/png');

      const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok');
    });

    it('passes tokens with special URL characters through unmodified', async () => {
      const weirdToken = 'a.b-c_d/e+f=g';
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS({ ...config, token: weirdToken }, fetchImpl);

      await rs.storeObject('items/x', {});

      const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${weirdToken}`);
    });
  });

  describe('URL construction', () => {
    it('includes the inbox/ namespace prefix on every PUT', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      await rs.storeObject('items/abc', {});
      await rs.storeFile('files/x.png', new ArrayBuffer(0), 'image/png');

      expect(fetchImpl.mock.calls[0]![0]).toBe(
        'https://storage.example.com/storage/alice/inbox/items/abc',
      );
      expect(fetchImpl.mock.calls[1]![0]).toBe(
        'https://storage.example.com/storage/alice/inbox/files/x.png',
      );
    });

    it('passes path segments verbatim (does not encode slashes / dots)', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);

      await rs.storeObject('items/with-dashes_and.dots', {});

      expect(fetchImpl.mock.calls[0]![0]).toContain('/inbox/items/with-dashes_and.dots');
    });
  });

  describe('error messages', () => {
    it.each([
      ['401 expired token', 401, 'Store failed: 401'],
      ['403 forbidden', 403, 'Store failed: 403'],
      ['413 payload too large', 413, 'Store failed: 413'],
      ['500 server error', 500, 'Store failed: 500'],
      ['502 bad gateway', 502, 'Store failed: 502'],
    ])('storeObject error includes the numeric status: %s', async (_label, status, msg) => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse({ ok: false, status }));
      const rs = new DirectRS(config, fetchImpl);

      await expect(rs.storeObject('items/x', {})).rejects.toThrow(msg);
    });

    it.each([
      [413, 'Store file failed: 413'],
      [500, 'Store file failed: 500'],
    ])('storeFile error includes the numeric status: %i', async (status, msg) => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse({ ok: false, status }));
      const rs = new DirectRS(config, fetchImpl);

      await expect(rs.storeFile('files/x', new ArrayBuffer(0), 'image/png')).rejects.toThrow(msg);
    });

    it('store() short-circuits on file PUT failure (does not attempt metadata)', async () => {
      const fetchImpl = vi
        .fn()
        // First call: storeFile, fails.
        .mockResolvedValueOnce(emptyResponse({ ok: false, status: 413 }))
        // Subsequent calls would be the metadata PUT — must NOT happen.
        .mockResolvedValueOnce(emptyResponse());

      const rs = new DirectRS(config, fetchImpl);
      await expect(
        rs.store(
          { id: 'x', filePath: 'files/x.jpg', mimeType: 'image/jpeg' },
          new ArrayBuffer(8),
        ),
      ).rejects.toThrow('Store file failed: 413');

      // Critical: the metadata PUT must not have run, otherwise we'd
      // leave orphan items pointing at a missing file.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe('binary payload', () => {
    /**
     * REGRESSION: previous remoteStorage layers tried to convert
     * ArrayBuffers to "binary strings" before upload, which corrupted
     * non-ASCII bytes. DirectRS must pass the buffer through untouched.
     */
    it('passes the ArrayBuffer through to fetch unchanged', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
      const rs = new DirectRS(config, fetchImpl);
      const data = new Uint8Array([0xff, 0x00, 0xfe, 0x01, 0xde, 0xad, 0xbe, 0xef]).buffer;

      await rs.storeFile('files/x.bin', data, 'application/octet-stream');

      const init = fetchImpl.mock.calls[0]![1] as RequestInit;
      expect(init.body).toBe(data);
      expect(init.body).toBeInstanceOf(ArrayBuffer);
    });

    it('store() uploads file before metadata so readers never see a metadata-without-file state', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (url: string) => {
        calls.push(url);
        return emptyResponse();
      });
      const rs = new DirectRS(config, fetchImpl);

      await rs.store(
        { id: 'img-1', filePath: 'files/img-1.jpg', mimeType: 'image/jpeg' },
        new ArrayBuffer(4),
      );

      expect(calls[0]).toContain('/inbox/files/img-1.jpg');
      expect(calls[1]).toContain('/inbox/items/img-1');
    });
  });

  describe('fetch this-binding (browser "Illegal invocation" regression)', () => {
    /**
     * REGRESSION: in browsers, the global `fetch` validates that `this` is
     * the Window object and throws
     *   "TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation"
     * when called with any other `this`. Calling `this.fetchImpl(...)` on a
     * class instance resolves `this` to that instance, tripping the check.
     * The DirectRS constructor binds `fetchImpl` to `globalThis` to prevent
     * this. These tests simulate the browser's strict check so unit tests
     * (which normally use `vi.fn()` mocks that ignore `this`) catch a
     * regression of the bind.
     */
    function makeStrictBrowserFetch() {
      // Mimic the WebIDL [[ThisValue]] check: anything that isn't the global
      // (or the conventional null/undefined for free-function calls) throws.
      return vi.fn(function (this: unknown) {
        const isGlobalLike = this === globalThis || this === undefined || this === null;
        if (!isGlobalLike) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }
        return Promise.resolve(emptyResponse());
      });
    }

    it('storeObject does not throw "Illegal invocation"', async () => {
      const strictFetch = makeStrictBrowserFetch();
      const rs = new DirectRS(config, strictFetch as unknown as typeof fetch);

      await expect(rs.storeObject('items/x', { id: 'x' })).resolves.toBeUndefined();
      expect(strictFetch).toHaveBeenCalledTimes(1);
    });

    it('storeFile does not throw "Illegal invocation"', async () => {
      const strictFetch = makeStrictBrowserFetch();
      const rs = new DirectRS(config, strictFetch as unknown as typeof fetch);

      await expect(
        rs.storeFile('files/x.png', new ArrayBuffer(8), 'image/png'),
      ).resolves.toBeUndefined();
      expect(strictFetch).toHaveBeenCalledTimes(1);
    });

    it('store (full path with file + metadata) does not throw "Illegal invocation"', async () => {
      const strictFetch = makeStrictBrowserFetch();
      const rs = new DirectRS(config, strictFetch as unknown as typeof fetch);

      await expect(
        rs.store(
          { id: 'img-1', filePath: 'files/img-1.jpg', mimeType: 'image/jpeg' },
          new ArrayBuffer(16),
        ),
      ).resolves.toBeUndefined();
      expect(strictFetch).toHaveBeenCalledTimes(2); // file + metadata
    });

    it('preserves call records on already-bound or pre-wrapped impls', async () => {
      // If a caller passes their own bound or wrapped fetch, our extra bind
      // must not break call tracking — the inner impl still sees every call.
      const inner = vi.fn().mockResolvedValue(emptyResponse());
      const preBound = inner.bind({ marker: 'caller-bound' });
      const rs = new DirectRS(config, preBound as unknown as typeof fetch);

      await rs.storeObject('items/x', {});
      expect(inner).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledWith(
        expect.stringContaining('/inbox/items/x'),
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });
});

describe('createConfigStore', () => {
  let storage: BrowserStorageArea;
  let store: Map<string, unknown>;

  beforeEach(() => {
    store = new Map();
    storage = {
      get: vi.fn(async (key: string) => {
        const result: Record<string, unknown> = {};
        if (store.has(key)) result[key] = store.get(key);
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) store.set(k, v);
      }),
      remove: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    };
  });

  it('returns null when no config has been saved', async () => {
    const cfg = createConfigStore(storage);

    expect(await cfg.get()).toBeNull();
    expect(storage.get).toHaveBeenCalledWith(DEFAULT_CONFIG_STORAGE_KEY);
  });

  it('round-trips a saved RSConfig under the default key', async () => {
    const cfg = createConfigStore(storage);
    const config: RSConfig = {
      userAddress: 'alice@example.com',
      token: 't',
      href: 'https://storage.example.com',
      storageApi: 'draft-dejong-remotestorage-12',
    };

    await cfg.save(config);
    expect(store.get(DEFAULT_CONFIG_STORAGE_KEY)).toEqual(config);
    expect(await cfg.get()).toEqual(config);
  });

  it('clears the saved config', async () => {
    const cfg = createConfigStore(storage);
    await cfg.save({ userAddress: 'x@y' });

    await cfg.clear();

    expect(await cfg.get()).toBeNull();
    expect(storage.remove).toHaveBeenCalledWith(DEFAULT_CONFIG_STORAGE_KEY);
  });

  it('honors a custom storage key', async () => {
    const cfg = createConfigStore(storage, 'custom-key');
    await cfg.save({ userAddress: 'x@y' });

    expect(store.has('custom-key')).toBe(true);
    expect(store.has(DEFAULT_CONFIG_STORAGE_KEY)).toBe(false);
  });

  it('returns null when stored value is missing (e.g. after partial clear)', async () => {
    const cfg = createConfigStore(storage);

    await cfg.save({ userAddress: 'x@y' });
    store.set(DEFAULT_CONFIG_STORAGE_KEY, undefined);

    expect(await cfg.get()).toBeNull();
  });
});
