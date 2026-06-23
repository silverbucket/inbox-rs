// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaptureSheet from './CaptureSheet.svelte';

describe('CaptureSheet', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let oncapture: ReturnType<typeof vi.fn>;
  let onfile: ReturnType<typeof vi.fn>;
  let onrecord: ReturnType<typeof vi.fn>;
  let onclose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    oncapture = vi.fn();
    onfile = vi.fn();
    onrecord = vi.fn();
    onclose = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (component) unmount(component);
    host.remove();
  });

  function render() {
    component = mount(CaptureSheet, {
      target: host,
      props: { oncapture, onfile, onrecord, onclose },
    });
    flushSync();
  }

  it('emits oncapture with the textarea text on Save', () => {
    render();
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a thought on a call';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (host.querySelector('.save') as HTMLButtonElement).click();
    flushSync();
    expect(oncapture).toHaveBeenCalledWith('a thought on a call');
  });

  it('disables Save when empty', () => {
    render();
    expect((host.querySelector('.save') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('pressing Escape calls onclose', () => {
    render();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    flushSync();
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('the record button starts a voice memo', () => {
    render();
    (host.querySelector('.record') as HTMLButtonElement).click();
    flushSync();
    expect(onrecord).toHaveBeenCalledOnce();
  });

  it('emits onfile (and closes) when a file is chosen', () => {
    render();
    const fileInput = host.querySelector('.file-input') as HTMLInputElement;
    const file = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(onfile).toHaveBeenCalledWith(file);
    expect(onclose).toHaveBeenCalledOnce();
  });
});
