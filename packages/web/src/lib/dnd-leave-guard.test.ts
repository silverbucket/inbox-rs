import { SOURCES, TRIGGERS } from 'svelte-dnd-action';
import { describe, expect, it } from 'vitest';

import { createDndLeaveGuard } from './dnd-leave-guard';

const info = (trigger: TRIGGERS) => ({
  trigger,
  id: 'todo-1',
  source: SOURCES.POINTER,
});

describe('createDndLeaveGuard', () => {
  it('lets ordinary in-zone events through', () => {
    const guard = createDndLeaveGuard();
    expect(guard.ignores(info(TRIGGERS.DRAG_STARTED))).toBe(false);
    expect(guard.ignores(info(TRIGGERS.DRAGGED_OVER_INDEX))).toBe(false);
    expect(guard.ignores(info(TRIGGERS.DRAGGED_ENTERED))).toBe(false);
  });

  it('ignores the revert and the gap removal once the pointer leaves everything', () => {
    const guard = createDndLeaveGuard();
    guard.ignores(info(TRIGGERS.DRAGGED_OVER_INDEX));
    expect(guard.ignores(info(TRIGGERS.DRAGGED_LEFT_ALL))).toBe(true);
    expect(guard.ignores(info(TRIGGERS.DRAGGED_LEFT))).toBe(true);
  });

  it('applies DRAGGED_LEFT when the pointer only moved to another zone', () => {
    const guard = createDndLeaveGuard();
    expect(guard.ignores(info(TRIGGERS.DRAGGED_LEFT))).toBe(false);
  });

  it('resumes applying events when the pointer comes back in', () => {
    const guard = createDndLeaveGuard();
    guard.ignores(info(TRIGGERS.DRAGGED_LEFT_ALL));
    expect(guard.ignores(info(TRIGGERS.DRAGGED_ENTERED))).toBe(false);
    expect(guard.ignores(info(TRIGGERS.DRAGGED_LEFT))).toBe(false);
  });

  it('forgets the outside state on reset', () => {
    const guard = createDndLeaveGuard();
    guard.ignores(info(TRIGGERS.DRAGGED_LEFT_ALL));
    guard.reset();
    expect(guard.ignores(info(TRIGGERS.DRAGGED_LEFT))).toBe(false);
  });
});
