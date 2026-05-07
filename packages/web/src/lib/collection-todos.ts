import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { reorderCollectionItems } from './stores';

export function filterTodos(items: InboxItem[]): InboxItem[] {
  return items.filter((i) => i.isTodo || i.type === 'todo');
}

export function filterOpenTodos(todos: InboxItem[]): InboxItem[] {
  return todos.filter((t) => !t.completed);
}

export function filterCompletedTodos(todos: InboxItem[]): InboxItem[] {
  return todos.filter((t) => t.completed);
}

export function filterReferenceItems(items: InboxItem[]): InboxItem[] {
  return items.filter((i) => !i.isTodo && i.type !== 'todo');
}

export function sortCompletedTodosByCompletedAt(
  completed: InboxItem[],
): InboxItem[] {
  return completed
    .slice()
    .sort(
      (a, b) =>
        new Date(b.completedAt ?? b.createdAt).getTime() -
        new Date(a.completedAt ?? a.createdAt).getTime(),
    );
}

// Splice a new open-todo order into a collection's full itemIds list while
// preserving the relative position of completed todos and reference items.
// Anything not in `previousOpenIds` keeps its current position after the
// reordered open todos; this is what makes a single-todo drag avoid scrambling
// the references grid below it.
export function spliceOpenTodoOrder(
  currentItemIds: string[],
  previousOpenIds: string[],
  newOpenIds: string[],
): string[] {
  const openSet = new Set(previousOpenIds);
  const rest = currentItemIds.filter((id) => !openSet.has(id));
  return [...newOpenIds, ...rest];
}

// Persist a new open-todo order. Errors propagate so the caller can roll back
// its local dnd UI state.
export async function applyOpenTodoReorder(
  collection: Collection,
  previousOpenIds: string[],
  newOpenIds: string[],
): Promise<void> {
  const newItemIds = spliceOpenTodoOrder(
    collection.itemIds,
    previousOpenIds,
    newOpenIds,
  );
  await reorderCollectionItems(collection.id, newItemIds);
}
