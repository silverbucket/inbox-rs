// @vitest-environment jsdom
import type { BookmarkItem, ImageItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storeItem } = vi.hoisted(() => ({
  storeItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/stores', () => ({ storeItem }));

import { cardDraftKey, createCardDraft } from '../lib/card-draft';
import Harness from './CardInlineEditor.harness.svelte';
import CardInlineEditor from './CardInlineEditor.svelte';

const item: ImageItem = {
  id: 'image-1',
  type: 'image',
  title: 'Original title',
  description: 'Original description',
  filePath: 'files/image-1.jpg',
  mimeType: 'image/jpeg',
  sourceUrl: 'https://example.com/original.jpg',
  createdAt: '2026-08-01T10:00:00.000Z',
  pinned: true,
};

describe('CardInlineEditor autosave', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render() {
    component = mount(CardInlineEditor, { target: host, props: { item } });
    flushSync();
  }

  it('writes a recovery draft immediately and syncs after the debounce', async () => {
    render();
    const title = host.querySelector(
      '[aria-label="Title"]',
    ) as HTMLInputElement;
    title.value = 'Autosaved title';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    flushSync();

    expect(
      JSON.parse(localStorage.getItem(cardDraftKey(item.id)) ?? '{}').title,
    ).toBe('Autosaved title');
    expect(storeItem).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(storeItem).toHaveBeenCalledWith({
      ...item,
      title: 'Autosaved title',
    });
    expect(localStorage.getItem(cardDraftKey(item.id))).toBeNull();
  });

  it('restores a device-local draft before remote sync completes', () => {
    const draft = createCardDraft(item);
    draft.title = 'Recovered after refresh';
    localStorage.setItem(cardDraftKey(item.id), JSON.stringify(draft));

    render();

    expect(
      (host.querySelector('[aria-label="Title"]') as HTMLInputElement).value,
    ).toBe('Recovered after refresh');
  });

  it('keeps compact bookmark fields from stretching the preview layout', () => {
    const bookmark: BookmarkItem = {
      id: 'bookmark-layout',
      type: 'bookmark',
      title: 'Example',
      url: 'https://example.com',
      createdAt: '2026-08-01T10:00:00.000Z',
    };
    component = mount(CardInlineEditor, {
      target: host,
      props: { item: bookmark },
    });
    flushSync();

    expect(host.querySelector('section.editor')?.classList).toContain(
      'compact',
    );
  });

  it('collapses an empty image description behind More details', () => {
    const imageWithoutDescription: ImageItem = {
      ...item,
      description: undefined,
    };
    component = mount(CardInlineEditor, {
      target: host,
      props: { item: imageWithoutDescription },
    });
    flushSync();

    const moreDetails = host.querySelector('details.more-fields');
    expect(moreDetails).toBeInstanceOf(HTMLDetailsElement);
    expect((moreDetails as HTMLDetailsElement).open).toBe(false);
    expect(host.querySelector('.description-primary')).toBeNull();
    expect(host.querySelector('section.editor')?.classList).toContain(
      'compact',
    );
  });

  it('uses the shared URL and open-link widgets for an image source', () => {
    render();

    const urlInput = host.querySelector(
      'input[type="url"]',
    ) as HTMLInputElement;
    expect(urlInput.value).toBe(item.sourceUrl);
    const openLink = host.querySelector('.source-link');
    expect(openLink?.textContent).toContain('Open link');
    expect(openLink?.getAttribute('href')).toBe(item.sourceUrl);
  });

  it('does not render an open link for an active URI scheme', () => {
    component = mount(CardInlineEditor, {
      target: host,
      props: { item: { ...item, sourceUrl: 'javascript:alert(1)' } },
    });
    flushSync();

    expect(host.querySelector('input[type="url"]')).not.toBeNull();
    expect(host.querySelector('.source-link')).toBeNull();
  });

  it('keeps a merged external update pending when an older save is in flight', async () => {
    let releaseSave: (() => void) | undefined;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    storeItem.mockImplementationOnce(() => saveGate);

    const bookmark: BookmarkItem = {
      id: 'bookmark-1',
      type: 'bookmark',
      title: 'https://example.org',
      url: 'https://example.org',
      createdAt: '2026-08-01T10:00:00.000Z',
    };
    const harness = mount(Harness, {
      target: host,
      props: { initial: bookmark },
    });
    flushSync();

    const title = host.querySelector(
      '[aria-label="Title"]',
    ) as HTMLInputElement;
    title.value = 'My custom title';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    flushSync();

    const flushPromise = harness.flushEdits();
    const enriched: BookmarkItem = {
      ...bookmark,
      title: 'Example Org',
      description: 'Recovered metadata',
    };
    harness.updateItem(enriched);
    flushSync();

    releaseSave?.();
    await flushPromise;
    await new Promise((resolve) => setTimeout(resolve, 750));

    unmount(harness);

    expect(storeItem).toHaveBeenCalledTimes(2);
    expect(storeItem.mock.calls[1]?.[0]).toMatchObject({
      title: 'My custom title',
      description: 'Recovered metadata',
    });
    expect(localStorage.getItem(cardDraftKey(bookmark.id))).toBeNull();
  });

  it('saves a pending edit when torn down before the debounce fires', async () => {
    // A route change (mobile back button, nav tap) closes the card modal
    // without the modal's own flush. The edit must still leave the device.
    render();
    const title = host.querySelector(
      '[aria-label="Title"]',
    ) as HTMLInputElement;
    title.value = 'Typed then navigated away';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    flushSync();
    expect(storeItem).not.toHaveBeenCalled();

    unmount(component as ReturnType<typeof mount>);
    component = undefined;

    expect(storeItem).toHaveBeenCalledTimes(1);
    expect(storeItem).toHaveBeenCalledWith({
      ...item,
      title: 'Typed then navigated away',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(localStorage.getItem(cardDraftKey(item.id))).toBeNull();
  });

  it('does not write a discarded edit back on teardown', () => {
    // After the card is deleted, an edit that never flushed must stay dead.
    let discard: () => void = () => {};
    component = mount(CardInlineEditor, {
      target: host,
      props: {
        item,
        get discard() {
          return discard;
        },
        set discard(next: () => void) {
          discard = next;
        },
      },
    });
    flushSync();
    const title = host.querySelector(
      '[aria-label="Title"]',
    ) as HTMLInputElement;
    title.value = 'Edited then deleted';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    flushSync();

    discard();
    unmount(component);
    component = undefined;

    expect(storeItem).not.toHaveBeenCalled();
  });

  it('pushes a pending edit as soon as the page is hidden', () => {
    render();
    const title = host.querySelector(
      '[aria-label="Title"]',
    ) as HTMLInputElement;
    title.value = 'Typed then tab hidden';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    flushSync();
    expect(storeItem).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    }

    expect(storeItem).toHaveBeenCalledTimes(1);
    expect(storeItem).toHaveBeenCalledWith({
      ...item,
      title: 'Typed then tab hidden',
    });
  });
});
