// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearConfig,
  enqueueCapture,
  finishConnectFromRedirect,
  flushQueue,
  getConfig,
  getQueue,
} from './store';

const CONFIG_KEY = 'inbox-rs-capture:config';
const PENDING_AUTH_KEY = 'inbox-rs-capture:pending-auth';
const QUEUE_KEY = 'inbox-rs-capture:queue';

const sampleConfig = {
  userAddress: 'alice@localhost:8000',
  token: 'test-token',
  href: 'http://localhost:8000/storage/alice',
  storageApi: 'draft-dejong-remotestorage-10',
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', {
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('capture store', () => {
  it('builds note items with title slice and full body', () => {
    const longText = `${'a'.repeat(60)} extra body text`;
    enqueueCapture('note', longText);
    const [entry] = getQueue();
    expect(entry.item.type).toBe('note');
    expect(entry.item.title).toBe(longText.slice(0, 50));
    expect(entry.item.body).toBe(longText);
  });

  it('builds todo items with isTodo and completed flags', () => {
    enqueueCapture('todo', 'Buy milk');
    const [entry] = getQueue();
    expect(entry.item).toMatchObject({
      type: 'todo',
      title: 'Buy milk',
      isTodo: true,
      completed: false,
    });
  });

  it('normalizes bookmark URLs without a scheme', () => {
    enqueueCapture('bookmark', 'example.com/page');
    const [entry] = getQueue();
    expect(entry.item).toMatchObject({
      type: 'bookmark',
      title: 'example.com/page',
      url: 'https://example.com/page',
    });
  });

  it('preserves https bookmark URLs', () => {
    enqueueCapture('bookmark', 'https://example.com');
    const [entry] = getQueue();
    expect(entry.item.url).toBe('https://example.com');
  });

  it('appends multiple captures to the queue', () => {
    enqueueCapture('note', 'first');
    enqueueCapture('todo', 'second');
    expect(getQueue()).toHaveLength(2);
  });

  it('persists and clears config', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(sampleConfig));
    expect(getConfig()).toEqual(sampleConfig);
    clearConfig();
    expect(getConfig()).toBeNull();
  });

  it('finishes OAuth redirect and stores config', () => {
    localStorage.setItem(
      PENDING_AUTH_KEY,
      JSON.stringify({
        userAddress: sampleConfig.userAddress,
        discovery: {
          href: sampleConfig.href,
          storageApi: sampleConfig.storageApi,
        },
      }),
    );
    const hash = '#access_token=abc123&token_type=bearer';
    Object.defineProperty(window, 'location', {
      value: {
        href: `http://localhost:5173/capture/${hash}`,
        hash,
        origin: 'http://localhost:5173',
      },
      writable: true,
    });
    history.replaceState = vi.fn();

    const config = finishConnectFromRedirect();
    expect(config).toMatchObject({
      userAddress: sampleConfig.userAddress,
      token: 'abc123',
      href: sampleConfig.href,
    });
    expect(localStorage.getItem(PENDING_AUTH_KEY)).toBeNull();
    expect(getConfig()?.token).toBe('abc123');
  });

  it('flushQueue removes synced entries and keeps failures', async () => {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([
        {
          id: 'a',
          queuedAt: '2024-01-01T00:00:00.000Z',
          item: {
            id: 'a',
            type: 'note',
            title: 'ok',
            body: 'ok',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          id: 'b',
          queuedAt: '2024-01-01T00:00:00.000Z',
          item: {
            id: 'b',
            type: 'note',
            title: 'fail',
            body: 'fail',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        },
      ]),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);

    const remaining = await flushQueue(sampleConfig);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe('b');
    expect(remaining[0]?.lastError).toContain('503');
    expect(getQueue()).toHaveLength(1);
  });
});
