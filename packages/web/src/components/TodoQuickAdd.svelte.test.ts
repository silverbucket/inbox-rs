// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storeItem, moveItemToCollection } = vi.hoisted(() => ({
  storeItem: vi.fn().mockResolvedValue(undefined),
  moveItemToCollection: vi.fn().mockResolvedValue(undefined),
}));

// Mock the data layer. The three stores the component subscribes to are real
// writables so `$`-auto-subscription works; the two CRUD calls are spies.
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    storeItem,
    moveItemToCollection,
    collections: writable({}),
    groupCollections: writable({}),
    sortedGroups: writable([]),
  };
});

import TodoQuickAdd from './TodoQuickAdd.svelte';

describe('TodoQuickAdd', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let onopenmodal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    storeItem.mockResolvedValue(undefined);
    moveItemToCollection.mockResolvedValue(undefined);
    localStorage.clear();
    onopenmodal = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render(props: Record<string, unknown> = {}) {
    component = mount(TodoQuickAdd, {
      target: host,
      props: { onopenmodal, ...props },
    });
    flushSync();
  }

  const input = () =>
    host.querySelector('input[aria-label="Todo title"]') as HTMLInputElement;
  const submitBtn = () =>
    host.querySelector('button[type="submit"]') as HTMLButtonElement;
  const errorText = () =>
    host.querySelector('.quick-error')?.textContent?.trim() ?? '';

  function type(value: string) {
    const el = input();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  // Plain Enter submits via the native form submit (the component only adds a
  // keydown handler for the ⌘/Ctrl-Enter shortcut), so drive the form directly.
  function submit() {
    host
      .querySelector('form.quick-add')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
  }

  function cmdEnter() {
    input().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }),
    );
    flushSync();
  }

  it('stores the todo and clears the input on submit', async () => {
    render();
    type('buy milk');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(storeItem).toHaveBeenCalledOnce();
    });
    expect((storeItem.mock.calls[0][0] as { title: string }).title).toBe(
      'buy milk',
    );
    // No fixed/selected collection → it stays unfiled.
    expect(moveItemToCollection).not.toHaveBeenCalled();
    flushSync();
    expect(input().value).toBe('');
  });

  it('files into the fixed collection and hides the collection select', async () => {
    render({ fixedCollectionId: 'col-9' });
    // The select is suppressed when a fixed collection is supplied.
    expect(host.querySelector('.quick-add__collection')).toBeNull();
    type('write spec');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(moveItemToCollection).toHaveBeenCalledOnce();
    });
    const todoId = (storeItem.mock.calls[0][0] as { id: string }).id;
    expect(moveItemToCollection).toHaveBeenCalledWith(todoId, 'col-9');
  });

  it('opens the modal on ⌘/Ctrl-Enter without storing', () => {
    render({ fixedCollectionId: 'col-9' });
    type('a richer todo');
    cmdEnter();
    expect(onopenmodal).toHaveBeenCalledWith('a richer todo', 'col-9');
    expect(storeItem).not.toHaveBeenCalled();
    flushSync();
    expect(input().value).toBe('');
  });

  it('clears the input but reports a distinct error when filing fails after the todo is created', async () => {
    moveItemToCollection.mockRejectedValueOnce(new Error('network down'));
    render({ fixedCollectionId: 'col-9' });
    type('partial fail');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(errorText()).toBe(
        'Todo added, but filing it into the collection failed.',
      );
    });
    // The todo was created, so the title must be cleared — re-submitting would
    // otherwise store a duplicate unfiled todo.
    expect(storeItem).toHaveBeenCalledOnce();
    expect(input().value).toBe('');
  });

  it('keeps the input and shows the raw error when the todo itself fails to store', async () => {
    storeItem.mockRejectedValueOnce(new Error('disk full'));
    render();
    type('store fail');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(errorText()).toBe('disk full');
    });
    // Nothing was created, so the title is preserved for an easy retry.
    expect(moveItemToCollection).not.toHaveBeenCalled();
    expect(input().value).toBe('store fail');
  });

  it('disables the Add button until there is a title', () => {
    render();
    expect(submitBtn().disabled).toBe(true);
    type('something');
    expect(submitBtn().disabled).toBe(false);
    type('   ');
    expect(submitBtn().disabled).toBe(true);
  });

  it('focuses the input on mount when focusOnMount is set', async () => {
    render({ focusOnMount: true });
    // autofocusIf defers to requestAnimationFrame, so wait a frame.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement).toBe(input());
  });
});
