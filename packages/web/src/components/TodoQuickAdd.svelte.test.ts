// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storeItem, moveItemToCollection, toggleGroupFilter, showToast } =
  vi.hoisted(() => ({
    storeItem: vi.fn().mockResolvedValue(undefined),
    moveItemToCollection: vi.fn().mockResolvedValue(undefined),
    toggleGroupFilter: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
  }));

// Mock the data layer. The stores the component subscribes to are real
// writables so `$`-auto-subscription works; the CRUD/toggle calls are spies.
// The extra stores/functions beyond TodoQuickAdd's own imports are consumed
// by the CollectionPicker it renders.
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    storeItem,
    moveItemToCollection,
    toggleGroupFilter,
    collections: writable({}),
    groupCollections: writable({}),
    sortedGroups: writable([]),
    activeGroupIds: writable(new Set<string>()),
    groups: writable({}),
    items: writable({}),
    appConfig: writable({}),
    orphanCollections: writable([]),
    createCollection: vi.fn().mockResolvedValue(undefined),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../lib/toast', () => ({ showToast }));

import type { Writable } from 'svelte/store';
import {
  activeGroupIds,
  collections,
  groupCollections,
  sortedGroups,
} from '../lib/stores';
import TodoQuickAdd from './TodoQuickAdd.svelte';

// The mocked stores are plain writables; the real types are derived (no .set).
const w = <T>(store: unknown) => store as Writable<T>;

