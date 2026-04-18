// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadMarkdownEditorComponent, shouldLoadMarkdownEditor, shouldSubmitAddEntryForm } from './add-entry-modal';

describe('shouldSubmitAddEntryForm', () => {
  it('submits from text-like inputs including bookmark url fields', () => {
    const urlInput = document.createElement('input');
    urlInput.type = 'url';

    const textInput = document.createElement('input');
    textInput.type = 'text';

    expect(shouldSubmitAddEntryForm('Enter', urlInput, true)).toBe(true);
    expect(shouldSubmitAddEntryForm('Enter', textInput, true)).toBe(true);
  });

  it('does not submit from textarea or tiptap editor content', () => {
    const textarea = document.createElement('textarea');
    const tiptap = document.createElement('div');
    tiptap.className = 'tiptap-editor';
    const nested = document.createElement('p');
    tiptap.appendChild(nested);

    expect(shouldSubmitAddEntryForm('Enter', textarea, true)).toBe(false);
    expect(shouldSubmitAddEntryForm('Enter', nested, true)).toBe(false);
  });

  it('does not submit when disabled or for unsupported input types', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';

    expect(shouldSubmitAddEntryForm('Enter', fileInput, true)).toBe(false);
    expect(shouldSubmitAddEntryForm('Escape', fileInput, true)).toBe(false);
    expect(shouldSubmitAddEntryForm('Enter', fileInput, false)).toBe(false);
  });
});

describe('loadMarkdownEditorComponent', () => {
  it('loads the markdown editor on demand', async () => {
    const component = await loadMarkdownEditorComponent();
    expect(component).toBeTruthy();
  });
});

describe('shouldLoadMarkdownEditor', () => {
  it('loads only for note visual mode', () => {
    expect(shouldLoadMarkdownEditor('note', 'visual', false, false)).toBe(true);
    expect(shouldLoadMarkdownEditor('note', 'write', false, false)).toBe(false);
    expect(shouldLoadMarkdownEditor('note', 'preview', false, false)).toBe(false);
    expect(shouldLoadMarkdownEditor('bookmark', 'visual', false, false)).toBe(false);
  });

  it('does not reload after success or failure', () => {
    expect(shouldLoadMarkdownEditor('note', 'visual', true, false)).toBe(false);
    expect(shouldLoadMarkdownEditor('note', 'visual', false, true)).toBe(false);
  });
});
