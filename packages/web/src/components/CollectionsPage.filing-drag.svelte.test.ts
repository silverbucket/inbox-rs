// @vitest-environment jsdom

import type {
  Collection,
  CollectionGroup,
  InboxItem,
} from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLLECTION_DRAG_MIME,
  DRAG_MIME,
  draggingCollectionId,
  draggingItemId,
} from '../lib/drag';
import {
  dispatchDndFinalize,
  dragStartFrom,
  dropOntoCollectionButton,
  filingDragSurvivesNeuteredAncestor,
  mousedownReachesZoneUncancelled,
  stubMatchMedia,
} from '../test/filing-drag-helpers';

const fixtures = vi.hoisted(() => {
  const group: CollectionGroup = {
    id: 'g1',
    name: 'Work',
    color: '#6366f1',
    collectionIds: ['c1'],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const collection: Collection = {
    id: 'c1',
    name: 'Reading',
    color: '#22c55e',
    groupId: 'g1',
    itemIds: ['todo-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const todo: InboxItem = {
    id: 'todo-1',
    type: 'todo',
    title: 'Read the docs',
    createdAt: '2026-01-01T00:00:00.000Z',
    collectionId: 'c1',
  } as InboxItem;
  return { group, collection, todo };
});

const storeFns = vi.hoisted(() => ({
  moveItemToCollection: vi.fn().mockResolvedValue(undefined),
  reorderGroupCollections: vi.fn().mockResolvedValue(undefined),
  updateConfig: vi.fn().mockResolvedValue(undefined),
  setExpandedCollections: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/stores', async () => {
  const { writable: w } = await import('svelte/store');
  const { group, collection, todo } = fixtures;
  return {
    sortedGroups: w([group]),
    groups: w({ [group.id]: group }),
    collections: w({ [collection.id]: collection }),
    groupCollections: w({ [group.id]: [collection] }),
    visibleGroupedCollections: w([{ group, collections: [collection] }]),
    orphanCollections: w([]),
    archivedCollections: w([]),
    archivedGroups: w([]),
    collectionItems: w({ [collection.id]: [todo] }),
    appConfig: w({ expandedCollections: [collection.id] }),
    createCollection: vi.fn(),
    storeCollection: vi.fn(),
    deleteCollection: vi.fn(),
    moveCollectionToGroup: vi.fn(),
    storeGroup: vi.fn(),
    deleteGroup: vi.fn(),
    setCollectionArchived: vi.fn(),
    setGroupArchived: vi.fn(),
    ...storeFns,
  };
});

import CollectionsPage from './CollectionsPage.svelte';

describe('CollectionsPage filing drag', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stubMatchMedia();
    if (typeof DragEvent === 'undefined') {
      class PolyDragEvent extends Event {
        dataTransfer: DataTransfer | null;
        constructor(
          type: string,
          options?: EventInit & { dataTransfer?: DataTransfer | null },
        ) {
          super(type, options);
          this.dataTransfer = options?.dataTransfer ?? null;
        }
      }
      globalThis.DragEvent = PolyDragEvent as typeof DragEvent;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    draggingItemId.set(null);
    draggingCollectionId.set(null);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    draggingItemId.set(null);
    draggingCollectionId.set(null);
  });

  function render() {
    component = mount(CollectionsPage, {
      target: host,
      props: { onselect: vi.fn() },
    });
    flushSync();
  }

  it('does not let the collection reorder zone cancel todo mousedown', () => {
    render();
    const zone = host.querySelector('.collection-list') as HTMLElement;
    const title = host.querySelector('.todo-row .title') as HTMLElement;
    expect(zone).toBeTruthy();
    expect(title).toBeTruthy();
    expect(mousedownReachesZoneUncancelled(zone, title)).toBe(true);
  });

  it('starts a sidebar filing drag from an expanded collection todo row', () => {
    render();
    const row = host.querySelector('.todo-row') as HTMLElement;
    const title = host.querySelector('.todo-row .title') as HTMLElement;
    const dataTransfer = dragStartFrom(row, {
      pointerTarget: title,
      target: row,
    });
    expect(dataTransfer.getData(DRAG_MIME)).toBe('todo-1');
    expect(get(draggingItemId)).toBe('todo-1');
  });

  it('starts that drag even though its zone child cancels dragstart', () => {
    render();
    const zoneChild = host.querySelector('.collection-list > *') as HTMLElement;
    const row = host.querySelector('.todo-row') as HTMLElement;
    const title = host.querySelector('.todo-row .title') as HTMLElement;
    expect(zoneChild).toBeTruthy();
    const { survived, dataTransfer } = filingDragSurvivesNeuteredAncestor(
      zoneChild,
      row,
      { pointerTarget: title, target: row },
    );
    expect(survived).toBe(true);
    expect(dataTransfer.getData(DRAG_MIME)).toBe('todo-1');
  });

  it('uses dragHandleZone for collection reorder (grip handle present)', () => {
    render();
    const handle = host.querySelector('.reorder-grip') as HTMLElement;
    expect(handle).toBeTruthy();
    expect(handle.tagName).toBe('SPAN');
  });

  it('persists collection reorder when the zone finalizes', async () => {
    render();
    const zone = host.querySelector('.collection-list') as HTMLElement;
    dispatchDndFinalize(zone, [{ ...fixtures.collection }]);
    await vi.waitFor(() => {
      expect(storeFns.reorderGroupCollections).toHaveBeenCalledWith('g1', [
        'c1',
      ]);
    });
  });

  /**
   * The sidebar's group rows have always accepted this drop — `groupDropTarget`
   * gates on whether a collection drag is in flight, not on which page is
   * showing. What was missing was a drag *source* outside the sidebar, so the
   * gesture only ever worked sidebar-to-sidebar.
   */
  it('starts a move-to-group drag from the header move button', () => {
    render();
    const move = host.querySelector('.collection-move-btn') as HTMLElement;
    expect(move).toBeTruthy();
    expect(move.draggable).toBe(true);

    const dataTransfer = dragStartFrom(move);
    expect(dataTransfer.getData(COLLECTION_DRAG_MIME)).toBe('c1');
    expect(get(draggingCollectionId)).toBe('c1');
  });

  /**
   * The card is a direct child of the reorder zone, and svelte-dnd-action puts
   * `ondragstart = () => false` on every one of those. Without the
   * `stopPropagation` in `startNativeDrag` the payload is set and then thrown
   * away, with no drag following.
   */
  it('starts the move-to-group drag despite the zone child cancelling dragstart', () => {
    render();
    const move = host.querySelector('.collection-move-btn') as HTMLElement;
    const card = host.querySelector('.collection-list > *') as HTMLElement;
    expect(card.contains(move)).toBe(true);

    const { survived, dataTransfer } = filingDragSurvivesNeuteredAncestor(
      card,
      move,
    );
    expect(survived).toBe(true);
    expect(dataTransfer.getData(COLLECTION_DRAG_MIME)).toBe('c1');
  });

  it('still opens the group menu when the button is clicked', () => {
    render();
    const move = host.querySelector('.collection-move-btn') as HTMLElement;
    expect(move.getAttribute('aria-expanded')).toBe('false');

    move.click();
    flushSync();

    expect(move.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.move-menu')).toBeTruthy();
  });
});

describe('CollectionsPage filing drop handler', () => {
  it('accepts the filing payload on a collection drop target', async () => {
    const moveItemToCollection = vi.fn().mockResolvedValue(undefined);
    const button = document.createElement('button');
    document.body.appendChild(button);

    await dropOntoCollectionButton(button, 'item-42', async (e) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData(DRAG_MIME) ?? '';
      await moveItemToCollection(id, 'c-target');
    });

    expect(moveItemToCollection).toHaveBeenCalledWith('item-42', 'c-target');
    button.remove();
  });
});
