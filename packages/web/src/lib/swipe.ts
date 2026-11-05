/**
 * Horizontal swipe recognition for touch rows (TodoRow): right completes,
 * left re-plans. Pure so it can be tested without touch events.
 */

/** Movement before a gesture is treated as a swipe rather than a tap. */
export const SWIPE_SLOP = 10;
/** Distance a swipe must travel to trigger its action on release. */
export const SWIPE_TRIGGER = 72;

export type SwipeAxis = 'pending' | 'horizontal' | 'vertical';

/** Lock the gesture to one axis once it has moved past the slop. */
export function swipeAxis(dx: number, dy: number): SwipeAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < SWIPE_SLOP && ay < SWIPE_SLOP) return 'pending';
  return ax > ay * 1.5 ? 'horizontal' : 'vertical';
}

/** What releasing a horizontal swipe at `dx` does. */
export function swipeAction(dx: number): 'complete' | 'replan' | null {
  if (dx >= SWIPE_TRIGGER) return 'complete';
  if (dx <= -SWIPE_TRIGGER) return 'replan';
  return null;
}

/** Rubber-band the row so it slows down past the trigger point. */
export function swipeOffset(dx: number): number {
  const ax = Math.abs(dx);
  if (ax <= SWIPE_TRIGGER) return dx;
  return Math.sign(dx) * (SWIPE_TRIGGER + (ax - SWIPE_TRIGGER) * 0.35);
}
