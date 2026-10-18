/**
 * Keep a reorder's last in-list slot when the pointer wanders out of the list.
 *
 * svelte-dnd-action treats the pointer leaving every drop zone as a cancel: it
 * fires a `consider` that puts the carried item back where it started, then a
 * `finalize` with that original order. For a long list that is rare, but a
 * two-row list is barely taller than the row being carried — dragging the
 * bottom todo until it sits *above* the top one carries the pointer clean out
 * of the list, and the swap "snaps back" on release.
 *
 * Nothing in the app uses "drag outside to cancel" on a plain reorder list, so
 * these zones ignore the revert and the gap stays where the user last had it.
 * The library builds the drop order from the items the zone last accepted, so
 * skipping the revert is enough for the release to land in that gap.
 *
 * Only `consider` events are filtered. `DRAGGED_LEFT` is also skipped — but
 * only while the pointer is outside everything — because it arrives right
 * after `DRAGGED_LEFT_ALL` with the gap removed; applying it would leave the
 * list with no slot for the carried item at all.
 */
import { type DndEventInfo, TRIGGERS } from 'svelte-dnd-action';

export function createDndLeaveGuard() {
  let outside = false;

  return {
    /**
     * Whether a `consider` event should be dropped on the floor. Call with
     * every consider event's `info` so the guard can track re-entry.
     */
    ignores(info: DndEventInfo): boolean {
      if (info.trigger === TRIGGERS.DRAGGED_LEFT_ALL) {
        outside = true;
        return true;
      }
      if (info.trigger === TRIGGERS.DRAGGED_LEFT) return outside;
      outside = false;
      return false;
    },
    /** Call from `finalize`: the drag is over, whatever it last reported. */
    reset() {
      outside = false;
    },
  };
}
