// @vitest-environment jsdom
import type { BookmarkItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { enrichAllBookmarks, showToast } = vi.hoisted(() => ({
  enrichAllBookmarks: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../lib/enrich', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/enrich')>()),
  enrichAllBookmarks,
}));
vi.mock('../../lib/toast', () => ({ showToast }));
vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    connected: writable(true),
    items: writable<Record<string, BookmarkItem>>({}),
    userSettings: writable({}),
    updateUserSettings: vi.fn().mockResolvedValue(undefined),
  };
});

import type { Writable } from 'svelte/store';
import { items } from '../../lib/stores';
import LinkSettings from './LinkSettings.svelte';

function bookmark(
  id: string,
  overrides: Partial<BookmarkItem> = {},
): BookmarkItem {
  return {
    id,
    type: 'bookmark',
    title: 'https://example.com',
    url: 'https://example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('LinkSettings bulk fetch toast', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (items as Writable<Record<string, BookmarkItem>>).set({
      b1: bookmark('b1'),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render() {
    component = mount(LinkSettings, { target: host });
    flushSync();
  }

  const fetchButton = () =>
    host.querySelector('button.btn') as HTMLButtonElement;

  it('counts link-only notes among the previews still to fetch', () => {
    (items as Writable<Record<string, unknown>>).set({
      b1: bookmark('b1'),
      n1: {
        id: 'n1',
        type: 'note',
        title: 'https://x.com/jack',
        body: 'https://x.com/jack',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    render();
    expect(host.textContent).toContain('2 of 2 saved links have no preview');
    expect(fetchButton().textContent).toBe('Fetch 2 previews');
  });

  it('shows the unchanged success toast when no fetches failed', async () => {
    enrichAllBookmarks.mockResolvedValue({ updated: 3, failed: 0, total: 3 });
    render();
    fetchButton().click();
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Updated 3 of 3 bookmarks');
    });
  });

  it('appends the failure count when some fetches failed', async () => {
    enrichAllBookmarks.mockResolvedValue({ updated: 2, failed: 1, total: 3 });
    render();
    fetchButton().click();
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        'Updated 2 of 3 bookmarks — 1 failed',
      );
    });
  });
});
