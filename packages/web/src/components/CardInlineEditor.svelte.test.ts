// @vitest-environment jsdom
import type { ImageItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storeItem } = vi.hoisted(() => ({
  storeItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/stores', () => ({ storeItem }));

import { cardDraftKey, createCardDraft } from '../lib/card-draft';
import CardInlineEditor from './CardInlineEditor.svelte';

const item: ImageItem = {
  id: 'image-1',
  type: 'image',
  title: 'Original title',
  description: 'Original description',
  filePath: 'files/image-1.jpg',
  mimeType: 'image/jpeg',
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
});
