// @vitest-environment jsdom
import type { InboxItem, TodoItem } from '@inbox-rs/rs-module';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyCardDraft,
  cardDraftKey,
  clearCardDraft,
  createCardDraft,
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
