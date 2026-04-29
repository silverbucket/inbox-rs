// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  canCaptureTodo,
  loadMarkdownEditorComponent,
  makeUnfiledTodo,
  shouldLoadMarkdownEditor,
  shouldShowCollectionPicker,
  shouldSubmitAddEntryForm,
} from './add-entry-modal';

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
    expect(shouldLoadMarkdownEditor('note', 'preview', false, false)).toBe(
      false,
    );
    expect(shouldLoadMarkdownEditor('bookmark', 'visual', false, false)).toBe(
      false,
    );
  });

  it('does not reload after success or failure', () => {
    expect(shouldLoadMarkdownEditor('note', 'visual', true, false)).toBe(false);
    expect(shouldLoadMarkdownEditor('note', 'visual', false, true)).toBe(false);
  });
});

describe('todo capture helpers', () => {
  it('allows todo capture with a title only', () => {
    expect(canCaptureTodo('Buy milk')).toBe(true);
    expect(canCaptureTodo('  Buy milk  ')).toBe(true);
    expect(canCaptureTodo('   ')).toBe(false);
  });

  it('creates an unfiled todo without a collection id', () => {
    const todo = makeUnfiledTodo(
      '  Write draft  ',
      new Date('2026-04-25T12:00:00.000Z'),
      'todo-1',
    );

    expect(todo).toEqual({
      id: 'todo-1',
      type: 'todo',
      title: 'Write draft',
      createdAt: '2026-04-25T12:00:00.000Z',
      completed: false,
      isTodo: true,
    });
    expect('collectionId' in todo).toBe(false);
  });
});

describe('collection picker todo capture rules', () => {
  it('hides the optional file picker for new todos when no real collections exist', () => {
    expect(shouldShowCollectionPicker(false, 'todo', false)).toBe(false);
  });

  it('shows the optional file picker for new todos when real collections exist', () => {
    expect(shouldShowCollectionPicker(false, 'todo', true)).toBe(true);
  });

  it('keeps the collection picker visible for non-todo refs', () => {
    expect(shouldShowCollectionPicker(false, 'note', false)).toBe(true);
  });
});
