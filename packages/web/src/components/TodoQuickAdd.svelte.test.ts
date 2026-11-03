// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storeItem, moveItemToCollection, keepTodoVisible } = vi.hoisted(() => ({
  storeItem: vi.fn().mockResolvedValue(undefined),
  moveItemToCollection: vi.fn().mockResolvedValue(undefined),
  keepTodoVisible: vi.fn(),
}));

// Mock the data layer. The stores the component subscribes to are real
// writables so `$`-auto-subscription works; the CRUD calls are spies. The
// extra stores/functions beyond TodoQuickAdd's own imports are consumed by
// the CollectionPicker it renders and the todo-destination resolver.
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    storeItem,
    moveItemToCollection,
    keepTodoVisible,
    collections: writable({}),
    groupCollections: writable({}),
    sortedGroups: writable([]),
    visibleGroupedCollections: writable([]),
    hiddenCollectionIds: writable(new Set<string>()),
    sessionPinGeneration: writable(0),
    groups: writable({}),
    items: writable({}),
    appConfig: writable({}),
    orphanCollections: writable([]),
    createCollection: vi.fn().mockResolvedValue(undefined),
    storeGroup: vi.fn().mockResolvedValue(undefined),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  };
});

import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
import type { Writable } from 'svelte/store';
import {
  collections,
  groupCollections,
  groups,
  hiddenCollectionIds,
  sessionPinGeneration,
  sortedGroups,
  visibleGroupedCollections,
} from '../lib/stores';
import {
  rememberedTodoDestination,
  rememberTodoDestination,
} from '../lib/todo-destination';
import TodoQuickAdd from './TodoQuickAdd.svelte';

// The mocked stores are plain writables; the real types are derived (no .set).
const w = <T>(store: unknown) => store as Writable<T>;

