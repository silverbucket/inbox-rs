import {
  BOARD_UNSORTED,
  type BoardColumn,
  type Collection,
  type ColumnSet,
  type InboxItem,
} from '@inbox-rs/rs-module';

/**
 * Item boards: pure helpers for column sets.
 *
 * A column set is a named, ordered list of columns shared by any number of
 * collections. An item's column is stored per set (`item.boardColumns`), so
 * an item keeps its place in every set it has been on. Unsorted is always
 * the first column and is where anything unplaced shows up.
 */

export { BOARD_UNSORTED };

/** Muted, distinguishable column colours, in the order new columns take them. */
export const COLUMN_COLORS = [
  '#d97706',
  '#4f46e5',
  '#0f766e',
  '#be185d',
  '#7c3aed',
  '#0e7490',
  '#2563eb',
  '#c2410c',
  '#eab308',
  '#15803d',
];

export const UNSORTED_COLOR = '#8a8378';

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function unsortedColumn(): BoardColumn {
  return { id: BOARD_UNSORTED, name: 'Unsorted', color: UNSORTED_COLOR };
}

type ColumnSpec = [name: string, color: string, done?: boolean];

/** Starting points for a new set. Each gets fresh ids when used. */
export const SET_TEMPLATES: Array<{ name: string; columns: ColumnSpec[] }> = [
  {
    name: 'Watch list',
    columns: [
      ['Want to watch', '#d97706'],
      ['Movie night', '#4f46e5'],
      ['Watched', '#0f766e', true],
      ['Recommend', '#be185d'],
    ],
  },
  {
    name: 'Reading list',
    columns: [
      ['To read', '#2563eb'],
      ['Reading', '#7c3aed'],
      ['Read', '#0f766e', true],
    ],
  },
  {
    name: 'Pipeline',
    columns: [
      ['Idea', '#7c3aed'],
      ['Researching', '#0e7490'],
      ['Building', '#4f46e5'],
      ['Shipped', '#0f766e', true],
    ],
  },
  {
    name: 'Trip',
    columns: [
      ['Ideas', '#0e7490'],
      ['Booked', '#4f46e5'],
      ['Done', '#0f766e', true],
    ],
  },
  {
    name: 'Release',
    columns: [
      ['Writing', '#eab308'],
      ['Recording', '#c2410c'],
      ['Mixing', '#4f46e5'],
      ['Released', '#0f766e', true],
    ],
  },
];

/** A set's columns, with Unsorted guaranteed first and present once. */
export function normalizeColumns(columns: BoardColumn[]): BoardColumn[] {
  const rest = columns.filter((c) => c.id !== BOARD_UNSORTED);
  const unsorted =
    columns.find((c) => c.id === BOARD_UNSORTED) ?? unsortedColumn();
  return [unsorted, ...rest];
}

/** Build columns from a template's specs, with fresh ids. */
export function columnsFromSpecs(specs: ColumnSpec[]): BoardColumn[] {
  return normalizeColumns(
    specs.map(([name, color, done]) => ({
      id: newId(),
      name,
      color,
      ...(done ? { done: true } : {}),
    })),
  );
}

export function makeSet(name: string, columns: BoardColumn[]): ColumnSet {
  return {
    id: newId(),
    name: name.trim() || 'Untitled set',
    columns: normalizeColumns(columns),
    createdAt: new Date().toISOString(),
  };
}

/** A copy of a set with the same column ids, so placements carry over. */
export function copySet(set: ColumnSet, name: string): ColumnSet {
  return {
    id: newId(),
    name,
    columns: set.columns.map((c) => ({ ...c })),
    createdAt: new Date().toISOString(),
  };
}

export function doneColumn(set: ColumnSet): BoardColumn | undefined {
  return set.columns.find((c) => c.done);
}

const isTodo = (item: InboxItem) => !!item.isTodo || item.type === 'todo';

/**
 * The column an item shows in on a set's board. A completed todo shows in
 * the done column when the set has one, whatever was stored; anything
 * unplaced, or placed in a column that no longer exists, is Unsorted.
 */
export function columnOf(item: InboxItem, set: ColumnSet): string {
  const done = doneColumn(set);
  if (done && isTodo(item) && item.completed) return done.id;
  const stored = item.boardColumns?.[set.id];
  if (stored && set.columns.some((c) => c.id === stored)) {
    // An open todo can't sit in the done column.
    if (done && stored === done.id && isTodo(item)) return BOARD_UNSORTED;
    return stored;
  }
  return BOARD_UNSORTED;
}

/** Items grouped by column, in the set's column order and the given item order. */
export function groupByColumn(
  items: InboxItem[],
  set: ColumnSet,
): Map<string, InboxItem[]> {
  const out = new Map<string, InboxItem[]>(set.columns.map((c) => [c.id, []]));
  for (const item of items) out.get(columnOf(item, set))?.push(item);
  return out;
}

