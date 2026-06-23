// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaptureSheet from './CaptureSheet.svelte';

describe('CaptureSheet', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let oncapture: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    oncapture = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (component) unmount(component);
    host.remove();
  });

  it('emits oncapture with the textarea text on Save', () => {
    component = mount(CaptureSheet, {
      target: host,
      props: { oncapture, onpick: vi.fn(), onclose: vi.fn() },
    });
    flushSync();
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a thought on a call';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (host.querySelector('.save') as HTMLButtonElement).click();
    flushSync();
    expect(oncapture).toHaveBeenCalledWith('a thought on a call');
  });

  it('disables Save when empty', () => {
    component = mount(CaptureSheet, {
      target: host,
      props: { oncapture, onpick: vi.fn(), onclose: vi.fn() },
    });
    flushSync();
    expect((host.querySelector('.save') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
