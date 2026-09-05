// @vitest-environment jsdom
import type { InboxItem } from '@inbox-rs/rs-module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cardDraftKey, createCardDraft, writeCardDraft } from './card-draft';
import { replayCardDrafts } from './card-draft-recovery';

const note: InboxItem = {
  id: 'note-1',
  type: 'note',
  title: 'Original',
  body: 'Old body',
  createdAt: '2026-08-01T10:00:00.000Z',
};

const other: InboxItem = {
  id: 'note-2',
  type: 'note',
  title: 'Untouched',
  body: 'Still here',
  createdAt: '2026-08-01T11:00:00.000Z',
};

beforeEach(() => localStorage.clear());

describe('replayCardDrafts', () => {
  it('writes an orphaned draft to storage and clears it', async () => {
    const draft = createCardDraft(note);
    draft.body = 'Typed right before the tab closed';
    writeCardDraft(draft, localStorage);
    const store = vi.fn().mockResolvedValue(undefined);

    const written = await replayCardDrafts(
      { [note.id]: note, [other.id]: other },
      localStorage,
      store,
    );

    expect(written).toBe(1);
    expect(store).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith({
      ...note,
      body: 'Typed right before the tab closed',
      description: undefined,
    });
    expect(localStorage.getItem(cardDraftKey(note.id))).toBeNull();
  });

  it('drops a draft that matches what is already stored without writing', async () => {
    writeCardDraft(createCardDraft(note), localStorage);
    const store = vi.fn().mockResolvedValue(undefined);

    expect(
      await replayCardDrafts({ [note.id]: note }, localStorage, store),
    ).toBe(0);
    expect(store).not.toHaveBeenCalled();
    expect(localStorage.getItem(cardDraftKey(note.id))).toBeNull();
  });

  it('leaves drafts for items that are not loaded, and clears malformed ones', async () => {
    const draft = createCardDraft(note);
    draft.title = 'Edited while offline';
    writeCardDraft(draft, localStorage);
    localStorage.setItem(cardDraftKey(other.id), '{not json');
    const store = vi.fn().mockResolvedValue(undefined);

    expect(
      await replayCardDrafts({ [other.id]: other }, localStorage, store),
    ).toBe(0);
    expect(store).not.toHaveBeenCalled();
    expect(localStorage.getItem(cardDraftKey(note.id))).not.toBeNull();
    expect(localStorage.getItem(cardDraftKey(other.id))).toBeNull();
  });

  it('keeps the draft when the write fails so the editor can retry it', async () => {
    const draft = createCardDraft(note);
    draft.body = 'Do not lose me';
    writeCardDraft(draft, localStorage);
    const store = vi.fn().mockRejectedValue(new Error('offline'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    expect(
      await replayCardDrafts({ [note.id]: note }, localStorage, store),
    ).toBe(0);
    expect(localStorage.getItem(cardDraftKey(note.id))).not.toBeNull();
    consoleError.mockRestore();
  });
});
