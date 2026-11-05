import type { Collection, ColumnSet, InboxItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./stores', async () => {
  const { writable, get } = await import('svelte/store');
  const appConfig = writable<Record<string, unknown>>({});
  const collections = writable<Record<string, Collection>>({});
  const items = writable<Record<string, InboxItem>>({});
  return {
    appConfig,
    collections,
    items,
    flushItemChanges: vi.fn(),
    updateConfig: vi.fn(async (patch: Record<string, unknown>) => {
      appConfig.set({ ...get(appConfig), ...patch });
    }),
    storeCollection: vi.fn(async (c: Collection) => {
      collections.set({ ...get(collections), [c.id]: c });
    }),
    storeItem: vi.fn(async (i: InboxItem) => {
      items.set({ ...get(items), [i.id]: i });
    }),
    moveItemToCollection: vi.fn(async () => {}),
    deleteItem: vi.fn(async (id: string) => {
      const next = { ...get(items) };
      delete next[id];
      items.set(next);
    }),
  };
});
vi.mock('./collection-suggest', () => ({ recordCollectionUse: vi.fn() }));

import {
  addToColumn,
  columnCounts,
  columnSets,
  deleteColumn,
  deleteSet,
  makePrivateCopy,
  moveCollectionToSet,
  moveItemToColumn,
  setDoneColumn,
  setOffPlan,
  viewFor,
} from './board-actions';
import { BOARD_UNSORTED, columnOf } from './boards';
import * as stores from './stores';

const pipeline: ColumnSet = {
  id: 'pipe',
  name: 'Pipeline',
  createdAt: '',
  columns: [
    { id: BOARD_UNSORTED, name: 'Unsorted', color: '#8a8378' },
    { id: 'idea', name: 'Idea', color: '#7c3aed' },
    { id: 'build', name: 'Building', color: '#4f46e5' },
    { id: 'ship', name: 'Shipped', color: '#0f766e', done: true },
  ],
};
const reading: ColumnSet = {
  id: 'read',
  name: 'Reading list',
  createdAt: '',
  columns: [
    { id: BOARD_UNSORTED, name: 'Unsorted', color: '#8a8378' },
    { id: 'next', name: 'Next', color: '#2563eb' },
  ],
};

const col = (id: string, extra: Partial<Collection> = {}) =>
  ({ id, name: id, createdAt: '', ...extra }) as Collection;
const note = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'note',
    title: id,
    body: '',
    createdAt: '',
    ...extra,
  }) as unknown as InboxItem;

const item = (id: string) => get(stores.items)[id];

beforeEach(() => {
  stores.appConfig.set({ columnSets: [pipeline, reading] });
  stores.collections.set({
    a: col('a', { boardSetId: 'pipe' }),
    b: col('b', { boardSetId: 'pipe' }),
  });
  stores.items.set({
    x: note('x', { collectionId: 'a', boardColumns: { pipe: 'build' } }),
    y: note('y', { collectionId: 'b', boardColumns: { pipe: 'build' } }),
    z: note('z', { collectionId: 'a' }),
  });
});

