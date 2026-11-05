import { describe, expect, it } from 'vitest';
import { SWIPE_TRIGGER, swipeAction, swipeAxis, swipeOffset } from './swipe';

describe('swipe', () => {
  it('waits for the slop, then locks to the dominant axis', () => {
    expect(swipeAxis(4, 3)).toBe('pending');
    expect(swipeAxis(30, 5)).toBe('horizontal');
    expect(swipeAxis(-30, 5)).toBe('horizontal');
    expect(swipeAxis(12, 20)).toBe('vertical');
    // Diagonal drags scroll rather than swipe.
    expect(swipeAxis(20, 18)).toBe('vertical');
  });

  it('completes on a right swipe and re-plans on a left one', () => {
    expect(swipeAction(SWIPE_TRIGGER)).toBe('complete');
    expect(swipeAction(-SWIPE_TRIGGER - 1)).toBe('replan');
    expect(swipeAction(SWIPE_TRIGGER - 1)).toBeNull();
    expect(swipeAction(0)).toBeNull();
  });

  it('slows the row down past the trigger point', () => {
    expect(swipeOffset(40)).toBe(40);
    expect(swipeOffset(SWIPE_TRIGGER + 100)).toBeLessThan(SWIPE_TRIGGER + 100);
    expect(swipeOffset(-(SWIPE_TRIGGER + 100))).toBeGreaterThan(
      -(SWIPE_TRIGGER + 100),
    );
  });
});
