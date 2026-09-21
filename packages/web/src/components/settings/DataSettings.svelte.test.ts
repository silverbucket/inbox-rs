// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchStorageUsage = vi.hoisted(() => vi.fn());

vi.mock('../../lib/storage-usage', () => ({
  fetchStorageUsage,
  formatBytes: (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
}));

vi.mock('../../lib/lazy-load', () => ({
  loadLazy: vi.fn(async () => null),
}));

vi.mock('../../lib/rs', () => ({
  default: {
    remote: { token: 'tok' },
  },
}));

vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    items: writable({
      one: {
        id: 'one',
        type: 'document',
        title: 'Doc',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
    storageHref: writable('https://storage.example/nick'),
    syncing: writable(false),
  };
});

import type { Writable } from 'svelte/store';
import { syncing } from '../../lib/stores';
import DataSettings from './DataSettings.svelte';

const w = <T>(store: unknown) => store as Writable<T>;

describe('DataSettings', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchStorageUsage.mockResolvedValue(3 * 1024 * 1024);
    w<boolean>(syncing).set(false);
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render() {
    component = mount(DataSettings, { target: host });
    flushSync();
  }

  it('labels inbox usage on the storage server', async () => {
    render();
    await vi.waitFor(() => {
      expect(host.textContent).toContain(
        '1 items · 3.0 MB in your inbox, on your storage server',
      );
    });
  });

  it('re-reads usage when a sync settles', async () => {
    w<boolean>(syncing).set(true);
    render();
    expect(fetchStorageUsage).not.toHaveBeenCalled();

    w<boolean>(syncing).set(false);
    flushSync();
    await vi.waitFor(() => {
      expect(fetchStorageUsage).toHaveBeenCalledWith(
        'https://storage.example/nick',
        'tok',
      );
    });

    fetchStorageUsage.mockResolvedValue(5 * 1024 * 1024);
    w<boolean>(syncing).set(true);
    flushSync();
    w<boolean>(syncing).set(false);
    flushSync();
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="storage-usage"]')?.textContent).toBe(
        '5.0 MB',
      );
    });
    expect(fetchStorageUsage).toHaveBeenCalledTimes(2);
  });
});
