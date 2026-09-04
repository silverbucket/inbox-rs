import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  captureNote,
  finishConnectFromRedirect,
  flushQueue,
  getHistory,
  pendingCount,
  removeRecord,
  startConnect,
} from './store';

const PENDING_AUTH_KEY = 'inbox-rs-capture:pending-auth';
const CONFIG_KEY = 'inbox-rs-capture:config';

const SYNCED_CONFIG = JSON.stringify({
  userAddress: 'alex@5apps.com',
  token: 'tok',
  href: 'https://storage.example/u',
});

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
  let uuid = 0;
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { location, history: { replaceState } });
  vi.stubGlobal('crypto', { randomUUID: () => `id-${uuid++}` });
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('capture history + delivery', () => {
  it('queues a note and counts it as pending', () => {
    const record = captureNote('  buy milk  ');
    expect(record.status).toBe('queued');
    expect(record.item).toMatchObject({
      type: 'note',
      title: 'buy milk',
      body: 'buy milk',
    });
    const history = getHistory();
    expect(history).toHaveLength(1);
    expect(pendingCount(history)).toBe(1);
  });

  it('uses only the first line for a generated note title', () => {
    const record = captureNote(
      'a short title\r\nand some more text about stuff',
    );

    expect(record.item.title).toBe('a short title');
    expect((record.item as NoteItem).body).toBe(
      'a short title\r\nand some more text about stuff',
    );
  });

  it('delivers queued notes to remoteStorage and marks them synced (FIFO)', async () => {
    storage.setItem(CONFIG_KEY, SYNCED_CONFIG);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    captureNote('first');
    captureNote('second');

    const history = await flushQueue();

    expect(history.every((r) => r.status === 'synced')).toBe(true);
    expect(pendingCount(history)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // oldest-first: the first PUT carries the earliest note
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.body).toBe('first');
  });

  it('marks a capture failed (and keeps it pending) when delivery errors', async () => {
    storage.setItem(CONFIG_KEY, SYNCED_CONFIG);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    captureNote('oops');
    const history = await flushQueue();

    expect(history[0].status).toBe('failed');
    expect(history[0].lastError).toContain('500');
    expect(pendingCount(history)).toBe(1);
  });

  it('does nothing when there is no connection', async () => {
    captureNote('offline note');
    const history = await flushQueue();
    expect(history[0].status).toBe('queued');
    expect(pendingCount(history)).toBe(1);
  });

  it('removes a record from history', async () => {
    const record = captureNote('temporary');
    const history = await removeRecord(record.id);
    expect(history).toHaveLength(0);
  });
});