describe('board actions', () => {
  it('moves an item to a column', async () => {
    await moveItemToColumn(item('z'), pipeline, 'idea');
    expect(item('z').boardColumns).toEqual({ pipe: 'idea' });
  });

  it('counts items per column across every collection on the set', () => {
    const counts = columnCounts(pipeline);
    expect(counts.get('build')).toBe(2);
    expect(counts.get(BOARD_UNSORTED)).toBe(1);
    expect(counts.get('ship')).toBe(0);
  });

  it('deletes a column after moving its items, in every collection', async () => {
    stores.collections.set({
      ...get(stores.collections),
      b: col('b', { boardSetId: 'pipe', planColumnId: 'build' }),
    });
    await deleteColumn('pipe', 'build', 'idea');
    expect(item('x').boardColumns?.pipe).toBe('idea');
    expect(item('y').boardColumns?.pipe).toBe('idea');
    const set = (get(stores.appConfig).columnSets as ColumnSet[])[0];
    expect(set.columns.map((c) => c.id)).not.toContain('build');
    // The plan column follows its items.
    expect(get(stores.collections).b.planColumnId).toBe('idea');
  });

  it('keeps completed todos completed when their done column is deleted', async () => {
    stores.items.set({
      ...get(stores.items),
      t: note('t', {
        collectionId: 'a',
        isTodo: true,
        completed: true,
        completedAt: '2026-01-01T00:00:00.000Z',
        boardColumns: { pipe: 'idea' },
      }),
    });
    await deleteColumn('pipe', 'ship', 'build');
    expect(item('t').completed).toBe(true);
    expect(item('t').completedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(item('t').boardColumns?.pipe).toBe('build');
  });

  it('never completes open todos moved into the done column', async () => {
    await deleteColumn('pipe', 'build', 'ship');
    expect(item('x').completed).toBeUndefined();
    stores.items.set({
      t: note('t', {
        collectionId: 'a',
        isTodo: true,
        completed: false,
        boardColumns: { pipe: 'idea' },
      }),
    });
    await deleteColumn('pipe', 'idea', 'ship');
    expect(item('t').completed).toBe(false);
  });

  it('switching sets never ticks or unticks todos', async () => {
    const shipped: ColumnSet = {
      ...reading,
      id: 'shipset',
      columns: [
        ...reading.columns,
        { id: 'done', name: 'Done', color: '#000', done: true },
      ],
    };
    stores.appConfig.set({ columnSets: [reading, shipped] });
    stores.collections.set({ a: col('a', { boardSetId: 'read' }) });
    stores.items.set({
      open: note('open', {
        collectionId: 'a',
        isTodo: true,
        completed: false,
        boardColumns: { read: 'next' },
      }),
      doneOne: note('doneOne', {
        collectionId: 'a',
        isTodo: true,
        completed: true,
        completedAt: '2026-01-01T00:00:00.000Z',
        boardColumns: { read: 'next' },
      }),
    });
    // "Read" has no done column; Next -> Done in the new set.
    await moveCollectionToSet(
      'a',
      'shipset',
      { next: 'done' },
      new Set(['next']),
    );
    expect(item('open').completed).toBe(false);
    expect(columnOf(item('open'), shipped)).toBe(BOARD_UNSORTED);
    expect(item('doneOne').completed).toBe(true);
    expect(item('doneOne').completedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(columnOf(item('doneOne'), shipped)).toBe('done');
  });

  it("carries a list's plan column across a set switch", async () => {
    stores.collections.set({
      a: col('a', { boardSetId: 'pipe', offPlan: true, planColumnId: 'build' }),
    });
    const kept = await moveCollectionToSet('a', 'read', { build: 'next' });
    expect(kept.planColumnDropped).toBe(false);
    expect(get(stores.collections).a).toMatchObject({
      boardSetId: 'read',
      offPlan: true,
      planColumnId: 'next',
    });
  });

  it('drops (and reports) a plan column that maps to Unsorted', async () => {
    stores.collections.set({
      a: col('a', { boardSetId: 'pipe', offPlan: true, planColumnId: 'idea' }),
    });
    const res = await moveCollectionToSet('a', 'read', {});
    expect(res.planColumnDropped).toBe(true);
    expect(get(stores.collections).a.planColumnId).toBeUndefined();
    expect(get(stores.collections).a.offPlan).toBe(true);
  });

  it('honours an explicit Unsorted over a remembered column', async () => {
    stores.items.set({
      x: note('x', {
        collectionId: 'a',
        boardColumns: { pipe: 'build', read: 'next' },
      }),
    });
    await moveCollectionToSet('a', 'read', {}, new Set());
    expect(item('x').boardColumns?.read).toBe('next');
    await moveCollectionToSet('a', 'pipe', {});
    await moveCollectionToSet(
      'a',
      'read',
      { build: BOARD_UNSORTED },
      new Set(['build']),
    );
    expect(item('x').boardColumns?.read).toBe(BOARD_UNSORTED);
  });

  it('removes the stored card if registering it fails', async () => {
    vi.mocked(stores.moveItemToCollection).mockRejectedValueOnce(
      new Error('offline'),
    );
    await expect(addToColumn('a', pipeline, 'idea', 'Oops')).rejects.toThrow(
      'offline',
    );
    expect(stores.deleteItem).toHaveBeenCalled();
  });

  it('treats a reference to a deleted set as no board', () => {
    expect(viewFor(col('c', { boardSetId: 'gone' }), {}, [pipeline])).toBe(
      'grid',
    );
    expect(
      viewFor(col('c', { boardSetId: 'gone' }), { c: 'board' }, [pipeline]),
    ).toBe('grid');
  });

  it('normalizes synced sets so Unsorted comes first', () => {
    stores.appConfig.set({
      columnSets: [{ ...reading, columns: [reading.columns[1]] }],
    });
    expect(get(columnSets)[0].columns[0].id).toBe(BOARD_UNSORTED);
  });

  it("moves a list's plan column with the deleted column's items", async () => {
    stores.collections.set({
      a: col('a', { boardSetId: 'pipe', offPlan: true, planColumnId: 'build' }),
      b: col('b', { boardSetId: 'pipe', offPlan: true, planColumnId: 'idea' }),
    });
    await deleteColumn('pipe', 'build', 'idea');
    expect(get(stores.collections).a.planColumnId).toBe('idea');
    await deleteColumn('pipe', 'idea', BOARD_UNSORTED);
    expect(get(stores.collections).a.planColumnId).toBeUndefined();
    expect(get(stores.collections).b.planColumnId).toBeUndefined();
    expect(get(stores.collections).a.offPlan).toBe(true);
  });

  it('never deletes Unsorted', async () => {
    await deleteColumn('pipe', BOARD_UNSORTED, 'idea');
    const set = (get(stores.appConfig).columnSets as ColumnSet[])[0];
    expect(set.columns[0].id).toBe(BOARD_UNSORTED);
  });

  it('keeps one done column, never Unsorted', async () => {
    await setDoneColumn('pipe', 'idea');
    let set = (get(stores.appConfig).columnSets as ColumnSet[])[0];
    expect(set.columns.filter((c) => c.done).map((c) => c.id)).toEqual([
      'idea',
    ]);
    await setDoneColumn('pipe', BOARD_UNSORTED);
    set = (get(stores.appConfig).columnSets as ColumnSet[])[0];
    expect(set.columns.some((c) => c.done)).toBe(false);
  });

  it('moves a collection to another set and back, restoring columns', async () => {
    await moveCollectionToSet('a', 'read', { build: 'next' });
    expect(get(stores.collections).a.boardSetId).toBe('read');
    expect(item('x').boardColumns).toEqual({ pipe: 'build', read: 'next' });
    expect(item('z').boardColumns).toEqual({ read: BOARD_UNSORTED });
    // b is untouched.
    expect(item('y').boardColumns).toEqual({ pipe: 'build' });

    await moveCollectionToSet('a', 'pipe', {});
    expect(columnOf(item('x'), pipeline)).toBe('build');
  });

  it('makes a private copy that keeps placements', async () => {
    const copy = await makePrivateCopy('a');
    expect(copy?.name).toBe('Pipeline (a)');
    expect(get(stores.collections).a.boardSetId).toBe(copy?.id);
    expect(get(stores.collections).b.boardSetId).toBe('pipe');
    expect(item('x').boardColumns?.[copy?.id ?? '']).toBe('build');
  });

  it('deleting a set turns boards off but keeps item columns', async () => {
    await deleteSet('pipe');
    expect(get(stores.collections).a.boardSetId).toBeUndefined();
    expect(item('x').boardColumns).toEqual({ pipe: 'build' });
    const ids = (get(stores.appConfig).columnSets as ColumnSet[]).map(
      (s) => s.id,
    );
    expect(ids).toEqual(['read']);
  });

  it('marks a list off the plan with an optional plan column', async () => {
    await setOffPlan('a', true, 'idea');
    expect(get(stores.collections).a).toMatchObject({
      offPlan: true,
      planColumnId: 'idea',
    });
    await setOffPlan('a', true, BOARD_UNSORTED);
    expect(get(stores.collections).a.planColumnId).toBeUndefined();
    await setOffPlan('a', false, 'idea');
    expect(get(stores.collections).a.offPlan).toBeUndefined();
    expect(get(stores.collections).a.planColumnId).toBeUndefined();
  });

  it('adds a filed, placed item straight into a column', async () => {
    const added = await addToColumn('a', pipeline, 'ship', ' Ship it ', true);
    expect(added).toMatchObject({
      title: 'Ship it',
      collectionId: 'a',
      isTodo: true,
      completed: true,
      boardColumns: { pipe: 'ship' },
    });
    expect(stores.moveItemToCollection).toHaveBeenCalledWith(added.id, 'a');
  });

  it('defaults the view to board only when a set is chosen', () => {
    expect(viewFor(col('c'), {})).toBe('grid');
    expect(viewFor(col('c', { boardSetId: 'pipe' }), {})).toBe('board');
    expect(viewFor(col('c'), { c: 'board' })).toBe('grid');
    expect(viewFor(col('c', { boardSetId: 'pipe' }), { c: 'list' })).toBe(
      'list',
    );
  });
});
