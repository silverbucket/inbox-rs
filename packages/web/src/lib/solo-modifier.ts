/**
 * The "solo" modifier for group filters — ⌘ on macOS, Ctrl elsewhere.
 *
 * Held down, it turns a click on a group pill or sidebar row from "toggle this
 * group" into "show only this group". The shells subscribe to `soloModifierHeld`
 * to surface a hint while the key is down, and call `isSoloModifier(event)` in
 * the click handler to pick the gesture.
 *
 * Ctrl is deliberately NOT the modifier on macOS: Ctrl-click there is a
 * right-click synonym and fires `contextmenu`, so binding it would make the
 * gesture collide with the OS.
 */

import { readable } from 'svelte/store';
import { isMac, modLabel } from './platform';

/** True when this event carries the platform's solo modifier. */
export function isSoloModifier(event: MouseEvent | KeyboardEvent): boolean {
  return isMac() ? event.metaKey : event.ctrlKey;
}

/** e.g. "⌘-click to show only this group" — for hints and tooltips. */
export const soloHint = `${modLabel()}-click to show only that group`;

/**
 * True while the solo modifier is held.
 *
 * Tracked off `keydown`/`keyup` rather than a plain keycode check so a chord
 * released outside the page still clears. `blur` and `visibilitychange` are the
 * belt-and-braces cases: ⌘-Tab away and the `keyup` never arrives, which would
 * otherwise leave every pill stuck advertising a gesture the user isn't making.
 */
export const soloModifierHeld = readable(false, (set) => {
  if (typeof window === 'undefined') return;

  const sync = (event: KeyboardEvent) => set(isSoloModifier(event));
  const clear = () => set(false);

  window.addEventListener('keydown', sync);
  window.addEventListener('keyup', sync);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);

  return () => {
    window.removeEventListener('keydown', sync);
    window.removeEventListener('keyup', sync);
    window.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', clear);
  };
});
