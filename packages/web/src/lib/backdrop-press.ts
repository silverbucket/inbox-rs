/**
 * Keep a drag that strays onto a modal's backdrop from closing the modal.
 *
 * Every modal here closes when its dimmed backdrop is clicked. But the
 * browser also fires `click` when a press and its release land on different
 * elements — on their nearest common ancestor. Select the text in a modal's
 * title field, overshoot the edge of the modal before letting go, and that
 * ancestor is the backdrop: the modal closes mid-edit and takes the typing
 * with it. The same happens when a press on a button is dragged off to
 * cancel it, or when a press on the backdrop is released inside the modal.
 *
 * A backdrop click only means "dismiss" when the press began and ended on
 * the backdrop itself. This guard watches from the window's capture phase
 * and swallows the ones that didn't, so it covers every modal — including
 * ones written later — without each having to remember the check.
 *
 * "Backdrop" is recognised by what it is rather than by a class name: a
 * `position: fixed` layer that isn't itself a control.
 */

/** A click on (or inside) one of these is a real activation, never a stray. */
const CONTROL =
  'button, a[href], label, summary, input, select, textarea, [role="button"]';

function isFixedLayer(el: Element): boolean {
  return getComputedStyle(el).position === 'fixed';
}

/**
 * True when a click on `target` came from a press or release somewhere else
 * and `target` is a backdrop layer — i.e. the user was dragging, not
 * dismissing. `press`/`release` are the mousedown/mouseup targets, or null
 * when the click had none (keyboard, `element.click()`).
 */
export function isStrayBackdropClick(
  press: EventTarget | null,
  release: EventTarget | null,
  target: EventTarget | null,
  isLayer: (el: Element) => boolean = isFixedLayer,
): boolean {
  if (!(target instanceof Element)) return false;
  if (press === null && release === null) return false;
  if (press === target && release === target) return false;
  if (target.closest(CONTROL)) return false;
  return isLayer(target);
}

export function installBackdropPressGuard(win: Window = window): () => void {
  let press: EventTarget | null = null;
  let release: EventTarget | null = null;

  const onDown = (e: MouseEvent) => {
    press = e.target;
    release = null;
  };
  const onUp = (e: MouseEvent) => {
    release = e.target;
  };
  const onClick = (e: MouseEvent) => {
    // detail 0 is a keyboard or scripted click: no press to have strayed.
    const stray =
      e.detail !== 0 && isStrayBackdropClick(press, release, e.target);
    press = null;
    release = null;
    if (stray) e.stopPropagation();
  };

  win.addEventListener('mousedown', onDown, true);
  win.addEventListener('mouseup', onUp, true);
  win.addEventListener('click', onClick, true);
  return () => {
    win.removeEventListener('mousedown', onDown, true);
    win.removeEventListener('mouseup', onUp, true);
    win.removeEventListener('click', onClick, true);
  };
}
