import type { InboxItem } from '@inbox-rs/rs-module';

export function filterTodos(items: InboxItem[]): InboxItem[] {
  return items.filter((i) => i.isTodo || i.type === 'todo');
}

export function filterOpenTodos(todos: InboxItem[]): InboxItem[] {
  return pinItemsFirst(todos.filter((t) => !t.completed && !t.archived));
}

export function filterCompletedTodos(todos: InboxItem[]): InboxItem[] {
  return todos.filter((t) => t.completed && !t.archived);
}

export function filterReferenceItems(items: InboxItem[]): InboxItem[] {
  return pinItemsFirst(
    items
      .filter((i) => !i.isTodo && i.type !== 'todo' && !i.archived)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
  );
}

/** Stable priority partition: preserve manual/natural order within each band. */
export function pinItemsFirst(items: InboxItem[]): InboxItem[] {
  const pinned = items.filter((item) => item.pinned);
  if (pinned.length === 0) return items;
  return [...pinned, ...items.filter((item) => !item.pinned)];
}

/**
 * Items moved to a calendar (any kind), for a collection's collapsed
 * "on calendar" section — newest move first. Archived wins over completed:
 * an archived+completed todo lives here, not in the completed section.
 */
export function filterOnCalendarItems(items: InboxItem[]): InboxItem[] {
  return items
    .filter((i) => !!i.archived)
    .sort(
      (a, b) =>
        new Date(b.archivedAt ?? b.createdAt).getTime() -
        new Date(a.archivedAt ?? a.createdAt).getTime(),
    );
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
