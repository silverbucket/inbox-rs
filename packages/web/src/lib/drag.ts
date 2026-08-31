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
