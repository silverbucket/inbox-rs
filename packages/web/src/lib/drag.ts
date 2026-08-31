/**
 * Cross-component drag state for assigning items onto sidebar collections.
 *
 * Native HTML5 drag-and-drop carries the item id in the drag's dataTransfer,
 * so the drop target reads it directly. This store exists only so drop targets
 * (sidebar collections) can light up *while* a compatible drag is in progress —
 * dataTransfer contents aren't readable during dragover for security reasons.
 */
import { writable } from 'svelte/store';

/** Id of the item currently being dragged onto a sidebar collection, or null. */
export const draggingItemId = writable<string | null>(null);

/** Custom MIME so only our item drags activate collection drop targets. */
export const DRAG_MIME = 'application/x-inbox-item';

/**
 * Id of the collection currently being dragged onto a sidebar group, or null.
 *
 * A separate gesture from the reorder grip, and on a separate control: the
 * grip runs svelte-dnd-action's pointer drag to reorder within a group, while
 * the move button beside it is a native drag source that moves the collection
 * to whichever group it lands on (and opens a menu of groups when clicked
 * instead). Two stores and two MIME types so neither gesture's drop targets
 * light up for the other's drag.
 *
 * Neither gesture lives on the row body. A native drag source suppresses the
 * click once the pointer travels a few pixels, and the row body's click is the
 * show/hide filter toggle.
 */
export const draggingCollectionId = writable<string | null>(null);

/** Custom MIME so only collection drags activate group drop targets. */
export const COLLECTION_DRAG_MIME = 'application/x-inbox-collection';

/**
 * The group row a collection is currently hovering over, or null.
 *
 * Shared rather than local to the sidebar because two different drag
 * mechanisms drive the same highlight: the native drag off a move button
 * (which reports hover through `groupDropTarget`) and svelte-dnd-action's
 * pointer drag off a reorder grip, which knows nothing about drop targets and
 * has to hit-test the cursor itself. Both end up here so a group row lights up
 * the same way whichever gesture is carrying the collection.
 */
export const collectionDragOverGroupId = writable<string | null>(null);

/**
 * A request to move a collection into a group, raised from outside the sidebar.
 *
 * Moving a collection is more than one store write: the destination group has
 * to be expanded so the result is actually visible (an empty group renders no
 * list at all, so a collection dropped into one would vanish), and the move
 * needs its toast and its Undo. `SidebarShell` owns all of that. Rather than
 * reimplement it, the Collections page posts the request here and the shell
 * performs it, so a collection dropped by grip behaves exactly like one moved
 * from the sidebar itself.
 *
 * `nonce` makes repeat requests distinguishable — moving the same collection
 * back into the same group twice is a perfectly ordinary thing to do.
 */
export type CollectionMoveRequest = {
  collectionId: string;
  groupId: string;
  nonce: number;
};

export const requestedCollectionMove = writable<CollectionMoveRequest | null>(
  null,
);

let moveNonce = 0;

/** Ask the sidebar to move `collectionId` into `groupId`. */
export function requestCollectionMove(collectionId: string, groupId: string) {
  requestedCollectionMove.set({ collectionId, groupId, nonce: ++moveNonce });
}
