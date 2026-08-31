/**
 * Svelte actions for the sidebar's two native drag gestures:
 *
 * - `collectionDropTarget` — an inbox item picked up from a card or a todo row
 *   and dropped onto a collection, filing it there.
 * - `groupDropTarget` — a collection picked up by its move button and dropped
 *   onto a group, moving it into that group.
 *
 * Both share one implementation because three things here are load-bearing and
 * were each, at some point, the reason drag-and-drop didn't work for real mouse
 * users:
 *
 * 1. **`dragenter` and `dragover` must both be cancelled.** HTML5 only fires
 *    `drop` when the most recent `dragover` over the current target called
 *    `preventDefault()`. Cancel one but not the other and the browser ends the
 *    gesture with `dragleave` + `dragend` and no `drop` — the drag silently
 *    does nothing.
 *
 * 2. **`dragleave` fires when the pointer crosses onto a descendant.** Treating
 *    that as "the pointer left" clears the hover state, which reverts the hover
 *    style; if that style affects layout, the subtree under the cursor moves and
 *    fires another enter/leave pair, and the target oscillates. Release during
 *    the wrong half of that oscillation and Chrome cancels the drag. So a leave
 *    is only real when `relatedTarget` is outside the node.
 *
 * 3. **Attach to the outermost element of a row, not an inner button.** Every
 *    pixel a user aims at should accept the drop, including grips and icon
 *    buttons sharing the row. Callers should also make the row's children
 *    pointer-transparent for the duration of the drag so events can't retarget
 *    mid-gesture — see the `.filing` rules in `SidebarShell`.
 */

import type { Writable } from 'svelte/store';
import { get } from 'svelte/store';
import {
  COLLECTION_DRAG_MIME,
  DRAG_MIME,
  draggingCollectionId,
  draggingItemId,
} from './drag';

export type DropTargetOptions = {
  /** Receives the dragged id when a matching drag is dropped here. */
  ondrop: (draggedId: string) => void;
  /** Hover feedback. Called with `true` on enter, `false` on real leave/drop. */
  onhover?: (isOver: boolean) => void;
  /** When false the target ignores drags entirely. */
  enabled?: boolean;
};

function makeDropTarget(
  node: HTMLElement,
  mime: string,
  activeDrag: Writable<string | null>,
  options: DropTargetOptions,
) {
  let current = options;

  /**
   * Whether this drag is the kind we accept.
   *
   * `dataTransfer.getData` is blocked during dragover for security, but `types`
   * is readable — that's what makes a custom MIME usable as the discriminator.
   * The store is a fallback for the same-document case.
   */
  function matches(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (types && Array.from(types).includes(mime)) return true;
    return get(activeDrag) !== null;
  }

  function accept(e: DragEvent) {
    if (current.enabled === false || !matches(e)) return;
    // Both dragenter and dragover route here — see rule 1 above.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    current.onhover?.(true);
  }

  function leave(e: DragEvent) {
    const next = e.relatedTarget;
    if (next instanceof Node && node.contains(next)) return;
    current.onhover?.(false);
  }

  function drop(e: DragEvent) {
    if (current.enabled === false || !matches(e)) return;
    e.preventDefault();
    current.onhover?.(false);
    const draggedId = e.dataTransfer?.getData(mime) ?? '';
    if (draggedId) current.ondrop(draggedId);
  }

  node.addEventListener('dragenter', accept);
  node.addEventListener('dragover', accept);
  node.addEventListener('dragleave', leave);
  node.addEventListener('drop', drop);

  return {
    update(next: DropTargetOptions) {
      current = next;
    },
    destroy() {
      node.removeEventListener('dragenter', accept);
      node.removeEventListener('dragover', accept);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    },
  };
}

/** Accept an inbox item dropped here, to file it into a collection. */
export function collectionDropTarget(
  node: HTMLElement,
  options: DropTargetOptions,
) {
  return makeDropTarget(node, DRAG_MIME, draggingItemId, options);
}

/** Accept a collection dropped here, to move it into a group. */
export function groupDropTarget(node: HTMLElement, options: DropTargetOptions) {
  return makeDropTarget(
    node,
    COLLECTION_DRAG_MIME,
    draggingCollectionId,
    options,
  );
}

/**
 * Start a native drag carrying `id` under `mime`.
 *
 * The `stopPropagation` is essential, not defensive. svelte-dnd-action's
 * `styleDraggable` puts `ondragstart = () => false` on every direct child of a
 * drop zone, and returning false from an event-handler IDL attribute cancels
 * the event. Sidebar rows are zone children, so an un-stopped dragstart from
 * inside one is cancelled the instant it bubbles up — the payload gets set and
 * then thrown away, with no drag following.
 */
export function startNativeDrag(
  e: DragEvent,
  { mime, id, label }: { mime: string; id: string; label: string },
): boolean {
  if (!e.dataTransfer) return false;
  e.stopPropagation();
  e.dataTransfer.setData(mime, id);
  e.dataTransfer.setData('text/plain', label);
  e.dataTransfer.effectAllowed = 'move';
  return true;
}
