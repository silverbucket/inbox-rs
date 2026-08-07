import { tick } from 'svelte';

/**
 * Animate an item from its old list position to the position produced by an
 * update. This is a small FLIP transition that also works in masonry grids.
 */
export async function animatePriorityChange(
  element: HTMLElement | null,
  update: () => Promise<void>,
): Promise<void> {
  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  const before =
    !reduceMotion && element?.isConnected
      ? element.getBoundingClientRect()
      : null;

  await update();
  if (!before || !element?.isConnected) return;

  await tick();
  const after = element.getBoundingClientRect();
  const deltaX = before.left - after.left;
  const deltaY = before.top - after.top;
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

  element.animate(
    [
      { transform: `translate(${deltaX}px, ${deltaY}px)`, opacity: 0.88 },
      { transform: 'translate(0, 0)', opacity: 1 },
    ],
    {
      duration: 190,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    },
  );
}
