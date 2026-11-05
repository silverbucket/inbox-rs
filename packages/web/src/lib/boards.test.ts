import type { ColumnSet, InboxItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  BOARD_UNSORTED,
  columnOf,
  columnsFromSpecs,
  copySet,
  groupByColumn,
  isAutoMatch,
  makeSet,
  matchColumns,
  moveTarget,
  nextColumnColor,
  normalizeColumns,
  placeItem,
  SET_TEMPLATES,
} from './boards';

const note = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'note',
    title: id,
    body: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  }) as unknown as InboxItem;
const todo = (id: string, extra: Record<string, unknown> = {}) =>
  note(id, { isTodo: true, completed: false, ...extra });

const pipeline: ColumnSet = {
  id: 'pipe',
  name: 'Pipeline',
  createdAt: '2026-11-01T00:00:00.000Z',
  columns: [
    { id: BOARD_UNSORTED, name: 'Unsorted', color: '#8a8378' },
    { id: 'idea', name: 'Idea', color: '#7c3aed' },
    { id: 'build', name: 'Building', color: '#4f46e5' },
    { id: 'ship', name: 'Shipped', color: '#0f766e', done: true },
  ],
};

describe('columns', () => {
  it('always starts a set with one Unsorted column', () => {
    const cols = normalizeColumns([
      { id: 'a', name: 'A', color: '#000' },
      { id: BOARD_UNSORTED, name: 'Unsorted', color: '#111' },
    ]);
    expect(cols.map((c) => c.id)).toEqual([BOARD_UNSORTED, 'a']);
    expect(normalizeColumns([])[0].id).toBe(BOARD_UNSORTED);
  });

  it('builds templates with fresh ids and a done column', () => {
    for (const t of SET_TEMPLATES) {
      const cols = columnsFromSpecs(t.columns);
      expect(cols[0].id).toBe(BOARD_UNSORTED);
      expect(cols.filter((c) => c.done)).toHaveLength(1);
      expect(new Set(cols.map((c) => c.id)).size).toBe(cols.length);
    }
    const set = makeSet('  ', columnsFromSpecs(SET_TEMPLATES[0].columns));
    expect(set.name).toBe('Untitled set');
  });

  it('copies a set keeping column ids, so placements carry over', () => {
    const copy = copySet(pipeline, 'Pipeline (Sockethub)');
    expect(copy.id).not.toBe(pipeline.id);
    expect(copy.columns.map((c) => c.id)).toEqual(
      pipeline.columns.map((c) => c.id),
    );
  });

  it('picks an unused colour for a new column', () => {
    expect(pipeline.columns.map((c) => c.color)).not.toContain(
      nextColumnColor(pipeline.columns),
    );
  });
});

describe('columnOf', () => {
  it('reads the stored column, falling back to Unsorted', () => {
    expect(
      columnOf(note('a', { boardColumns: { pipe: 'idea' } }), pipeline),
    ).toBe('idea');
    expect(columnOf(note('a'), pipeline)).toBe(BOARD_UNSORTED);
    expect(
      columnOf(note('a', { boardColumns: { pipe: 'gone' } }), pipeline),
    ).toBe(BOARD_UNSORTED);
    // Placement in another set doesn't leak across.
    expect(
      columnOf(note('a', { boardColumns: { other: 'idea' } }), pipeline),
    ).toBe(BOARD_UNSORTED);
  });

  it('shows completed todos in the done column, and open ones out of it', () => {
    expect(
      columnOf(
        todo('t', { completed: true, boardColumns: { pipe: 'idea' } }),
        pipeline,
      ),
    ).toBe('ship');
    expect(
      columnOf(todo('t', { boardColumns: { pipe: 'ship' } }), pipeline),
    ).toBe(BOARD_UNSORTED);
    // Notes have no checkbox: the done column is just a column for them.
    expect(
      columnOf(note('n', { boardColumns: { pipe: 'ship' } }), pipeline),
    ).toBe('ship');
  });

  it('groups items by column in set order', () => {
    const groups = groupByColumn(
      [
        note('a', { boardColumns: { pipe: 'build' } }),
        note('b'),
        todo('c', { completed: true }),
      ],
      pipeline,
    );
    expect([...groups.keys()]).toEqual([
      BOARD_UNSORTED,
      'idea',
      'build',
      'ship',
    ]);
    expect(groups.get('build')?.map((i) => i.id)).toEqual(['a']);
    expect(groups.get('ship')?.map((i) => i.id)).toEqual(['c']);
  });
});

