// @vitest-environment jsdom
import type { InboxItem } from '@inbox-rs/rs-module';
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    collections: writable({}),
    groups: writable({}),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    moveItemToCollection: vi.fn().mockResolvedValue(undefined),
    storeItem: vi.fn().mockResolvedValue(undefined),
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

  function render() {
    component = mount(ViewCardModal, {
      target: host,
      props: { item, onclose },
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
});
