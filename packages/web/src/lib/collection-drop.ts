/**
 * Svelte action making an element accept a filing drag — an inbox item picked
 * up from a card or a todo row and dropped onto a collection.
 *
 * Two things here are load-bearing and were the cause of drag-to-file being
 * unreliable for real mouse users:
 *
 * 1. **`dragenter` and `dragover` must both be cancelled.** HTML5 only fires
 *    `drop` when the most recent `dragover` over the current target called
 *    `preventDefault()`. Cancel one but not the other and the browser ends the
 *    gesture with `dragleave` + `dragend` and no `drop` — the item silently
 *    stays put.
 *
 * 2. **`dragleave` fires when the pointer crosses onto a descendant.** Treating
 *    that as "the pointer left" clears the hover state, which reverts the hover
 *    style; if that style affects layout, the subtree under the cursor moves and
 *    fires another enter/leave pair, and the target oscillates. Release during
 *    the wrong half of that oscillation and Chrome cancels the drag. So leave is
 *    only real when `relatedTarget` is outside the node.
 *
 * Attaching this to the *outermost* element of a row (rather than an inner
 * button) is deliberate: every pixel a user aims at should accept the drop,
 * including any grips or icon buttons sharing the row.
 */

import { get } from 'svelte/store';
import { DRAG_MIME, draggingItemId } from './drag';

export type CollectionDropTargetOptions = {
  /** Receives the dragged item id when a filing drag is dropped here. */
  onfile: (itemId: string) => void;
  /** Hover feedback. Called with `true` on enter, `false` on real leave/drop. */
  onhover?: (isOver: boolean) => void;
  /** When false the target ignores drags entirely (e.g. a readonly view). */
  enabled?: boolean;
};

/**
 * Whether this drag is one of ours.
 *
 * `dataTransfer.getData` is blocked during dragover for security, but `types`
 * is readable — that's what makes a custom MIME usable as the discriminator.
 * The store is a fallback for the same-document case.
 */
function isFilingDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (types && Array.from(types).includes(DRAG_MIME)) return true;
  return get(draggingItemId) !== null;
}

export function collectionDropTarget(
  node: HTMLElement,
  options: CollectionDropTargetOptions,
) {
  let current = options;

  function accept(e: DragEvent) {
    if (current.enabled === false || !isFilingDrag(e)) return;
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
    if (current.enabled === false || !isFilingDrag(e)) return;
    e.preventDefault();
    current.onhover?.(false);
    const itemId = e.dataTransfer?.getData(DRAG_MIME) ?? '';
    if (itemId) current.onfile(itemId);
  }

  node.addEventListener('dragenter', accept);
  node.addEventListener('dragover', accept);
  node.addEventListener('dragleave', leave);
  node.addEventListener('drop', drop);

  return {
    update(next: CollectionDropTargetOptions) {
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