describe('placeItem', () => {
  const now = new Date('2026-11-05T10:00:00.000Z');

  it('stores the column per set and keeps other sets', () => {
    const moved = placeItem(
      note('a', { boardColumns: { other: 'x' } }),
      pipeline,
      'idea',
    );
    expect(moved.boardColumns).toEqual({ other: 'x', pipe: 'idea' });
  });

  it('completes a todo dropped in the done column and reopens one taken out', () => {
    const done = placeItem(todo('t'), pipeline, 'ship', now);
    expect(done.completed).toBe(true);
    expect(done.completedAt).toBe(now.toISOString());
    const reopened = placeItem(done, pipeline, 'build', now);
    expect(reopened.completed).toBe(false);
    expect(reopened.completedAt).toBeUndefined();
    expect(columnOf(reopened, pipeline)).toBe('build');
  });

  it('leaves notes uncompleted in the done column', () => {
    expect(
      placeItem(note('n'), pipeline, 'ship', now).completed,
    ).toBeUndefined();
  });
});

describe('matchColumns', () => {
  const reading: ColumnSet = {
    id: 'read',
    name: 'Reading list',
    createdAt: '',
    columns: [
      { id: BOARD_UNSORTED, name: 'Unsorted', color: '#8a8378' },
      { id: 'to', name: 'To read', color: '#2563eb' },
      { id: 'building', name: 'building', color: '#4f46e5' },
      { id: 'read', name: 'Read', color: '#0f766e', done: true },
    ],
  };

  it('matches Unsorted, same names and done columns, else Unsorted', () => {
    const map = matchColumns(pipeline, reading);
    expect(map).toEqual({
      [BOARD_UNSORTED]: BOARD_UNSORTED,
      idea: BOARD_UNSORTED,
      build: 'building',
      ship: 'read',
    });
    expect(isAutoMatch(pipeline.columns[2], reading, 'building')).toBe(true);
    expect(isAutoMatch(pipeline.columns[3], reading, 'read')).toBe(false);
  });
});

describe('moveTarget', () => {
  const reading: ColumnSet = {
    id: 'read',
    name: 'Reading list',
    createdAt: '',
    columns: [
      { id: BOARD_UNSORTED, name: 'Unsorted', color: '#8a8378' },
      { id: 'next', name: 'Next', color: '#2563eb' },
    ],
  };

  it('follows the mapping from the current column', () => {
    const item = note('a', { boardColumns: { pipe: 'build' } });
    expect(moveTarget(item, pipeline, reading, { build: 'next' })).toBe('next');
    expect(moveTarget(item, pipeline, reading, {})).toBe(BOARD_UNSORTED);
  });

  it('returns an item to its remembered column when mapped to Unsorted', () => {
    const item = note('a', { boardColumns: { pipe: 'idea', read: 'next' } });
    expect(moveTarget(item, pipeline, reading, {})).toBe('next');
    // An explicit choice still wins.
    const back = note('b', { boardColumns: { read: 'next', pipe: 'build' } });
    expect(moveTarget(back, reading, pipeline, { next: 'idea' })).toBe('idea');
    // A remembered column that was since deleted doesn't count.
    const gone = note('c', { boardColumns: { read: 'gone' } });
    expect(moveTarget(gone, undefined, reading, {})).toBe(BOARD_UNSORTED);
  });
});