/**
 * The item placed in `columnId` of `setId`. Moving a todo into the done
 * column completes it; moving a completed todo out reopens it.
 */
/**
 * Record an item's column in a set without touching its completion. For
 * bulk moves (deleting a column, switching a collection's set): those
 * rearrange the board, they don't tick or untick anyone's todos. The board
 * still shows completed todos in the done column via columnOf.
 */
export function withColumn<T extends InboxItem>(
  item: T,
  set: ColumnSet,
  columnId: string,
): T {
  return {
    ...item,
    boardColumns: { ...(item.boardColumns ?? {}), [set.id]: columnId },
  };
}

/**
 * A list's plan column after its collection moves to another set: the
 * column it maps to, or undefined when it maps to Unsorted (that would put
 * every unsorted todo on the plan) or the collection has none.
 */
export function mapPlanColumn(
  planColumnId: string | undefined,
  to: ColumnSet,
  mapping: Record<string, string>,
): string | undefined {
  if (!planColumnId) return undefined;
  const target = mapping[planColumnId];
  if (!target || target === BOARD_UNSORTED) return undefined;
  return to.columns.some((c) => c.id === target) ? target : undefined;
}

export function placeItem<T extends InboxItem>(
  item: T,
  set: ColumnSet,
  columnId: string,
  now: Date = new Date(),
): T {
  const next = {
    ...item,
    boardColumns: { ...(item.boardColumns ?? {}), [set.id]: columnId },
  } as T;
  if (!isTodo(item)) return next;
  const done = doneColumn(set);
  if (done && columnId === done.id && !item.completed) {
    return { ...next, completed: true, completedAt: now.toISOString() };
  }
  if (done && columnId !== done.id && item.completed) {
    const reopened = { ...next, completed: false } as T;
    delete (reopened as { completedAt?: string }).completedAt;
    return reopened;
  }
  return next;
}

/**
 * Default column matches when moving from one set to another: Unsorted to
 * Unsorted, same names (ignoring case) to each other, done to done, and
 * anything else to Unsorted.
 */
export function matchColumns(
  from: ColumnSet,
  to: ColumnSet,
): Record<string, string> {
  const byName = new Map(
    to.columns.map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  const toDone = doneColumn(to);
  const map: Record<string, string> = {};
  for (const c of from.columns) {
    if (c.id === BOARD_UNSORTED) map[c.id] = BOARD_UNSORTED;
    else
      map[c.id] =
        byName.get(c.name.trim().toLowerCase()) ??
        (c.done && toDone ? toDone.id : BOARD_UNSORTED);
  }
  return map;
}

/** Whether a match came from a same name (shown as "auto"). */
export function isAutoMatch(
  from: BoardColumn,
  to: ColumnSet,
  targetId: string,
): boolean {
  if (from.id === BOARD_UNSORTED) return targetId === BOARD_UNSORTED;
  const target = to.columns.find((c) => c.id === targetId);
  return (
    !!target &&
    target.name.trim().toLowerCase() === from.name.trim().toLowerCase()
  );
}

/** Collections on a set, in the given order. */
export function collectionsOnSet(
  set: ColumnSet,
  collections: Collection[],
): Collection[] {
  return collections.filter((c) => c.boardSetId === set.id && !c.archived);
}

/** The next unused colour for a new column. */
export function nextColumnColor(columns: BoardColumn[]): string {
  const used = new Set(columns.map((c) => c.color));
  return (
    COLUMN_COLORS.find((c) => !used.has(c)) ??
    COLUMN_COLORS[columns.length % COLUMN_COLORS.length]
  );
}

/**
 * Where an item lands when its collection moves from `from` (or no set) to
 * `to` under `mapping` (old column → new column). A mapping to Unsorted is
 * no real choice, so an item that remembers a column in `to` (it was there
 * before) goes back to it, if that column still exists.
 */
export function moveTarget(
  item: InboxItem,
  from: ColumnSet | undefined,
  to: ColumnSet,
  mapping: Record<string, string>,
  /** Source columns whose target the user picked: always honoured. */
  explicit: ReadonlySet<string> = new Set(),
): string {
  const fromCol = from ? columnOf(item, from) : BOARD_UNSORTED;
  const mapped = mapping[fromCol] ?? BOARD_UNSORTED;
  const remembered = item.boardColumns?.[to.id];
  if (
    !explicit.has(fromCol) &&
    mapped === BOARD_UNSORTED &&
    remembered &&
    to.columns.some((c) => c.id === remembered)
  )
    return remembered;
  return mapped;
}
