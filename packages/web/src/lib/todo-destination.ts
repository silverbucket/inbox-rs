/**
 * Where a new todo lands when the user doesn't say.
 *
 * One rule, shared by every todo capture surface (the Todos page composer,
 * its mobile Fab, and the add-todo modal): a default never points outside
 * the current view. If the group filter narrows the page, the default is a
 * collection the user can see, so a plain-Enter capture always shows up in
 * the list it was typed into. Filing into a hidden collection stays
 * possible, but only as an explicit pick.
 */
import type { Collection } from '@inbox-rs/rs-module';
import { derived, writable } from 'svelte/store';
import {
  getRecentCollectionIds,
  recentCollectionsVersion,
} from './collection-suggest';
import {
  groupCollections,
  sortedGroups,
  type VisibleGroupSection,
  visibleGroupedCollections,
} from './stores';

export interface DestinationInputs {
  /** Groups currently in view, with the collections visible in each. */
  sections: VisibleGroupSection[];
  /** Every grouped collection, visible or not. */
  allCollections: Collection[];
  /** Number of groups, visible or not. */
  groupCount: number;
  /**
   * The destination the user last picked in the composer on this device:
   * a collection id, `null` for an explicit Unfiled, `undefined` if never.
   */
  remembered: string | null | undefined;
  /** Collections filed into recently on this device, newest first. */
  recent: string[];
}

/**
 * Resolve the default destination for a new todo. `undefined` means Unfiled.
 *
 *   1. Nothing in view (every group hidden): Unfiled — it is all the list
 *      can show.
 *   2. Exactly one collection in view: that collection.
 *   3. The remembered pick, if it is in view.
 *   4. With the view narrowed by a filter: the most recently used visible
 *      collection, else the first one in view. Never Unfiled — the user is
 *      working inside the filtered groups, not outside them.
 *   5. Unfiltered: Unfiled if the last pick was explicitly Unfiled, else
 *      the most recently used collection, else Unfiled.
 */
export function resolveTodoDestination({
  sections,
  allCollections,
  groupCount,
  remembered,
  recent,
}: DestinationInputs): string | undefined {
  const visible = sections.flatMap((s) => s.collections);
  if (visible.length === 0) return undefined;
  if (visible.length === 1) return visible[0].id;

  const visibleIds = new Set(visible.map((c) => c.id));
  if (typeof remembered === 'string' && visibleIds.has(remembered)) {
    return remembered;
  }

  const narrowed =
    sections.length < groupCount || visible.length < allCollections.length;
  const recentVisible = recent.find((id) => visibleIds.has(id));
  if (narrowed) return recentVisible ?? visible[0].id;
  if (remembered === null) return undefined;
  return recentVisible;
}

// Per-device composer pick. localStorage rather than synced config so a
// stale remote copy can't clobber a just-set local value. An empty string
// stands for an explicit Unfiled.
const REMEMBERED_KEY = 'inbox-rs:quickAddCollectionId';

function readRemembered(): string | null | undefined {
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY);
    if (raw === null) return undefined;
    return raw === '' ? null : raw;
  } catch {
    return undefined;
  }
}

/** The composer's remembered destination; see `DestinationInputs.remembered`. */
export const rememberedTodoDestination = writable<string | null | undefined>(
  readRemembered(),
);

export function rememberTodoDestination(id: string | null): void {
  rememberedTodoDestination.set(id);
  try {
    localStorage.setItem(REMEMBERED_KEY, id ?? '');
  } catch (error) {
    console.error('Failed to persist quick-add collection', error);
  }
}

/** The live default for a new todo under the current filters (`undefined` = Unfiled). */
export const todoDestinationDefault = derived(
  [
    visibleGroupedCollections,
    sortedGroups,
    groupCollections,
    rememberedTodoDestination,
    recentCollectionsVersion,
  ],
  ([$sections, $groups, $groupCollections, $remembered]) =>
    resolveTodoDestination({
      sections: $sections,
      allCollections: $groups.flatMap((g) => $groupCollections[g.id] ?? []),
      groupCount: $groups.length,
      remembered: $remembered,
      recent: getRecentCollectionIds(),
    }),
);
