import { beforeEach, describe, expect, it, vi } from 'vitest';

const { discoverStorageMock } = vi.hoisted(() => ({
  discoverStorageMock: vi.fn(),
}));

// Keep extractTokenFromRedirect/DirectRS real (they only parse URLs); only the
// network-bound discovery step is replaced so we can drive authUrl per test.
vi.mock('@inbox-rs/rs-module/runtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@inbox-rs/rs-module/runtime')>();
  return { ...actual, discoverStorage: discoverStorageMock };
});

import { finishConnectFromRedirect, startConnect } from './store';

const PENDING_AUTH_KEY = 'inbox-rs-capture:pending-auth';
const CONFIG_KEY = 'inbox-rs-capture:config';

function createStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

let storage: ReturnType<typeof createStorage>;
let location: { origin: string; href: string; hash: string; search: string };
let replaceState: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = createStorage();
  location = {
    origin: 'https://app.example',
    href: '',
    hash: '',
    search: '',
  };
  replaceState = vi.fn();
  discoverStorageMock.mockReset();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { location, history: { replaceState } });
});

describe('startConnect', () => {
  it('navigates to a discovered https OAuth endpoint with OAuth params', async () => {
    discoverStorageMock.mockResolvedValue({
      href: 'https://storage.example/u',
      storageApi: 'draft-06',
      authUrl: 'https://storage.example/oauth',
    });

    await startConnect(' user@storage.example ');

    const target = new URL(location.href);
    expect(target.origin + target.pathname).toBe(
      'https://storage.example/oauth',
    );
    expect(target.searchParams.get('redirect_uri')).toBe(
      'https://app.example/capture/',
    );
    expect(target.searchParams.get('response_type')).toBe('token');
    expect(storage.getItem(PENDING_AUTH_KEY)).not.toBeNull();
  });

  it('rejects a javascript: OAuth endpoint without navigating', async () => {
    discoverStorageMock.mockResolvedValue({
      href: 'https://storage.example/u',
      authUrl: "javascript:fetch('https://attacker.example')//",
    });

    await expect(startConnect('user@evil.example')).rejects.toThrow(
      /insecure OAuth endpoint/,
    );
    expect(location.href).toBe('');
    expect(storage.getItem(PENDING_AUTH_KEY)).toBeNull();
  });

  it('allows http only for localhost dev', async () => {
    discoverStorageMock.mockResolvedValue({
      href: 'http://localhost:8000/u',
      authUrl: 'http://localhost:8000/oauth',
    });

    await startConnect('user@localhost');

    expect(new URL(location.href).protocol).toBe('http:');
  });

  it('rejects plain http on a non-localhost host', async () => {
    discoverStorageMock.mockResolvedValue({
      href: 'http://storage.example/u',
      authUrl: 'http://storage.example/oauth',
    });

    await expect(startConnect('user@storage.example')).rejects.toThrow(
      /insecure OAuth endpoint/,
    );
    expect(location.href).toBe('');
  });
});

describe('finishConnectFromRedirect', () => {
  function setPending() {
    storage.setItem(
      PENDING_AUTH_KEY,
      JSON.stringify({
        userAddress: 'user@storage.example',
        discovery: { href: 'https://storage.example/u', storageApi: 'draft' },
      }),
    );
  }

  it('extracts a token delivered in the query string', () => {
    setPending();
    location.search = '?access_token=qtok';
    location.href = 'https://app.example/capture/?access_token=qtok';

    const config = finishConnectFromRedirect();

    expect(config?.token).toBe('qtok');
    expect(storage.getItem(PENDING_AUTH_KEY)).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/capture/');
  });

  it('extracts a token delivered in the hash fragment', () => {
    setPending();
    location.hash = '#access_token=htok';
    location.href = 'https://app.example/capture/#access_token=htok';

    expect(finishConnectFromRedirect()?.token).toBe('htok');
    expect(storage.getItem(CONFIG_KEY)).not.toBeNull();
  });

  it('scrubs pending state and URL on an error redirect', () => {
    setPending();
    location.search = '?error=access_denied';
    location.href = 'https://app.example/capture/?error=access_denied';

    const config = finishConnectFromRedirect();

    expect(config).toBeNull();
    expect(storage.getItem(PENDING_AUTH_KEY)).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/capture/');
  });

  it('returns the stored config untouched when there is no callback', () => {
    storage.setItem(
      CONFIG_KEY,
      JSON.stringify({ userAddress: 'user@storage.example', token: 't' }),
    );

    expect(finishConnectFromRedirect()).toEqual({
      userAddress: 'user@storage.example',
      token: 't',
    });
    expect(replaceState).not.toHaveBeenCalled();
  });
});
