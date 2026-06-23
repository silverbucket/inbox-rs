// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaptureBar from './CaptureBar.svelte';

describe('CaptureBar', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let oncapture: ReturnType<typeof vi.fn>;
  let onopeneditor: ReturnType<typeof vi.fn>;
  let onpick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    oncapture = vi.fn();
    onopeneditor = vi.fn();
    onpick = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (component) unmount(component);
    host.remove();
  });

  function typeAndKey(value: string, init: KeyboardEventInit) {
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }),
    );
    flushSync();
  }

  it('emits oncapture with the raw text on plain Enter', () => {
    component = mount(CaptureBar, {
      target: host,
      props: { oncapture, onopeneditor, onpick },
    });
    flushSync();
    typeAndKey('remember the milk', {});
    expect(oncapture).toHaveBeenCalledWith('remember the milk');
    expect(onopeneditor).not.toHaveBeenCalled();
  });

  it('emits onopeneditor on Ctrl/Cmd-Enter with the text', () => {
    component = mount(CaptureBar, {
      target: host,
      props: { oncapture, onopeneditor, onpick },
    });
    flushSync();
    typeAndKey('a longer thought', { ctrlKey: true });
    expect(onopeneditor).toHaveBeenCalledWith('a longer thought');
    expect(oncapture).not.toHaveBeenCalled();
  });

  it('ignores Enter on empty input', () => {
    component = mount(CaptureBar, {
      target: host,
      props: { oncapture, onopeneditor, onpick },
    });
    flushSync();
    typeAndKey('   ', {});
    expect(oncapture).not.toHaveBeenCalled();
  });
});
