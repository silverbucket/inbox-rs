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
  let onfilecapture: ReturnType<typeof vi.fn>;
  let onextrafiles: ReturnType<typeof vi.fn>;
  let onrecord: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    oncapture = vi.fn();
    onopeneditor = vi.fn();
    onfile = vi.fn();
    onfilecapture = vi.fn();
    onextrafiles = vi.fn();
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
      props: {
        oncapture,
        onopeneditor,
        onfile,
        onfilecapture,
        onextrafiles,
        onrecord,
      },
    });
    flushSync();
  }

  function type(value: string) {
    const input = host.querySelector('.text-input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  function key(init: KeyboardEventInit) {
    const input = host.querySelector('.text-input') as HTMLInputElement;
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }),
    );
    flushSync();
  }

  function typeAndKey(value: string, init: KeyboardEventInit) {
    type(value);
    key(init);
  }

  /** Build a DataTransfer-like stub carrying files — jsdom has no real one. */
  function fileTransfer(files: File[]) {
    return { types: ['Files'], files } as unknown as DataTransfer;
  }

  function dropFiles(files: File[]) {
    const bar = host.querySelector('.bar') as HTMLElement;
    const e = new Event('drop', { bubbles: true }) as DragEvent;
    Object.defineProperty(e, 'dataTransfer', { value: fileTransfer(files) });
    bar.dispatchEvent(e);
    flushSync();
  }

  it('emits oncapture with the raw text on plain Enter', () => {
    render();
    typeAndKey('remember the milk', {});
    expect(oncapture).toHaveBeenCalledWith('remember the milk');
    expect(onopeneditor).not.toHaveBeenCalled();
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Command', { metaKey: true }],
  ] satisfies [
    string,
    KeyboardEventInit,
  ][])('emits onopeneditor on %s-Enter with the text', (_modifier, keys) => {
    render();
    typeAndKey('a longer thought', keys);
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

  it('stages a dropped file as a chip without capturing it yet', () => {
    render();
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    dropFiles([file]);
    const chip = host.querySelector('.chip-name');
    expect(chip?.textContent).toBe('photo.png');
    // Nothing stored until the user confirms.
    expect(onfilecapture).not.toHaveBeenCalled();
  });

  it('focuses the input after a drop so Enter/Escape and captions work', () => {
    render();
    dropFiles([new File(['x'], 'photo.png', { type: 'image/png' })]);
    expect(document.activeElement).toBe(host.querySelector('.text-input'));
  });

  it('Enter confirms a staged file with the typed caption', () => {
    render();
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    dropFiles([file]);
    typeAndKey('a nice sunset', {});
    expect(onfilecapture).toHaveBeenCalledWith(file, 'a nice sunset');
    // The chip and text clear after confirming.
    expect(host.querySelector('.chip')).toBeNull();
    expect((host.querySelector('.text-input') as HTMLInputElement).value).toBe(
      '',
    );
    // A staged file must not also fire a text capture.
    expect(oncapture).not.toHaveBeenCalled();
  });

  it('Escape discards a staged file without capturing', () => {
    render();
    dropFiles([new File(['x'], 'photo.png', { type: 'image/png' })]);
    key({ key: 'Escape' });
    expect(host.querySelector('.chip')).toBeNull();
    expect(onfilecapture).not.toHaveBeenCalled();
  });

  it('the chip ✕ button discards the staged file', () => {
    render();
    dropFiles([new File(['x'], 'photo.png', { type: 'image/png' })]);
    (host.querySelector('.chip-remove') as HTMLButtonElement).click();
    flushSync();
    expect(host.querySelector('.chip')).toBeNull();
    expect(onfilecapture).not.toHaveBeenCalled();
  });

  it('reports extra files when several are dropped, staging only the first', () => {
    render();
    dropFiles([
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
      new File(['c'], 'c.png', { type: 'image/png' }),
    ]);
    expect((host.querySelector('.chip-name') as HTMLElement).textContent).toBe(
      'a.png',
    );
    expect(onextrafiles).toHaveBeenCalledWith(2);
  });

  it('pasting an image stages it; a staged file takes precedence over text', () => {
    render();
    type('existing text');
    const input = host.querySelector('.text-input') as HTMLInputElement;
    const file = new File(['x'], 'clip.png', { type: 'image/png' });
    const e = new Event('paste', { bubbles: true }) as ClipboardEvent;
    Object.defineProperty(e, 'clipboardData', { value: { files: [file] } });
    input.dispatchEvent(e);
    flushSync();
    expect(host.querySelector('.chip-name')?.textContent).toBe('clip.png');
    // Enter now confirms the image, using the pre-existing text as the caption.
    key({});
    expect(onfilecapture).toHaveBeenCalledWith(file, 'existing text');
    expect(oncapture).not.toHaveBeenCalled();
  });

  it('ignores a paste with no image (leaves text capture intact)', () => {
    render();
    const input = host.querySelector('.text-input') as HTMLInputElement;
    const e = new Event('paste', { bubbles: true }) as ClipboardEvent;
    Object.defineProperty(e, 'clipboardData', { value: { files: [] } });
    input.dispatchEvent(e);
    flushSync();
    expect(host.querySelector('.chip')).toBeNull();
    typeAndKey('just text', {});
    expect(oncapture).toHaveBeenCalledWith('just text');
  });
});
