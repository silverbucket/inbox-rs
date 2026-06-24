import type { InboxItem, NoteItem, TodoItem } from '@inbox-rs/rs-module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { storeItem } = vi.hoisted(() => {
  return {
    storeItem: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('./stores', () => ({ storeItem }));

import {
  makeReference,
  makeTodo,
  TYPE_ICON_PATHS,
  todoNote,
  typeBadge,
  typeIconPath,
} from './item-utils';

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// typeIconPath
// ---------------------------------------------------------------------------

describe('typeIconPath', () => {
  it('returns SVG path markup for each known type', () => {
    const knownTypes = Object.keys(TYPE_ICON_PATHS) as Array<
      keyof typeof TYPE_ICON_PATHS
    >;
    for (const type of knownTypes) {
      const result = typeIconPath(type);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      // Sanity: verify it matches the lookup table directly.
      expect(result).toBe(TYPE_ICON_PATHS[type]);
    }
  });

  it('returns todo polyline markup for type "todo"', () => {
    expect(typeIconPath('todo')).toBe('<polyline points="20 6 9 17 4 12"/>');
  });

  it('returns empty string for an unknown type', () => {
    // Cast required because TypeScript's type system prevents passing an
    // invalid literal, but runtime callers can still pass unknown strings.
    expect(typeIconPath('unknown' as Parameters<typeof typeIconPath>[0])).toBe(
      '',
    );
  });
});

// ---------------------------------------------------------------------------
// typeBadge
// ---------------------------------------------------------------------------

describe('typeBadge', () => {
  it('returns null for a todo item', () => {
    const item: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Buy milk',
      completed: false,
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(typeBadge(item)).toBeNull();
  });

  it('returns the type string for a bookmark item', () => {
    const item: InboxItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'Example',
      url: 'https://example.com',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(typeBadge(item)).toBe('bookmark');
  });

  it('returns the type string for a note item', () => {
    const item: NoteItem = {
      id: 'note-1',
      type: 'note',
      title: 'My note',
      body: 'content',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(typeBadge(item)).toBe('note');
  });
});

// ---------------------------------------------------------------------------
// todoNote
// ---------------------------------------------------------------------------

describe('todoNote', () => {
  it('returns null when the item has no notes, description, or body', () => {
    const item: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Simple todo',
      completed: false,
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(todoNote(item)).toBeNull();
  });

  it('returns the first line of description when present', () => {
    const item: InboxItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'Link',
      url: 'https://example.com',
      description: 'First line\nSecond line\nThird line',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(todoNote(item)).toBe('First line');
  });

  it('trims whitespace from the first line', () => {
    const item: InboxItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'Link',
      url: 'https://example.com',
      description: '   trimmed   \nother line',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(todoNote(item)).toBe('trimmed');
  });

  it('truncates first lines longer than 80 characters with an ellipsis', () => {
    const longLine = 'x'.repeat(90);
    const item: InboxItem = {
      id: 'note-1',
      type: 'note',
      title: 'Note',
      body: longLine,
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    const result = todoNote(item);
    expect(result).toBe(`${'x'.repeat(80)}...`);
    expect(result?.length).toBe(83); // 80 chars + '...'
  });

  it('does not truncate a first line of exactly 80 characters', () => {
    const eightyChars = 'a'.repeat(80);
    const item: NoteItem = {
      id: 'note-1',
      type: 'note',
      title: 'Note',
      body: eightyChars,
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(todoNote(item)).toBe(eightyChars);
  });

  it('falls back to body when description is absent', () => {
    const item: NoteItem = {
      id: 'note-1',
      type: 'note',
      title: 'Note',
      body: 'Body content',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(todoNote(item)).toBe('Body content');
  });

  it('returns null when description is empty string', () => {
    const item: InboxItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'Link',
      url: 'https://example.com',
      description: '',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(todoNote(item)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// makeTodo
// ---------------------------------------------------------------------------

describe('makeTodo', () => {
  it('calls storeItem with isTodo:true and completed:false', async () => {
    const item: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Buy milk',
      completed: true,
      completedAt: '2026-04-01T00:00:00.000Z',
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    await makeTodo(item);

    expect(storeItem).toHaveBeenCalledOnce();
    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect(stored.isTodo).toBe(true);
    expect(stored.completed).toBe(false);
  });

  it('drops completedAt from the stored item', async () => {
    const item: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Buy milk',
      completed: true,
      completedAt: '2026-04-01T00:00:00.000Z',
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    await makeTodo(item);

    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect('completedAt' in stored).toBe(false);
  });

  it('preserves other item fields (id, type, title)', async () => {
    const item: TodoItem = {
      id: 'todo-42',
      type: 'todo',
      title: 'My task',
      completed: false,
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    await makeTodo(item);

    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect(stored.id).toBe('todo-42');
    expect(stored.type).toBe('todo');
    expect(stored.title).toBe('My task');
  });
});

// ---------------------------------------------------------------------------
// makeReference
// ---------------------------------------------------------------------------

describe('makeReference', () => {
  it('drops isTodo, completed, and completedAt from a todo item', async () => {
    const item: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'A task',
      completed: true,
      completedAt: '2026-04-01T00:00:00.000Z',
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    await makeReference(item);

    expect(storeItem).toHaveBeenCalledOnce();
    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect('isTodo' in stored).toBe(false);
    expect('completed' in stored).toBe(false);
    expect('completedAt' in stored).toBe(false);
  });

  it('rewrites type from "todo" to "note" and moves description→body', async () => {
    const item: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'A task',
      description: 'Some context',
      completed: false,
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    await makeReference(item);

    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect(stored.type).toBe('note');
    expect(stored.body).toBe('Some context');
    expect('description' in stored).toBe(false);
  });

  it('does not overwrite an existing body when rewiring a todo to a note', async () => {
    // If body is already set (e.g. from the todo's body field), description
    // should NOT clobber it.
    const item = {
      id: 'todo-1',
      type: 'todo',
      title: 'A task',
      body: 'Original body',
      description: 'Should not overwrite',
      completed: false,
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    } as unknown as InboxItem;

    await makeReference(item);

    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect(stored.type).toBe('note');
    expect(stored.body).toBe('Original body');
  });

  it('sets body to empty string when todo has no description and no body', async () => {
    const item: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Bare task',
      completed: false,
      isTodo: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    await makeReference(item);

    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect(stored.type).toBe('note');
    expect(stored.body).toBe('');
  });

  it('does not change the type of a non-todo item (e.g. note)', async () => {
    const item: NoteItem = {
      id: 'note-1',
      type: 'note',
      title: 'Reference note',
      body: 'Content',
      isTodo: true,
      completed: false,
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    await makeReference(item);

    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect(stored.type).toBe('note');
    // body should remain untouched since type was not 'todo'
    expect(stored.body).toBe('Content');
  });

  it('preserves unrelated fields like collectionId', async () => {
    const item: NoteItem = {
      id: 'note-1',
      type: 'note',
      title: 'Reference note',
      body: 'Content',
      collectionId: 'col-42',
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    await makeReference(item);

    const stored = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect(stored.collectionId).toBe('col-42');
  });
});
