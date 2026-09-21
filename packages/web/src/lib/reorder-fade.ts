/**
 * A `fade` for rows inside a svelte-dnd-action zone that goes instant while a
 * reorder is in flight.
 *
 * Picking a row up re-keys it (the library swaps its id for a placeholder id,
 * and swaps it back on drop), so a keyed `{#each}` destroys the row and creates
 * a new one — running its outro and intro. A plain `out:fade` keeps the
 * outgoing copy in the DOM for the length of the fade, and the library finds
 * the row it is carrying by *child index*. One extra child shifts every index:
 * a neighbour gets hidden as the drop gap instead, and on drop the wrong
 * element is un-hidden, leaving the dropped row `visibility: hidden` — a gap
 * where the todo should have shown up.
 *
 * Svelte finishes a zero-duration transition synchronously, so with the fade
 * switched off for the drag the zone's children always match its items, while
 * rows that are genuinely added or removed still fade.
 */
import { tick } from 'svelte';
import {
  type FadeParams,
  fade,
  type TransitionConfig,
} from 'svelte/transition';

export function createReorderFade() {
  let reordering = false;

  return {
    fade(node: Element, params?: FadeParams): TransitionConfig {
      return fade(node, reordering ? { duration: 0 } : params);
    },
    /** Call from `onconsider`, before handing the items back to the zone. */
    start() {
      reordering = true;
    },
    /**
     * Call from `onfinalize`, after handing the items back: the drop re-keys
     * the row once more, so stay instant until that render has flushed.
     */
    async end() {
      await tick();
      reordering = false;
    },
  };
}
