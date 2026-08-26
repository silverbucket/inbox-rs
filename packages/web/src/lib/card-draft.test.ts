// @vitest-environment jsdom
import type { InboxItem, TodoItem } from '@inbox-rs/rs-module';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyCardDraft,
  cardDraftKey,
  clearCardDraft,
  createCardDraft,
  draftsEqual,
  mergeExternalCardDraft,
  readCardDraft,
  writeCardDraft,
} from './card-draft';

const note: InboxItem = {
  id: 'note-1',
  type: 'note',
  title: 'Original',
  body: 'Old body',
  description: 'Old description',
  createdAt: '2026-08-01T10:00:00.000Z',
  pinned: true,
};

beforeEach(() => localStorage.clear());

describe('card drafts', () => {
  it('round-trips through per-card local storage', () => {
    const draft = createCardDraft(note);
    draft.body = 'Recovered body';
    writeCardDraft(draft, localStorage);

    expect(readCardDraft(note, localStorage)).toEqual(draft);
    clearCardDraft(note.id, localStorage);
    expect(localStorage.getItem(cardDraftKey(note.id))).toBeNull();
  });

  it('ignores malformed and mismatched drafts', () => {
    localStorage.setItem(cardDraftKey(note.id), '{bad json');
    expect(readCardDraft(note, localStorage)).toBeNull();

    localStorage.setItem(
      cardDraftKey(note.id),
      JSON.stringify({ ...createCardDraft(note), type: 'email' }),
    );
    expect(readCardDraft(note, localStorage)).toBeNull();
  });

  it('applies editable fields without dropping external metadata', () => {
    const draft = createCardDraft(note);
    draft.title = 'Changed';
    draft.body = 'Changed body';
    draft.description = '';

    expect(applyCardDraft(note, draft)).toEqual({
      ...note,
      title: 'Changed',
      body: 'Changed body',
      description: undefined,
    });
  });

  it('adds Markdown notes to a bookmark that did not already have a body', () => {
    const bookmark: InboxItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'Example',
      url: 'https://example.org',
      createdAt: note.createdAt,
    };
    const draft = createCardDraft(bookmark);
    draft.body = '## Remember\n\nUseful reference.';

    expect(applyCardDraft(bookmark, draft)).toEqual({
      ...bookmark,
      body: '## Remember\n\nUseful reference.',
    });
  });

  it('preserves bookmark notes when a recovered draft omits body', () => {
    const bookmark: InboxItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'Example',
      url: 'https://example.org',
      body: 'Existing notes',
      createdAt: note.createdAt,
    };
    const draft = createCardDraft(bookmark);
    delete draft.body;

    expect(applyCardDraft(bookmark, draft)).toEqual(bookmark);
  });

  it('clears bookmark notes only when body is explicitly empty', () => {
    const bookmark: InboxItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'Example',
      url: 'https://example.org',
      body: 'Existing notes',
      createdAt: note.createdAt,
    };
    const draft = createCardDraft(bookmark);
    draft.body = '';

    expect(applyCardDraft(bookmark, draft)).toEqual({
      ...bookmark,
      body: undefined,
    });
  });

  it('merges external updates only into untouched draft fields', () => {
    const bookmark: InboxItem = {
      id: 'bm-1',
      type: 'bookmark',
      title: 'https://example.org',
      url: 'https://example.org',
      createdAt: note.createdAt,
    };
    const synced = createCardDraft(bookmark);
    const draft = { ...synced, title: 'My custom title' };
    const enriched = {
      ...bookmark,
      title: 'Example Org',
      description: 'Recovered metadata',
    };

    expect(mergeExternalCardDraft(draft, synced, enriched)).toEqual({
      ...draft,
      description: 'Recovered metadata',
    });
    expect(draftsEqual(synced, createCardDraft(bookmark))).toBe(true);
  });

  it('stamps completion only on the open-to-done transition', () => {
    const todo: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Do it',
      completed: false,
      isTodo: true,
      createdAt: note.createdAt,
    };
    const draft = createCardDraft(todo);
    draft.completed = true;

    const updated = applyCardDraft(
      todo,
      draft,
      new Date('2026-08-08T12:00:00.000Z'),
    ) as TodoItem;
    expect(updated.completed).toBe(true);
    expect(updated.completedAt).toBe('2026-08-08T12:00:00.000Z');
  });
});
