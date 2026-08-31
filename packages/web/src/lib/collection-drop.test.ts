// @vitest-environment jsdom

import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { watchCollectionPointerDrag } from './collection-drop';
import { collectionDragOverGroupId, draggingCollectionId } from './drag';

afterEach(() => {
  draggingCollectionId.set(null);
  collectionDragOverGroupId.set(null);
  document.body.innerHTML = '';
});

/** A sidebar group row, matched by the `[data-group-id]` the hit test looks for. */
function groupRow(id: string): HTMLElement {
  const group = document.createElement('div');
  group.dataset.groupId = id;
  const row = document.createElement('div');
  group.appendChild(row);
  document.body.appendChild(group);
  return row;
}

/**
 * jsdom lays nothing out, so `elementsFromPoint` is always empty. Stubbing it
 * is what lets the hit test be exercised at all — the geometry is the
 * browser's job and the e2e specs cover it; what is checked here is the
 * bookkeeping around it, which is where a leak would hide.
 */
function pointAt(...stack: Element[]) {
  document.elementsFromPoint = () => stack;
}

describe('watchCollectionPointerDrag', () => {
  it('publishes the group under the cursor', () => {
    const row = groupRow('g2');
    pointAt(row);
    const drag = watchCollectionPointerDrag('c1', { accepts: () => true });

    expect(get(draggingCollectionId)).toBe('c1');
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 5, clientY: 5 }),
    );

    expect(get(collectionDragOverGroupId)).toBe('g2');
    expect(drag.stop()).toBe('g2');
  });

  it('refuses a group the collection already lives in', () => {
    const row = groupRow('g1');
    pointAt(row);
    const drag = watchCollectionPointerDrag('c1', {
      accepts: (id) => id !== 'g1',
    });

    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 5, clientY: 5 }),
    );

    // Left unhighlighted on purpose: that absence is what says the drop would
    // do nothing.
    expect(get(collectionDragOverGroupId)).toBeNull();
    expect(drag.stop()).toBeNull();
  });

  /**
   * Only `finalize` calls `stop()`, and it never arrives if the component
   * unmounts mid-drag — which the Collections page can do simply by being
   * navigated away from. Left running, the listener stays attached and every
   * group row keeps its drop outline for the rest of the session.
   */
  it('releases its listeners and shared state when stopped', () => {
    const row = groupRow('g2');
    pointAt(row);
    const drag = watchCollectionPointerDrag('c1', { accepts: () => true });
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 5, clientY: 5 }),
    );

    drag.stop();

    expect(get(draggingCollectionId)).toBeNull();
    expect(get(collectionDragOverGroupId)).toBeNull();

    // A move after teardown must not resurrect either store.
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 5, clientY: 5 }),
    );
    expect(get(draggingCollectionId)).toBeNull();
    expect(get(collectionDragOverGroupId)).toBeNull();
  });
});
