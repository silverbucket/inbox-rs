// @vitest-environment jsdom
import type { InboxItem } from '@inbox-rs/rs-module';
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storeItem } = vi.hoisted(() => ({
  storeItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    collections: writable({}),
    groups: writable({}),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    moveItemToCollection: vi.fn().mockResolvedValue(undefined),
    storeItem,
  };
});

import ViewCardModal from './ViewCardModal.svelte';

const item: InboxItem = {
  id: 'note-1',
  type: 'note',
  title: 'Keyboard-accessible actions',
  body: 'Test body',
  createdAt: '2026-08-08T10:00:00.000Z',
};

describe('ViewCardModal actions menu', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let onclose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onclose = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    localStorage.clear();
  });

  function render(renderedItem: InboxItem = item) {
    component = mount(ViewCardModal, {
      target: host,
      props: { item: renderedItem, onclose },
    });
    flushSync();
  }

  it('supports keyboard opening, navigation, and focus restoration', async () => {
    render();
    const trigger = host.querySelector(
      '[aria-label="Card actions"]',
    ) as HTMLButtonElement;
    trigger.focus();

    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    await tick();

    const deleteAction = host.querySelector(
      '[role="menuitem"]',
    ) as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(deleteAction);

    deleteAction.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    expect(document.activeElement).toBe(deleteAction);

    deleteAction.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    flushSync();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('converts and fetches when an existing note contains only a URL', async () => {
    const url =
      'https://x.com/vivistac/status/2086480928591819162?s=46&t=UTd7gPLSy4yZR518MK49Qg';
    render({
      id: 'legacy-url-note',
      type: 'note',
      title: url.slice(0, 50),
      body: `[${url}](${url})`,
      createdAt: '2026-08-10T13:59:00.000Z',
    });

    expect(host.textContent).toContain('This note contains a link.');
    expect(host.textContent).toContain('Fetch link preview');

    const fetchButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Fetch link preview'),
    );
    fetchButton?.click();
    await vi.waitFor(() => {
      expect(storeItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'legacy-url-note',
          type: 'bookmark',
          url,
          title: url,
        }),
      );
    });
  });
});