// Two groups: Work (Roadmap, Hiring) and Home (Garden). `hiddenGroups` and
// `hiddenCollections` stand in for the sidebar filter; the derived stores
// the component reads are mocked writables, so this sets them coherently.
const GROUPS: CollectionGroup[] = [
  {
    id: 'g-work',
    name: 'Work',
    collectionIds: ['col-road', 'col-hiring'],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'g-home',
    name: 'Home',
    collectionIds: ['col-garden'],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];
const COLS: Collection[] = [
  {
    id: 'col-road',
    name: 'Roadmap',
    groupId: 'g-work',
    itemIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'col-hiring',
    name: 'Hiring',
    groupId: 'g-work',
    itemIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'col-garden',
    name: 'Garden',
    groupId: 'g-home',
    itemIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

function seed({
  hiddenGroups,
  hiddenCollections = [],
}: {
  hiddenGroups: string[];
  hiddenCollections?: string[];
}) {
  const byGroup: Record<string, Collection[]> = {};
  for (const g of GROUPS)
    byGroup[g.id] = COLS.filter((c) => c.groupId === g.id);
  w<Record<string, Collection>>(collections).set(
    Object.fromEntries(COLS.map((c) => [c.id, c])),
  );
  w<Record<string, CollectionGroup>>(groups).set(
    Object.fromEntries(GROUPS.map((g) => [g.id, g])),
  );
  w<CollectionGroup[]>(sortedGroups).set(GROUPS);
  w<Record<string, Collection[]>>(groupCollections).set(byGroup);
  const hidden = new Set<string>(hiddenCollections);
  for (const c of COLS)
    if (hiddenGroups.includes(c.groupId ?? '')) hidden.add(c.id);
  w<Set<string>>(hiddenCollectionIds).set(hidden);
  // The real store bumps this whenever the filter changes.
  w<number>(sessionPinGeneration).update((n) => n + 1);
  w<unknown[]>(visibleGroupedCollections).set(
    GROUPS.filter((g) => !hiddenGroups.includes(g.id)).map((group) => ({
      group,
      collections: byGroup[group.id].filter((c) => !hidden.has(c.id)),
    })),
  );
}

describe('TodoQuickAdd', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let onopenmodal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    storeItem.mockResolvedValue(undefined);
    moveItemToCollection.mockResolvedValue(undefined);
    localStorage.clear();
    rememberedTodoDestination.set(undefined);
    seed({ hiddenGroups: [] });
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
        shiftKey: true,
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

  it('defaults to the sole visible collection', async () => {
    seed({ hiddenGroups: ['g-home'], hiddenCollections: ['col-hiring'] });
    render();
    expect(chipText()).toBe('Roadmap');
    type('write spec');
    submit();
    await expectFiledInto('col-road');
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

  it('opens the modal on ⌘/Ctrl-Shift-Enter without storing', () => {
    render({ fixedCollectionId: 'col-9' });
    type('a richer todo');
    cmdEnter();
    expect(onopenmodal).toHaveBeenCalledWith('a richer todo', null);
    expect(storeItem).not.toHaveBeenCalled();
    flushSync();
    expect(input().value).toBe('');
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Command', { metaKey: true }],
  ] satisfies [
    string,
    KeyboardEventInit,
  ][])('saves on %s-Enter and keeps the event from the global new-note shortcut', async (_modifier, keys) => {
    render();
    type('buy milk');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ...keys,
      bubbles: true,
      cancelable: true,
    });
    input().dispatchEvent(event);
    // The global handler bails on defaultPrevented events.
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      flushSync();
      expect(storeItem).toHaveBeenCalledOnce();
    });
    expect(onopenmodal).not.toHaveBeenCalled();
    flushSync();
    expect(input().value).toBe('');
  });

  it('leaves ⌘/Ctrl-Enter on an empty input to the global shortcut', () => {
    render();
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('does not treat Alt+⌘/Ctrl-Shift-Enter as the modal shortcut', () => {
    render({ fixedCollectionId: 'col-9' });
    type('a richer todo');
    input().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
        bubbles: true,
      }),
    );
    flushSync();
    expect(onopenmodal).not.toHaveBeenCalled();
    expect(storeItem).not.toHaveBeenCalled();
    expect(input().value).toBe('a richer todo');
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

  const chipTrigger = () =>
    host.querySelector('.quick-add__collection') as HTMLButtonElement;
  const chipText = () =>
    host.querySelector('.chip-name')?.textContent?.trim() ?? '';

  async function expectFiledInto(collectionId: string) {
    await vi.waitFor(() => {
      flushSync();
      expect(moveItemToCollection).toHaveBeenCalledOnce();
    });
    const todoId = (storeItem.mock.calls[0][0] as { id: string }).id;
    expect(moveItemToCollection).toHaveBeenCalledWith(todoId, collectionId);
    return todoId;
  }

  // --- The default never points outside the current view ---

  it('ignores a persisted default whose group is filtered out of view', async () => {
    rememberTodoDestination('col-garden');
    seed({ hiddenGroups: ['g-home'] });
    render();
    // The view is narrowed to Work, so the default is a Work collection —
    // not Garden (hidden) and not Unfiled (outside the filtered groups).
    expect(chipText()).toBe('Roadmap');
    type('buy milk');
    submit();
    await expectFiledInto('col-road');
    expect(keepTodoVisible).not.toHaveBeenCalled();
  });

  it('honors a persisted default whose group is currently visible', async () => {
    rememberTodoDestination('col-garden');
    render();
    expect(chipText()).toBe('Garden');
    type('plant tulips');
    submit();
    await expectFiledInto('col-garden');
  });

  it('drops an in-session pick the moment its group is hidden', () => {
    render();
    pickCollection('Garden');
    expect(chipText()).toBe('Garden');
    seed({ hiddenGroups: ['g-home'] });
    flushSync();
    expect(chipText()).toBe('Roadmap');
  });

  it('starts Unfiled only when nothing narrows the view', () => {
    render();
    expect(chipText()).toBe('Unfiled');
  });

  // --- Filing outside the view stays possible, but only on purpose ---

  it('lists hidden collections apart, under "Hidden by your filter"', () => {
    seed({ hiddenGroups: ['g-home'] });
    render();
    chipTrigger().click();
    flushSync();
    const label = host.querySelector('.panel .hidden-label');
    expect(label?.textContent?.trim()).toBe('Hidden by your filter');
    const hiddenRow = host.querySelector('.panel .option--hidden');
    expect(hiddenRow?.textContent).toContain('Garden');
    expect(hiddenRow?.textContent).toContain('Home');
    // Garden appears once — in the hidden section, not under its group.
    const gardenRows = [
      ...host.querySelectorAll<HTMLButtonElement>('.panel .option'),
    ].filter((o) => o.textContent?.includes('Garden'));
    expect(gardenRows).toHaveLength(1);
  });

  it('keeps an explicit hidden pick, marks the chip, and keeps the todo listed', async () => {
    seed({ hiddenGroups: ['g-home'] });
    render();
    pickCollection('Garden');
    expect(chipText()).toBe('Garden');
    expect(chipTrigger().classList.contains('is-hidden-pick')).toBe(true);
    expect(chipTrigger().getAttribute('aria-label')).toContain('hidden');
    type('plant tulips');
    submit();
    const todoId = await expectFiledInto('col-garden');
    expect(keepTodoVisible).toHaveBeenCalledWith(todoId);
  });

  it('keeps an explicit Unfiled pick while the view is narrowed', async () => {
    seed({ hiddenGroups: ['g-home'] });
    render();
    expect(chipText()).toBe('Roadmap');
    pickCollection('Unfiled');
    expect(chipText()).toBe('Unfiled');
    type('buy milk');
    submit();
    await vi.waitFor(() => {
      flushSync();
      expect(storeItem).toHaveBeenCalledOnce();
    });
    expect(moveItemToCollection).not.toHaveBeenCalled();
  });

  it('forgets explicit picks when the filter changes', () => {
    seed({ hiddenGroups: ['g-home'] });
    render();
    pickCollection('Unfiled');
    expect(chipText()).toBe('Unfiled');
    seed({ hiddenGroups: ['g-work'] });
    flushSync();
    expect(chipText()).toBe('Garden');
  });

  it('forgets explicit picks on a filter change that hides no new collection', () => {
    seed({ hiddenGroups: ['g-home'] });
    render();
    pickCollection('Unfiled');
    expect(chipText()).toBe('Unfiled');
    // e.g. toggling a group that has no collections yet
    w<number>(sessionPinGeneration).update((n) => n + 1);
    flushSync();
    expect(chipText()).toBe('Roadmap');
  });

  it('files into the destination shown at submit even if the filter changes mid-save', async () => {
    seed({ hiddenGroups: ['g-home'] });
    rememberTodoDestination('col-road');
    render();
    expect(chipText()).toBe('Roadmap');
    let finishStore!: () => void;
    storeItem.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishStore = resolve)),
    );
    type('ship it');
    submitBtn().click();
    await vi.waitFor(() => expect(storeItem).toHaveBeenCalled());
    // Filter flips while the store write is in flight: Roadmap is now hidden.
    seed({ hiddenGroups: ['g-work'] });
    flushSync();
    expect(chipText()).toBe('Garden');
    finishStore();
    await vi.waitFor(() => expect(moveItemToCollection).toHaveBeenCalled());
    expect(moveItemToCollection.mock.calls[0][1]).toBe('col-road');
    // …and it is not pinned: the list is already on the user's new terms.
    expect(keepTodoVisible).not.toHaveBeenCalled();
  });

  it('skips the pin when the Todos page was left and re-entered mid-save', async () => {
    seed({ hiddenGroups: ['g-home'] });
    render();
    pickCollection('Garden');
    let finishStore!: () => void;
    storeItem.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishStore = resolve)),
    );
    type('water beds');
    submitBtn().click();
    await vi.waitFor(() => expect(storeItem).toHaveBeenCalled());
    // Leaving / re-entering the page clears the pins and bumps the generation.
    w<number>(sessionPinGeneration).update((n) => n + 1);
    finishStore();
    await vi.waitFor(() => expect(moveItemToCollection).toHaveBeenCalled());
    expect(moveItemToCollection.mock.calls[0][1]).toBe('col-garden');
    expect(keepTodoVisible).not.toHaveBeenCalled();
  });

  it('pins a hidden pick before the move so the row never blinks out', async () => {
    seed({ hiddenGroups: ['g-home'] });
    render();
    pickCollection('Garden');
    type('water beds');
    submitBtn().click();
    await vi.waitFor(() => expect(moveItemToCollection).toHaveBeenCalled());
    expect(keepTodoVisible.mock.invocationCallOrder[0]).toBeLessThan(
      moveItemToCollection.mock.invocationCallOrder[0],
    );
  });

  // --- Destination echo in the hint line ---

  it('echoes "Unfiled" as the destination when nothing is selected', () => {
    render();
    focus();
    type('buy milk');
    expect(hintText()).toContain('Add to Unfiled');
  });

  it('echoes the group › collection destination of the default', () => {
    rememberTodoDestination('col-road');
    render();
    focus();
    type('buy milk');
    expect(hintText()).toContain('Add to Work › Roadmap');
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
