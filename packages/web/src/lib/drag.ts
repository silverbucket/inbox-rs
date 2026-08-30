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
