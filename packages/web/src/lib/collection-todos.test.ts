// @vitest-environment jsdom
import type { InboxItem, NoteItem, TodoItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  filterCompletedTodos,
  filterOpenTodos,
  filterReferenceItems,
  filterTodos,
  sortCompletedTodosByCompletedAt,
  spliceOpenTodoOrder,
} from './collection-todos';

function todo(id: string, completed: boolean, completedAt?: string): TodoItem {
  return {
    id,
    type: 'todo',
    title: id,
    isTodo: true,
    completed,
    completedAt,
    createdAt: '2026-04-01T00:00:00.000Z',
  };
}

function flaggedTodo(id: string): NoteItem {
  // A note item that's been promoted to a todo via isTodo=true (reference
  // items can be converted in place, so the union allows the flag without a
  // type change).
  return {
    id,
    type: 'note',
    title: id,
    body: '',
    isTodo: true,
    completed: false,
    createdAt: '2026-04-01T00:00:00.000Z',
  } as NoteItem;
}

function ref(id: string): NoteItem {
  return {
    id,
    type: 'note',
    title: id,
    body: '',
    createdAt: '2026-04-01T00:00:00.000Z',
  };
}

describe('filterTodos', () => {
  it('includes items with type "todo" and items flagged isTodo', () => {
    const items: InboxItem[] = [
      todo('t1', false),
      flaggedTodo('t2'),
      ref('r1'),
    ];
    expect(filterTodos(items).map((i) => i.id)).toEqual(['t1', 't2']);
  });
});

describe('filterOpenTodos / filterCompletedTodos', () => {
  it('partitions todos by completed flag', () => {
    const todos: InboxItem[] = [
      todo('t1', false),
      todo('t2', true, '2026-04-02T00:00:00.000Z'),
      todo('t3', false),
    ];
    expect(filterOpenTodos(todos).map((t) => t.id)).toEqual(['t1', 't3']);
    expect(filterCompletedTodos(todos).map((t) => t.id)).toEqual(['t2']);
  });
});

describe('filterReferenceItems', () => {
  it('excludes both type=todo and isTodo-flagged items', () => {
    const items: InboxItem[] = [
      ref('r1'),
      todo('t1', false),
      flaggedTodo('t2'),
      ref('r2'),
    ];
    expect(filterReferenceItems(items).map((i) => i.id)).toEqual(['r1', 'r2']);
  });
});

describe('sortCompletedTodosByCompletedAt', () => {
  it('returns most recently completed first; falls back to createdAt when completedAt is missing', () => {
    const completed: InboxItem[] = [
      { ...todo('a', true, '2026-04-02T00:00:00.000Z') },
      { ...todo('b', true, '2026-04-05T00:00:00.000Z') },
      // Missing completedAt — should sort by createdAt (which is 2026-04-01).
      { ...todo('c', true), completedAt: undefined },
    ];
    expect(sortCompletedTodosByCompletedAt(completed).map((t) => t.id)).toEqual(
      ['b', 'a', 'c'],
    );
  });

  it('does not mutate the input array', () => {
    const completed: InboxItem[] = [
      todo('a', true, '2026-04-02T00:00:00.000Z'),
      todo('b', true, '2026-04-05T00:00:00.000Z'),
    ];
    const before = completed.map((t) => t.id);
    sortCompletedTodosByCompletedAt(completed);
    expect(completed.map((t) => t.id)).toEqual(before);
  });
});

describe('spliceOpenTodoOrder', () => {
  it('places reordered open todos first, preserves rest order', () => {
    // itemIds: o1, c1, o2, r1, o3 — open todos are o1/o2/o3, rest is c1, r1.
    const result = spliceOpenTodoOrder(
      ['o1', 'c1', 'o2', 'r1', 'o3'],
      ['o1', 'o2', 'o3'],
      ['o3', 'o1', 'o2'],
    );
    expect(result).toEqual(['o3', 'o1', 'o2', 'c1', 'r1']);
  });

  it('keeps completed and reference order stable when only one open todo moves', () => {
    const result = spliceOpenTodoOrder(
      ['o1', 'o2', 'c1', 'r1', 'r2'],
      ['o1', 'o2'],
      ['o2', 'o1'],
    );
    expect(result).toEqual(['o2', 'o1', 'c1', 'r1', 'r2']);
  });

  it('handles a collection with no rest items', () => {
    const result = spliceOpenTodoOrder(
      ['o1', 'o2', 'o3'],
      ['o1', 'o2', 'o3'],
      ['o2', 'o3', 'o1'],
    );
    expect(result).toEqual(['o2', 'o3', 'o1']);
  });

  it('handles a collection with no open todos in the previous set', () => {
    // Edge case: previousOpenIds is empty, so all current ids become "rest".
    // newOpenIds prepends ahead of them.
    const result = spliceOpenTodoOrder(['c1', 'r1'], [], []);
    expect(result).toEqual(['c1', 'r1']);
  });
});
