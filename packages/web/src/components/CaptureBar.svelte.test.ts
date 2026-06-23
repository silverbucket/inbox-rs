// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaptureBar from './CaptureBar.svelte';

describe('CaptureBar', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let oncapture: ReturnType<typeof vi.fn>;
  let onopeneditor: ReturnType<typeof vi.fn>;
  let onfile: ReturnType<typeof vi.fn>;
  let onrecord: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    oncapture = vi.fn();
    onopeneditor = vi.fn();
    onfile = vi.fn();
    onrecord = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (component) unmount(component);
    host.remove();
  });

  function render() {
    component = mount(CaptureBar, {
      target: host,
      props: { oncapture, onopeneditor, onfile, onrecord },
    });
    flushSync();
  }

  function typeAndKey(value: string, init: KeyboardEventInit) {
    const input = host.querySelector('.text-input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }),
    );
    flushSync();
  }

  it('emits oncapture with the raw text on plain Enter', () => {
    render();
    typeAndKey('remember the milk', {});
    expect(oncapture).toHaveBeenCalledWith('remember the milk');
    expect(onopeneditor).not.toHaveBeenCalled();
  });

  it('emits onopeneditor on Ctrl/Cmd-Enter with the text', () => {
    render();
    typeAndKey('a longer thought', { ctrlKey: true });
    expect(onopeneditor).toHaveBeenCalledWith('a longer thought');
    expect(oncapture).not.toHaveBeenCalled();
  });

  it('ignores Enter on empty input', () => {
    render();
    typeAndKey('   ', {});
    expect(oncapture).not.toHaveBeenCalled();
  });

  it('the mic button records a voice memo', () => {
    render();
    (host.querySelector('.mic') as HTMLButtonElement).click();
    flushSync();
    expect(onrecord).toHaveBeenCalledOnce();
  });

  it('emits onfile with the chosen file when one is picked', () => {
    render();
    const fileInput = host.querySelector('.file-input') as HTMLInputElement;
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    // jsdom file inputs are read-only; define the FileList for the test.
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(onfile).toHaveBeenCalledWith(file);
  });
});
