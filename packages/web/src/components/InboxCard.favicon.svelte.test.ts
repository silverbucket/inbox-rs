// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// InboxCard pulls in the per-type cards (stores/rs at import time) and
// drag state — neutralise everything not under test.
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    connected: writable(false),
    blobUrls: writable<Record<string, string>>({}),
    loadFileBlobUrl: vi.fn(),
    draggingItemId: writable<string | null>(null),
  };
});
vi.mock('../lib/rs', () => ({
  default: {},
  fetchFileBlobUrl: vi.fn(),
  fetchFileWithAuth: vi.fn(),
}));

import type { BookmarkItem } from '@inbox-rs/rs-module';
import InboxCard from './InboxCard.svelte';

function bookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: 'b1',
    type: 'bookmark',
    title: 'Example',
    url: 'https://example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InboxCard bookmark favicon decorator', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function mountCard(item: BookmarkItem) {
    component = mount(InboxCard, {
      target: host,
      props: { item, onselect: () => {} },
    });
    flushSync();
  }

  it('renders the favicon in the kind icon when present', () => {
    mountCard(bookmark({ favicon: 'https://example.com/favicon.ico' }));
    const img = host.querySelector('img.kind-favicon') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe('https://example.com/favicon.ico');
    expect(host.querySelector('.kind-ic svg')).toBeNull();
  });

  it('resolves relative favicons against the bookmark URL', () => {
    mountCard(bookmark({ favicon: '/favicon.ico' }));
    const img = host.querySelector('img.kind-favicon') as HTMLImageElement;
    expect(img.src).toBe('https://example.com/favicon.ico');
  });

  it('falls back to the glyph without a favicon', () => {
    mountCard(bookmark());
    expect(host.querySelector('img.kind-favicon')).toBeNull();
    expect(host.querySelector('.kind-ic svg')).not.toBeNull();
  });

  it('falls back to the glyph when the favicon fails to load', () => {
    mountCard(bookmark({ favicon: 'https://example.com/favicon.ico' }));
    const img = host.querySelector('img.kind-favicon') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));
    flushSync();
    expect(host.querySelector('img.kind-favicon')).toBeNull();
    expect(host.querySelector('.kind-ic svg')).not.toBeNull();
  });

  it('retries when a later update replaces a failed favicon with a new URL', () => {
    // The failure latch is scoped to the URL that failed — a subsequent
    // enrichment pass can correct a broken favicon, and the replacement
    // deserves a fresh attempt.
    const props = $state({
      item: bookmark({ favicon: 'https://example.com/broken.ico' }),
      onselect: () => {},
    });
    component = mount(InboxCard, { target: host, props });
    flushSync();
    const img = host.querySelector('img.kind-favicon') as HTMLImageElement;
    img.dispatchEvent(new Event('error')); // genuine failure while connected
    flushSync();
    expect(host.querySelector('img.kind-favicon')).toBeNull();

    props.item = bookmark({ favicon: 'https://example.com/fixed.ico' });
    flushSync();
    const retry = host.querySelector('img.kind-favicon') as HTMLImageElement;
    expect(retry).not.toBeNull();
    expect(retry?.src).toBe('https://example.com/fixed.ico');
  });

  it('drops non-http(s) favicons', () => {
    mountCard(bookmark({ favicon: 'javascript:alert(1)' }));
    expect(host.querySelector('img.kind-favicon')).toBeNull();
  });

  it('ignores the abort error fired when the img is detached mid-load', () => {
    // A remoteStorage change-event echo can briefly revert the item to a
    // pre-enrichment revision: the img is yanked from the DOM, the aborted
    // load fires `error` on the detached node, and the favicon returns a
    // beat later. That abort must not latch the failure state.
    const props = $state({
      item: bookmark({ favicon: 'https://example.com/favicon.ico' }),
      onselect: () => {},
    });
    component = mount(InboxCard, { target: host, props });
    flushSync();
    const img = host.querySelector('img.kind-favicon') as HTMLImageElement;

    props.item = bookmark(); // echo of the pre-enrichment revision
    flushSync();
    img.dispatchEvent(new Event('error')); // abort on the detached node
    flushSync();

    props.item = bookmark({ favicon: 'https://example.com/favicon.ico' });
    flushSync();
    expect(host.querySelector('img.kind-favicon')).not.toBeNull();
  });

  it('shows the favicon when enrichment adds it after mount', () => {
    // Mirrors the real flow: the card renders right after capture (no
    // favicon yet), then background enrichment stores the updated item and
    // the prop changes.
    const props = $state({
      item: bookmark(),
      onselect: () => {},
    });
    component = mount(InboxCard, { target: host, props });
    flushSync();
    expect(host.querySelector('img.kind-favicon')).toBeNull();

    props.item = bookmark({ favicon: 'https://example.com/favicon.ico' });
    flushSync();
    const img = host.querySelector('img.kind-favicon') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img?.src).toBe('https://example.com/favicon.ico');
  });

  it('does not reserve flow space for the pin button above the kind row', () => {
    mountCard(bookmark({ favicon: 'https://example.com/favicon.ico' }));
    const kind = host.querySelector('.card-kind');
    expect(kind).not.toBeNull();
    // When the pin button incorrectly stays in document flow it sits above the
    // kind row and pushes the favicon down, leaving a blank band at the top.
    expect(kind!.offsetTop).toBeLessThan(28);
  });

  it('uses a native selection button without making the card interactive', () => {
    const onselect = vi.fn();
    const item = bookmark();
    component = mount(InboxCard, {
      target: host,
      props: { item, onselect },
    });
    flushSync();

    const card = host.querySelector('article.card');
    const select = host.querySelector<HTMLButtonElement>('button.card-select');
    expect(card?.hasAttribute('role')).toBe(false);
    expect(card?.hasAttribute('tabindex')).toBe(false);
    expect(select?.ariaLabel).toBe('Open Example');

    select?.click();
    expect(onselect).toHaveBeenCalledOnce();
    expect(onselect).toHaveBeenCalledWith(item);
  });
});
