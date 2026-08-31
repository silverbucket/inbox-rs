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
 * A separate gesture from the reorder grip: the grip runs svelte-dnd-action's
 * pointer drag to reorder within a group, while dragging the collection's own
 * row body is a native drag that moves it to whichever group it lands on. Two
 * stores and two MIME types so neither gesture's drop targets light up for the
 * other's drag.
 */
export const draggingCollectionId = writable<string | null>(null);

/** Custom MIME so only collection drags activate group drop targets. */
export const COLLECTION_DRAG_MIME = 'application/x-inbox-collection';
