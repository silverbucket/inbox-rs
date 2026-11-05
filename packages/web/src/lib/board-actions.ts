import type {
  BoardColumn,
  Collection,
  CollectionViewMode,
  ColumnSet,
  InboxItem,
} from '@inbox-rs/rs-module';
import { derived, get } from 'svelte/store';
import {
  BOARD_UNSORTED,
  columnOf,
  copySet,
  moveTarget,
  normalizeColumns,
  placeItem,
  withColumn,
} from './boards';
import { recordCollectionUse } from './collection-suggest';
import {
  appConfig,
  collections,
  deleteItem,
  flushItemChanges,
  items,
  moveItemToCollection,
  storeCollection,
  storeItem,
  updateConfig,
} from './stores';

/**
 * Board writes: column sets live in the app config, a collection's set in
 * the collection, and each item's column in the item. Every action reads
 * the freshest copies (buffered remote edits applied) before writing.
 */

/**
 * All column sets, in the user's order, each with Unsorted first. Sets
 * written by another device or an import aren't normalized on the way in,
 * and a board drops cards whose column is missing.
 */
export const columnSets = derived(appConfig, ($c) =>
  ($c.columnSets ?? []).map((s) => ({
    ...s,
    columns: normalizeColumns(s.columns),
  })),
);

export function findSet(id: string | undefined): ColumnSet | undefined {
  return id ? get(columnSets).find((s) => s.id === id) : undefined;
}

async function saveSets(sets: ColumnSet[]) {
  await updateConfig({
    columnSets: sets.map((s) => ({
      ...s,
      columns: normalizeColumns(s.columns),
    })),
  });
}

/** Add a set, or replace the one with the same id. */
export async function saveSet(set: ColumnSet) {
  const sets = get(columnSets);
  const at = sets.findIndex((s) => s.id === set.id);
  await saveSets(
    at === -1 ? [...sets, set] : sets.map((s, i) => (i === at ? set : s)),
  );
}

/** Point collections at a set (or none). Turning a board off keeps item columns. */
export async function setCollectionsBoard(
  collectionIds: string[],
  setId: string | undefined,
) {
  const all = get(collections);
  for (const id of collectionIds) {
    const col = all[id];
    if (!col || col.boardSetId === setId) continue;
    const next: Collection = { ...col };
    if (setId) next.boardSetId = setId;
    else delete next.boardSetId;
    // A plan column belongs to the old set's columns.
    if (col.boardSetId !== setId) delete next.planColumnId;
    await storeCollection(next);
  }
}

/**
 * Delete a set; collections on it lose their board, items keep their columns.
 * The set goes first: if clearing a collection then fails, its leftover
 * reference points at no set, which reads as "no board" everywhere (see
 * viewFor), so nothing is left half-assigned to a live set.
 */
export async function deleteSet(setId: string) {
  const users = Object.values(get(collections)).filter(
    (c) => c.boardSetId === setId,
  );
  await saveSets(get(columnSets).filter((s) => s.id !== setId));
  await setCollectionsBoard(
    users.map((c) => c.id),
    undefined,
  );
}

function itemsOf(collectionIds: string[]): InboxItem[] {
  const wanted = new Set(collectionIds);
  return Object.values(get(items)).filter(
    (i) => i.collectionId && wanted.has(i.collectionId),
  );
}

/** Move one item to a column of a set's board. */
export async function moveItemToColumn(
  target: InboxItem,
  set: ColumnSet,
  columnId: string,
) {
  flushItemChanges();
  const item = get(items)[target.id] ?? target;
  if (
    columnOf(item, set) === columnId &&
    item.boardColumns?.[set.id] === columnId
  )
    return;
  await storeItem(placeItem(item, set, columnId));
}

/** Rename, recolour, reorder or add columns (no deletions: see deleteColumn). */
export async function updateColumns(setId: string, columns: BoardColumn[]) {
  const set = findSet(setId);
  if (!set) return;
  await saveSet({ ...set, columns: normalizeColumns(columns) });
}

/** Tag one column as done (or none). */
export async function setDoneColumn(
  setId: string,
  columnId: string | undefined,
) {
  const set = findSet(setId);
  if (!set) return;
  await saveSet({
    ...set,
    columns: set.columns.map((c) => {
      const next = { ...c };
      if (c.id === columnId && c.id !== BOARD_UNSORTED) next.done = true;
      else delete next.done;
      return next;
    }),
  });
}

/**
 * Delete a column from a shared set, moving its items (in every collection
 * on the set) to another column first. Unsorted can't be deleted.
 */
export async function deleteColumn(
  setId: string,
  columnId: string,
  moveTo: string,
) {
  const set = findSet(setId);
  if (!set || columnId === BOARD_UNSORTED || columnId === moveTo) return;
  flushItemChanges();
  const users = Object.values(get(collections))
    .filter((c) => c.boardSetId === setId)
    .map((c) => c.id);
  for (const item of itemsOf(users)) {
    if (columnOf(item, set) !== columnId) continue;
    // Only the column changes: deleting the done column must not reopen
    // its completed todos, nor moving into it complete open ones.
    await storeItem(withColumn(item, set, moveTo));
  }
  await saveSet({
    ...set,
    columns: set.columns.filter((c) => c.id !== columnId),
  });
  for (const col of Object.values(get(collections))) {
    if (col.boardSetId === setId && col.planColumnId === columnId) {
      const next = { ...col };
      delete next.planColumnId;
      await storeCollection(next);
    }
  }
}

