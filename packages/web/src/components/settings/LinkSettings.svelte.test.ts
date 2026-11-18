// @vitest-environment jsdom
import type { BookmarkItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canDownloadImages,
  enrichAllBookmarks,
  removeStoredImageCopies,
  saveAllBookmarkImages,
  showToast,
} = vi.hoisted(() => ({
  canDownloadImages: vi.fn(),
  enrichAllBookmarks: vi.fn(),
  removeStoredImageCopies: vi.fn(),
  saveAllBookmarkImages: vi.fn(),
  showToast: vi.fn(),
}));
const writeText = vi.fn();

vi.mock('../../lib/enrich', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/enrich')>()),
  enrichAllBookmarks,
  removeStoredImageCopies,
  saveAllBookmarkImages,
}));
vi.mock('../../lib/toast', () => ({ showToast }));
vi.mock('../../lib/link-metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/link-metadata')>()),
  canDownloadImages,
}));
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
import { items, updateUserSettings } from '../../lib/stores';
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
    canDownloadImages.mockResolvedValue(true);
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
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
    host.querySelector('button.btn:not(.secondary)') as HTMLButtonElement;

  const keepSwitch = () =>
    host.querySelector(
      'button[aria-label="Keep a copy of preview images"]',
    ) as HTMLButtonElement;

  it('keeps image copies by default and lets you turn them off', async () => {
    render();
    await vi.waitFor(() => expect(canDownloadImages).toHaveBeenCalled());
    flushSync();
    expect(keepSwitch().getAttribute('aria-pressed')).toBe('true');

    keepSwitch().click();
    flushSync();

    expect(keepSwitch().getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('inbox-rs:keep-link-images')).toBe('false');
    expect(updateUserSettings).toHaveBeenCalledWith({ keepLinkImages: false });

    keepSwitch().click();
    flushSync();
    expect(keepSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(updateUserSettings).toHaveBeenLastCalledWith({
      keepLinkImages: undefined,
    });
  });

  it('shows image copies as unavailable when the service cannot download images', async () => {
    canDownloadImages.mockResolvedValue(false);
    render();
    await vi.waitFor(() => {
      flushSync();
      expect(keepSwitch().disabled).toBe(true);
    });
    expect(keepSwitch().getAttribute('aria-pressed')).toBe('false');
    expect(host.textContent).toContain('Not available');
  });

  const button = (label: string) =>
    [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;

  /** Three saved links: one with a copy, two still shown from their site. */
  function withImages() {
    (items as Writable<Record<string, BookmarkItem>>).set({
      b1: bookmark('b1', {
        ogImage: 'https://cdn/1',
        filePath: 'files/b1.jpg',
        mimeType: 'image/jpeg',
      }),
      b2: bookmark('b2', { ogImage: 'https://cdn/2' }),
      b3: bookmark('b3', { ogImage: 'https://cdn/3' }),
    });
  }

  it('offers to save images locally while copies are kept, and reports each outcome', async () => {
    withImages();
    saveAllBookmarkImages.mockResolvedValue({
      saved: 1,
      gone: 1,
      refused: 0,
      tooLarge: 0,
      other: 0,
      total: 2,
    });
    render();
    await vi.waitFor(() => {
      flushSync();
      expect(button('Save 2 images')).toBeDefined();
    });
    expect(host.textContent).not.toContain('Remove stored copies');

    button('Save 2 images')?.click();
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Saved 1 of 2 images — 1 gone from their site',
      ),
    );
  });

  it('does not offer to save images when the service cannot download them', async () => {
    canDownloadImages.mockResolvedValue(false);
    withImages();
    render();
    await vi.waitFor(() => {
      flushSync();
      expect(keepSwitch().disabled).toBe(true);
    });
    expect(host.textContent).not.toContain('Save images locally');
  });

  it('offers to remove stored copies once copies are turned off, and asks first', async () => {
    withImages();
    removeStoredImageCopies.mockResolvedValue({ removed: 1, total: 1 });
    render();
    await vi.waitFor(() => expect(canDownloadImages).toHaveBeenCalled());
    flushSync();
    keepSwitch().click();
    flushSync();
    expect(host.textContent).not.toContain('Save images locally');

    button('Remove 1 copy…')?.click();
    flushSync();
    expect(host.textContent).toContain('Remove 1 stored copy?');
    expect(removeStoredImageCopies).not.toHaveBeenCalled();

    button('Keep')?.click();
    flushSync();
    expect(removeStoredImageCopies).not.toHaveBeenCalled();

    button('Remove 1 copy…')?.click();
    flushSync();
    button('Remove')?.click();
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Removed 1 stored copy'),
    );
  });

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

  it('copies the missing bookmark and link-note URLs one per line', async () => {
    (items as Writable<Record<string, unknown>>).set({
      b1: bookmark('b1', { url: 'https://example.com\n/path' }),
      n1: {
        id: 'n1',
        type: 'note',
        title: 'https://x.com/jack',
        body: 'https://x.com/jack',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    render();
    (host.querySelector('button.secondary') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'https://example.com/path\nhttps://x.com/jack',
      );
      expect(showToast).toHaveBeenCalledWith('Copied 2 URLs');
    });
  });

  it('does not overwrite the clipboard when no usable URLs remain', async () => {
    (items as Writable<Record<string, unknown>>).set({
      b1: bookmark('b1', { title: '', url: '' }),
    });
    render();
    (host.querySelector('button.secondary') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(writeText).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('No URLs to copy');
    });
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

  it('shows a generic failure toast when bulk fetch rejects', async () => {
    enrichAllBookmarks.mockRejectedValue(new Error('offline'));
    render();
    fetchButton().click();
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Failed to fetch link previews');
    });
  });
});
