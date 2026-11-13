// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installBackdropPressGuard,
  isStrayBackdropClick,
} from './backdrop-press';

/** overlay(fixed) > modal > input, plus a button inside the modal. */
function buildModal() {
  document.body.innerHTML = `
    <div id="overlay" style="position: fixed">
      <div id="modal">
        <input id="title" />
        <button id="save"><span id="icon"></span></button>
      </div>
    </div>
    <div id="page"><p id="text"></p></div>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    overlay: get('overlay'),
    modal: get('modal'),
    title: get('title'),
    save: get('save'),
    icon: get('icon'),
    page: get('page'),
    text: get('text'),
  };
}

function mouse(type: string, el: Element, detail = 1) {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, detail }),
  );
}

describe('isStrayBackdropClick', () => {
  it('flags a press inside the modal released on the backdrop', () => {
    const { overlay, title } = buildModal();
    expect(isStrayBackdropClick(title, overlay, overlay)).toBe(true);
  });

  it('flags a press on the backdrop released inside the modal', () => {
    const { overlay, title } = buildModal();
    expect(isStrayBackdropClick(overlay, title, overlay)).toBe(true);
  });

  it('lets a press and release on the backdrop itself through', () => {
    const { overlay } = buildModal();
    expect(isStrayBackdropClick(overlay, overlay, overlay)).toBe(false);
  });

  it('lets a click with no press through (keyboard, element.click())', () => {
    const { overlay } = buildModal();
    expect(isStrayBackdropClick(null, null, overlay)).toBe(false);
  });

  it('leaves ordinary page content alone', () => {
    const { page, text } = buildModal();
    expect(isStrayBackdropClick(text, page, page)).toBe(false);
  });

  it('leaves a control alone even when it is a fixed layer', () => {
    const { save, icon } = buildModal();
    save.style.position = 'fixed';
    expect(isStrayBackdropClick(icon, save, save)).toBe(false);
  });
});

describe('installBackdropPressGuard', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installBackdropPressGuard();
  });
  afterEach(() => uninstall());

  it('swallows the click from a drag that ends on the backdrop', () => {
    const { overlay, title } = buildModal();
    const close = vi.fn();
    overlay.addEventListener('click', close);

    mouse('mousedown', title);
    mouse('mouseup', overlay);
    mouse('click', overlay);

    expect(close).not.toHaveBeenCalled();
  });

  it('still closes on a real backdrop click', () => {
    const { overlay } = buildModal();
    const close = vi.fn();
    overlay.addEventListener('click', close);

    mouse('mousedown', overlay);
    mouse('mouseup', overlay);
    mouse('click', overlay);

    expect(close).toHaveBeenCalledOnce();
  });

  it('does not let one stray drag swallow the next real click', () => {
    const { overlay, title } = buildModal();
    const close = vi.fn();
    overlay.addEventListener('click', close);

    mouse('mousedown', title);
    mouse('mouseup', overlay);
    mouse('click', overlay);
    mouse('mousedown', overlay);
    mouse('mouseup', overlay);
    mouse('click', overlay);

    expect(close).toHaveBeenCalledOnce();
  });

  it('lets a scripted click through after an unfinished drag', () => {
    const { overlay, title } = buildModal();
    const close = vi.fn();
    overlay.addEventListener('click', close);

    // Released outside the window: no mouseup, no click.
    mouse('mousedown', title);
    overlay.click();

    expect(close).toHaveBeenCalledOnce();
  });

  it('stops listening once uninstalled', () => {
    const { overlay, title } = buildModal();
    const close = vi.fn();
    overlay.addEventListener('click', close);
    uninstall();

    mouse('mousedown', title);
    mouse('mouseup', overlay);
    mouse('click', overlay);

    expect(close).toHaveBeenCalledOnce();
  });
});