describe('TodoQuickAdd', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let onopenmodal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    storeItem.mockResolvedValue(undefined);
    moveItemToCollection.mockResolvedValue(undefined);
    localStorage.clear();
    w<Record<string, unknown>>(collections).set({});
    w<unknown[]>(sortedGroups).set([]);
    w<Record<string, unknown>>(groupCollections).set({});
    w<Set<string>>(activeGroupIds).set(new Set());
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
  const hintText = () =>
    host
      .querySelector('.quick-hint')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim() ?? '';

  // The destination echo only renders while the input is focused with text.
  function focus() {
    input().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    flushSync();
  }

  // Drive the chip trigger + shared CollectionPicker the way a user picking
  // a destination would: open the picker, click the named option.
  function pickCollection(name: string) {
    chipTrigger().click();
    flushSync();
    const options = [
      ...host.querySelectorAll<HTMLButtonElement>('.panel .option'),
    ];
    const target = options.find((o) => o.textContent?.includes(name));
    if (!target) {
      throw new Error(
        `picker option "${name}" not found among: ${options
          .map((o) => o.textContent?.trim())
          .join(', ')}`,
      );
    }
    target.click();
    flushSync();
  }

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

  // Seed a persisted quick-add default pointing at `col-h`, which lives in
  // group `g-hidden`. The caller decides whether that group is visible.
  function seedHiddenGroupDefault({ visible }: { visible: boolean }) {
    localStorage.setItem('inbox-rs:quickAddCollectionId', 'col-h');
    const col = {
      id: 'col-h',
      name: 'Hidden Col',
      itemIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      groupId: 'g-hidden',
    };
    w<Record<string, unknown>>(collections).set({ 'col-h': col });
    w<unknown[]>(sortedGroups).set([
      {
        id: 'g-hidden',
        name: 'Hidden',
        collectionIds: ['col-h'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    w<Record<string, unknown>>(groupCollections).set({ 'g-hidden': [col] });
    w<Set<string>>(activeGroupIds).set(
      visible ? new Set(['g-hidden']) : new Set(),
    );
  }

  const chipTrigger = () =>
    host.querySelector('.quick-add__collection') as HTMLButtonElement;
  const chipText = () =>
    host.querySelector('.chip-name')?.textContent?.trim() ?? '';

  it('ignores a persisted default whose group is filtered out of view', async () => {
    seedHiddenGroupDefault({ visible: false });
    render();
    // The default resolves to Unfiled so the just-added todo stays visible.
    expect(chipText()).toBe('Unfiled');
    type('buy milk');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(storeItem).toHaveBeenCalledOnce();
    });
    expect(moveItemToCollection).not.toHaveBeenCalled();
  });

  it('honors a persisted default whose group is currently visible', async () => {
    seedHiddenGroupDefault({ visible: true });
    render();
    expect(chipText()).toBe('Hidden Col');
    type('buy milk');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(moveItemToCollection).toHaveBeenCalledOnce();
    });
    const todoId = (storeItem.mock.calls[0][0] as { id: string }).id;
    expect(moveItemToCollection).toHaveBeenCalledWith(todoId, 'col-h');
  });

  // Seed one visible group `g-work` with collection `col-road`.
  function seedVisibleGroup() {
    const col = {
      id: 'col-road',
      name: 'Roadmap',
      itemIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      groupId: 'g-work',
    };
    w<Record<string, unknown>>(collections).set({ 'col-road': col });
    w<unknown[]>(sortedGroups).set([
      {
        id: 'g-work',
        name: 'Work',
        collectionIds: ['col-road'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    w<Record<string, unknown>>(groupCollections).set({ 'g-work': [col] });
    w<Set<string>>(activeGroupIds).set(new Set(['g-work']));
  }

  // --- Win 1: destination echo in the hint line ---

  it('echoes "Unfiled" as the destination when nothing is selected', () => {
    render();
    focus();
    type('buy milk');
    expect(hintText()).toContain('Add to Unfiled');
  });

  it('echoes the group › collection destination of a visible default', () => {
    seedVisibleGroup();
    localStorage.setItem('inbox-rs:quickAddCollectionId', 'col-road');
    render();
    focus();
    type('buy milk');
    expect(hintText()).toContain('Add to Work › Roadmap');
  });

  it('flags the destination as hidden in the echo when its group is filtered out', () => {
    seedHiddenGroupDefault({ visible: false });
    render();
    // The default is guarded to Unfiled, so explicitly pick the hidden one.
    pickCollection('Hidden Col');
    focus();
    type('buy milk');
    expect(hintText()).toContain('Add to Hidden › Hidden Col (hidden)');
  });

  // --- Win 2: filing into a hidden group is allowed, with a Show toast ---

  it('honors an explicit pick into a hidden group instead of bouncing to Unfiled', () => {
    seedHiddenGroupDefault({ visible: false });
    render();
    expect(chipText()).toBe('Unfiled');
    pickCollection('Hidden Col');
    // The explicit choice sticks — it does NOT revert to Unfiled.
    expect(chipText()).toBe('Hidden Col');
  });

  it('files into the hidden group and shows a Show toast that reveals it', async () => {
    seedHiddenGroupDefault({ visible: false });
    render();
    pickCollection('Hidden Col');
    type('buy milk');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(moveItemToCollection).toHaveBeenCalledOnce();
    });
    const todoId = (storeItem.mock.calls[0][0] as { id: string }).id;
    expect(moveItemToCollection).toHaveBeenCalledWith(todoId, 'col-h');
    // A toast names the hidden destination and offers a Show action.
    expect(showToast).toHaveBeenCalledOnce();
    const [message, action] = showToast.mock.calls[0] as [
      string,
      { label: string; run: () => void },
    ];
    expect(message).toContain('Hidden Col');
    expect(action.label).toBe('Show');
    action.run();
    expect(toggleGroupFilter).toHaveBeenCalledWith('g-hidden');
  });

  it('surfaces an error toast when the Show action fails to reveal the group', async () => {
    toggleGroupFilter.mockRejectedValueOnce(new Error('config write failed'));
    seedHiddenGroupDefault({ visible: false });
    render();
    pickCollection('Hidden Col');
    type('buy milk');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(showToast).toHaveBeenCalledOnce();
    });
    const [, action] = showToast.mock.calls[0] as [
      string,
      { label: string; run: () => void },
    ];
    action.run();
    expect(toggleGroupFilter).toHaveBeenCalledWith('g-hidden');
    // The rejected reveal is caught and reported instead of going unhandled.
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenLastCalledWith(
        'Could not show the group. Please try again.',
      );
    });
  });

  it('does not toast when filing into a currently visible group', async () => {
    seedHiddenGroupDefault({ visible: true });
    render();
    type('buy milk');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(moveItemToCollection).toHaveBeenCalledOnce();
    });
    expect(showToast).not.toHaveBeenCalled();
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