/** How many items (across a set's collections) sit in each column. */
export function columnCounts(set: ColumnSet): Map<string, number> {
  const users = Object.values(get(collections))
    .filter((c) => c.boardSetId === set.id && !c.archived)
    .map((c) => c.id);
  const counts = new Map(set.columns.map((c) => [c.id, 0]));
  for (const item of itemsOf(users)) {
    const col = columnOf(item, set);
    counts.set(col, (counts.get(col) ?? 0) + 1);
  }
  return counts;
}

/**
 * Move a collection to another set, placing its items by `mapping`
 * (old column → new column). Their old-set columns stay recorded, so moving
 * back restores them: an item mapped to Unsorted (no real choice made)
 * returns to the column it last had in the destination set, if that column
 * still exists.
 */
export async function moveCollectionToSet(
  collectionId: string,
  toSetId: string,
  mapping: Record<string, string>,
  /** Source columns whose target the user picked (honoured even if Unsorted). */
  explicit: ReadonlySet<string> = new Set(),
) {
  const col = get(collections)[collectionId];
  const from = findSet(col?.boardSetId);
  const to = findSet(toSetId);
  if (!col || !to) return;
  flushItemChanges();
  for (const item of itemsOf([collectionId])) {
    const target = moveTarget(item, from, to, mapping, explicit);
    // Switching sets rearranges the board; it never ticks or unticks todos.
    if (item.boardColumns?.[to.id] === target) continue;
    await storeItem(withColumn(item, to, target));
  }
  await setCollectionsBoard([collectionId], toSetId);
}

/** Give a collection its own copy of its set; nothing else changes. */
export async function makePrivateCopy(
  collectionId: string,
): Promise<ColumnSet | undefined> {
  const col = get(collections)[collectionId];
  const from = findSet(col?.boardSetId);
  if (!col || !from) return undefined;
  const copy = copySet(from, `${from.name} (${col.name})`);
  await saveSet(copy);
  flushItemChanges();
  for (const item of itemsOf([collectionId])) {
    const stored = item.boardColumns?.[from.id];
    if (!stored) continue;
    await storeItem({
      ...item,
      boardColumns: { ...item.boardColumns, [copy.id]: stored },
    });
  }
  const next: Collection = { ...col, boardSetId: copy.id };
  await storeCollection(next);
  return copy;
}

/** Collection id → view mode. */
export const collectionViews = derived(
  appConfig,
  ($c) => $c.collectionViews ?? {},
);

export function viewFor(
  col: Collection,
  views: Record<string, CollectionViewMode>,
  sets: ColumnSet[] = get(columnSets),
): CollectionViewMode {
  // A reference to a deleted set (e.g. removed on another device) is no board.
  const hasSet = !!col.boardSetId && sets.some((s) => s.id === col.boardSetId);
  const v = views[col.id];
  if (v === 'board' && !hasSet) return 'grid';
  return v ?? (hasSet ? 'board' : 'grid');
}

export async function setCollectionView(
  collectionId: string,
  view: CollectionViewMode,
) {
  await updateConfig({
    collectionViews: { ...get(collectionViews), [collectionId]: view },
  });
}

/** Keep a collection's todos off the Todos plan (a list), optionally bringing one column back. */
export async function setOffPlan(
  collectionId: string,
  offPlan: boolean,
  planColumnId?: string,
) {
  const col = get(collections)[collectionId];
  if (!col) return;
  const next: Collection = { ...col };
  if (offPlan) next.offPlan = true;
  else delete next.offPlan;
  if (offPlan && planColumnId) next.planColumnId = planColumnId;
  else delete next.planColumnId;
  await storeCollection(next);
}

/**
 * Add a note (or todo) straight into a board column. Stored already filed
 * and placed, then registered with the collection — one item write, like
 * the Todos quick-add.
 */
export async function addToColumn(
  collectionId: string,
  set: ColumnSet,
  columnId: string,
  title: string,
  asTodo = false,
): Promise<InboxItem> {
  const base: Record<string, unknown> = {
    id: crypto.randomUUID(),
    type: 'note',
    title: title.trim(),
    body: '',
    createdAt: new Date().toISOString(),
    collectionId,
  };
  if (asTodo) {
    base.isTodo = true;
    base.completed = false;
  }
  const item = placeItem(base as unknown as InboxItem, set, columnId);
  await storeItem(item);
  try {
    await moveItemToCollection(item.id, collectionId);
  } catch (error) {
    // Don't leave an unregistered copy behind for a retry to duplicate.
    await deleteItem(item.id, item).catch((cleanupError) =>
      console.error('Could not remove the unregistered card', cleanupError),
    );
    throw error;
  }
  recordCollectionUse(collectionId);
  return item;
}
