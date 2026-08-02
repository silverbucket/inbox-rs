// @vitest-environment jsdom
import type {
  AudioItem,
  BookmarkItem,
  DocumentItem,
  EmailItem,
  ImageItem,
  NoteItem,
  TodoItem,
} from '@inbox-rs/rs-module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BuildContext,
  buildAudioItem,
  buildBookmarkItem,
  buildDocumentItem,
  buildEmailItem,
  buildImageItem,
  buildNoteItem,
  buildTodoItem,
} from './build-item';

const FIXED_NOW = '2026-04-30T12:00:00.000Z';

beforeEach(() => {
  // Pin Date so completedAt stamping is deterministic.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

const ctx = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  id: overrides.id ?? 'item-1',
  createdAt: overrides.createdAt ?? '2026-04-29T08:00:00.000Z',
  editItem: overrides.editItem,
});

describe('buildBookmarkItem', () => {
  it('creates a new bookmark with title falling back to URL', () => {
    const result = buildBookmarkItem(ctx(), {
      url: 'https://example.com/article',
      title: '',
      description: '',
    });

    expect(result.fileData).toBeUndefined();
    expect(result.item).toEqual({
      id: 'item-1',
      type: 'bookmark',
      title: 'https://example.com/article',
      url: 'https://example.com/article',
      description: undefined,
      createdAt: '2026-04-29T08:00:00.000Z',
    });
  });

  it('uses the provided title when present and trims empty descriptions', () => {
    const result = buildBookmarkItem(ctx(), {
      url: 'https://example.com',
      title: 'Best Article',
      description: '   ',
    });

    expect((result.item as BookmarkItem).title).toBe('Best Article');
    // Whitespace-only is left as-is by the form (it's a non-empty string),
    // documenting current behaviour. If we ever want to trim, do it in the
    // builder so this test guards the change.
    expect((result.item as BookmarkItem).description).toBe('   ');
  });

  it('preserves extension-fetched metadata across edits', () => {
    const editItem: BookmarkItem = {
      id: 'item-1',
      type: 'bookmark',
      title: 'Old Title',
      url: 'https://example.com',
      createdAt: '2026-04-29T08:00:00.000Z',
      favicon: 'https://example.com/favicon.ico',
      ogImage: 'https://example.com/og.png',
      siteName: 'Example',
      body: 'embedded tweet text',
      filePath: 'files/abc.png',
      mimeType: 'image/png',
    };

    const result = buildBookmarkItem(ctx({ editItem }), {
      url: 'https://example.com',
      title: 'New Title',
      description: 'note',
    });

    expect(result.item).toMatchObject({
      title: 'New Title',
      description: 'note',
      favicon: 'https://example.com/favicon.ico',
      ogImage: 'https://example.com/og.png',
      siteName: 'Example',
      body: 'embedded tweet text',
      filePath: 'files/abc.png',
      mimeType: 'image/png',
    });
  });

  it('does not pull metadata from a non-bookmark editItem', () => {
    // Defensive: parent shell normally hands in a same-type editItem, but
    // we still guard against type-cross contamination in the builder.
    const editItem = {
      id: 'item-1',
      type: 'note',
      title: 'Some note',
      body: 'body',
      createdAt: '2026-04-29T08:00:00.000Z',
    } as const;

    const result = buildBookmarkItem(ctx({ editItem }), {
      url: 'https://example.com',
      title: 'New',
      description: '',
    });

    expect((result.item as BookmarkItem).body).toBeUndefined();
    expect((result.item as BookmarkItem).filePath).toBeUndefined();
  });

  it('preserves collectionId when editing a bookmark filed in a collection', () => {
    const editItem: BookmarkItem = {
      id: 'item-1',
      type: 'bookmark',
      title: 'Old',
      url: 'https://example.com',
      collectionId: 'col-42',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const result = buildBookmarkItem(ctx({ id: 'item-1', editItem }), {
      url: 'https://example.com',
      title: 'New',
      description: '',
    });

    expect((result.item as BookmarkItem).collectionId).toBe('col-42');
  });
});

describe('edit preservation of type-agnostic fields', () => {
  it('editing keeps the schedule and posted-entry pointer', () => {
    const editItem: NoteItem = {
      id: 'item-1',
      type: 'note',
      title: 'Old',
      body: 'old',
      createdAt: '2026-04-01T00:00:00Z',
      collectionId: 'col-1',
      startsAt: '2026-05-01T09:00:00.000Z',
      endsAt: '2026-05-01T10:00:00.000Z',
      scheduleKind: 'event',
      eventUrl: 'https://cal.example.org/nick/personal/item-1%40inbox-rs.ics',
      eventEtag: '"e1"',
    };
    const result = buildNoteItem(ctx({ editItem }), {
      title: 'New title',
      body: 'new body',
      description: '',
    });
    expect(result.item).toMatchObject({
      title: 'New title',
      collectionId: 'col-1',
      startsAt: '2026-05-01T09:00:00.000Z',
      endsAt: '2026-05-01T10:00:00.000Z',
      scheduleKind: 'event',
      eventUrl: 'https://cal.example.org/nick/personal/item-1%40inbox-rs.ics',
      eventEtag: '"e1"',
    });
  });

  it('unscheduled edits stay unscheduled', () => {
    const editItem: NoteItem = {
      id: 'item-1',
      type: 'note',
      title: 'Old',
      body: 'old',
      createdAt: '2026-04-01T00:00:00Z',
    };
    const result = buildNoteItem(ctx({ editItem }), {
      title: 'New',
      body: 'new',
      description: '',
    });
    expect(result.item.startsAt).toBeUndefined();
    expect(result.item.eventUrl).toBeUndefined();
  });
});

describe('buildNoteItem', () => {
  it('falls back to first 50 chars of body when title is empty', () => {
    const longBody = 'a'.repeat(80);
    const result = buildNoteItem(ctx(), {
      title: '',
      body: longBody,
      description: '',
    });

    expect(result.item.title).toBe('a'.repeat(50));
    expect((result.item as { body: string }).body).toBe(longBody);
  });

  it('keeps body verbatim and converts empty description to undefined', () => {
    const result = buildNoteItem(ctx(), {
      title: 'Title',
      body: 'Some body',
      description: '',
    });

    expect(result.item).toMatchObject({
      type: 'note',
      title: 'Title',
      body: 'Some body',
      description: undefined,
    });
  });

  it('preserves collectionId when editing a note filed in a collection', () => {
    // Regression: editing a note that lives in a collection must keep it
    // there. Previously the builder created a fresh item without
    // collectionId, so saving an edit silently moved the note back to the
    // Inbox.
    const editItem: NoteItem = {
      id: 'note-1',
      type: 'note',
      title: 'Old title',
      body: 'Old body',
      collectionId: 'col-42',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const result = buildNoteItem(ctx({ id: 'note-1', editItem }), {
      title: 'New title',
      body: 'New body',
      description: '',
    });

    expect((result.item as NoteItem).collectionId).toBe('col-42');
  });

  it('leaves collectionId undefined for a brand-new note (stays in Inbox)', () => {
    const result = buildNoteItem(ctx(), {
      title: 'Title',
      body: 'Some body',
      description: '',
    });

    expect((result.item as NoteItem).collectionId).toBeUndefined();
  });
});

describe('buildImageItem', () => {
  it('returns null when neither a file nor an editItem image is available', async () => {
    const result = await buildImageItem(ctx(), {
      title: '',
      description: '',
      file: null,
    });

    expect(result).toBeNull();
  });

  it('builds a fresh image with a new files/{id}.{ext} path', async () => {
    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    const result = await buildImageItem(ctx({ id: 'img-1' }), {
      title: '',
      description: '',
      file,
    });

    expect(result).not.toBeNull();
    expect(result?.fileData).toBeInstanceOf(ArrayBuffer);
    expect(result?.fileData?.byteLength).toBe(5);
    expect(result?.item).toMatchObject({
      type: 'image',
      title: 'photo.png',
      filePath: 'files/img-1.png',
      mimeType: 'image/png',
      description: undefined,
    });
  });

  it('reuses the existing filePath when replacing the bytes during edit', async () => {
    const editItem: ImageItem = {
      id: 'img-1',
      type: 'image',
      title: 'Old',
      filePath: 'files/img-1-original.png',
      mimeType: 'image/png',
      createdAt: '2026-04-29T08:00:00.000Z',
    };
    const replacement = new File(['xyz'], 'replacement.jpg', {
      type: 'image/jpeg',
    });

    const result = await buildImageItem(ctx({ id: 'img-1', editItem }), {
      title: 'New title',
      description: '',
      file: replacement,
    });

    expect((result?.item as ImageItem).filePath).toBe(
      'files/img-1-original.png',
    );
    expect((result?.item as ImageItem).mimeType).toBe('image/jpeg');
    expect((result?.item as ImageItem).title).toBe('New title');
  });

  it('preserves collectionId when replacing the bytes of a filed image', async () => {
    const editItem: ImageItem = {
      id: 'img-1',
      type: 'image',
      title: 'Old',
      filePath: 'files/img-1.png',
      mimeType: 'image/png',
      collectionId: 'col-42',
      createdAt: '2026-04-29T08:00:00.000Z',
    };
    const replacement = new File(['xyz'], 'replacement.jpg', {
      type: 'image/jpeg',
    });

    const result = await buildImageItem(ctx({ id: 'img-1', editItem }), {
      title: 'New title',
      description: '',
      file: replacement,
    });

    expect((result?.item as ImageItem).collectionId).toBe('col-42');
  });

  it('returns a metadata-only update when editing without replacing the file', async () => {
    const editItem: ImageItem = {
      id: 'img-1',
      type: 'image',
      title: 'Old',
      filePath: 'files/img-1.png',
      mimeType: 'image/png',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const result = await buildImageItem(ctx({ id: 'img-1', editItem }), {
      title: 'New',
      description: 'a new caption',
      file: null,
    });

    expect(result?.fileData).toBeUndefined();
    expect(result?.item).toMatchObject({
      filePath: 'files/img-1.png', // preserved
      title: 'New',
      description: 'a new caption',
    });
  });

  // In jsdom there's no createImageBitmap, so generateThumbnail resolves to
  // null — the same path a real replacement that can't be downscaled takes.
  it('flags the previous thumbnail for removal when a replacement yields no thumb', async () => {
    const editItem: ImageItem = {
      id: 'img-1',
      type: 'image',
      title: 'Old',
      filePath: 'files/img-1.png',
      mimeType: 'image/png',
      thumbPath: 'files/img-1.thumb.jpg',
      thumbMimeType: 'image/jpeg',
      createdAt: '2026-04-29T08:00:00.000Z',
    };
    const replacement = new File(['xyz'], 'replacement.jpg', {
      type: 'image/jpeg',
    });

    const result = await buildImageItem(ctx({ id: 'img-1', editItem }), {
      title: '',
      description: '',
      file: replacement,
    });

    expect((result?.item as ImageItem).thumbPath).toBeUndefined();
    expect(result?.removePaths).toEqual(['files/img-1.thumb.jpg']);
  });

  it('does not flag removal when the edited image had no previous thumbnail', async () => {
    const editItem: ImageItem = {
      id: 'img-1',
      type: 'image',
      title: 'Old',
      filePath: 'files/img-1.png',
      mimeType: 'image/png',
      createdAt: '2026-04-29T08:00:00.000Z',
    };
    const replacement = new File(['xyz'], 'replacement.jpg', {
      type: 'image/jpeg',
    });

    const result = await buildImageItem(ctx({ id: 'img-1', editItem }), {
      title: '',
      description: '',
      file: replacement,
    });

    expect(result?.removePaths).toBeUndefined();
  });
});

describe('buildAudioItem', () => {
  it('picks .webm extension for a webm-typed recording', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm; codecs=opus' });

    const result = await buildAudioItem(ctx({ id: 'rec-1' }), {
      title: '',
      body: '',
      description: '',
      file: null,
      recordedBlob: blob,
      recordingDuration: 12,
      transcript: '',
    });

    expect((result?.item as AudioItem).filePath).toBe('files/rec-1.webm');
    expect((result?.item as AudioItem).mimeType).toBe(
      'audio/webm; codecs=opus',
    );
    expect((result?.item as AudioItem).duration).toBe(12);
  });

  it('picks .mp4 extension when the blob is mp4-typed', async () => {
    const blob = new Blob(['audio'], { type: 'audio/mp4' });

    const result = await buildAudioItem(ctx({ id: 'rec-2' }), {
      title: '',
      body: '',
      description: '',
      file: null,
      recordedBlob: blob,
      recordingDuration: 0,
      transcript: '',
    });

    expect((result?.item as AudioItem).filePath).toBe('files/rec-2.mp4');
    // Zero duration means "didn't measure" — collapse to undefined so the
    // schema doesn't end up with a literal 0 second clip.
    expect((result?.item as AudioItem).duration).toBeUndefined();
  });

  it('falls back to .ogg extension for unknown blob types', async () => {
    const blob = new Blob(['audio'], { type: 'audio/something-weird' });

    const result = await buildAudioItem(ctx({ id: 'rec-3' }), {
      title: '',
      body: '',
      description: '',
      file: null,
      recordedBlob: blob,
      recordingDuration: 5,
      transcript: '',
    });

    expect((result?.item as AudioItem).filePath).toBe('files/rec-3.ogg');
  });

  it('uses transcript as title and body when both are empty', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });

    const result = await buildAudioItem(ctx({ id: 'rec-4' }), {
      title: '',
      body: '',
      description: '',
      file: null,
      recordedBlob: blob,
      recordingDuration: 0,
      transcript: 'Hello there general Kenobi',
      // transcript is the captured speech-to-text result; we want it to
      // surface as the default title without forcing the user to type one.
    });

    expect((result?.item as AudioItem).title).toBe(
      'Hello there general Kenobi',
    );
    expect((result?.item as AudioItem).body).toBe('Hello there general Kenobi');
    expect((result?.item as AudioItem).transcribed).toBe(true);
  });

  it('defaults title to "Audio" when no transcript or user input is available', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });

    const result = await buildAudioItem(ctx(), {
      title: '',
      body: '',
      description: '',
      file: null,
      recordedBlob: blob,
      recordingDuration: 0,
      transcript: '',
    });

    expect((result?.item as AudioItem).title).toBe('Audio');
    // Recording exists (even with no transcript text) → mark as having
    // audio content. The `transcribed` field here indicates presence of
    // a recording rather than the existence of text.
    expect((result?.item as AudioItem).transcribed).toBe(true);
  });

  it('uses uploaded file extension when no recording is present', async () => {
    const file = new File(['audio'], 'memo.m4a', { type: 'audio/mp4' });

    const result = await buildAudioItem(ctx({ id: 'rec-5' }), {
      title: 'My memo',
      body: '',
      description: '',
      file,
      recordedBlob: null,
      recordingDuration: 0,
      transcript: '',
    });

    expect((result?.item as AudioItem).filePath).toBe('files/rec-5.m4a');
    expect((result?.item as AudioItem).mimeType).toBe('audio/mp4');
  });

  it('returns null when neither recording, file, nor edit-target is set', async () => {
    const result = await buildAudioItem(ctx(), {
      title: '',
      body: '',
      description: '',
      file: null,
      recordedBlob: null,
      recordingDuration: 0,
      transcript: '',
    });

    expect(result).toBeNull();
  });

  it('returns metadata-only update on edit without re-uploading bytes', async () => {
    const editItem: AudioItem = {
      id: 'rec-6',
      type: 'audio',
      title: 'Old title',
      filePath: 'files/rec-6.webm',
      mimeType: 'audio/webm',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const result = await buildAudioItem(ctx({ id: 'rec-6', editItem }), {
      title: 'New title',
      body: 'New body',
      description: 'desc',
      file: null,
      recordedBlob: null,
      recordingDuration: 0,
      transcript: '',
    });

    expect(result?.fileData).toBeUndefined();
    expect(result?.item).toMatchObject({
      filePath: 'files/rec-6.webm',
      title: 'New title',
      body: 'New body',
      description: 'desc',
    });
  });

  it('preserves collectionId when re-recording a filed audio memo', async () => {
    const editItem: AudioItem = {
      id: 'rec-6',
      type: 'audio',
      title: 'Old',
      filePath: 'files/rec-6.webm',
      mimeType: 'audio/webm',
      collectionId: 'col-42',
      createdAt: '2026-04-29T08:00:00.000Z',
    };
    const blob = new Blob(['audio'], { type: 'audio/webm' });

    const result = await buildAudioItem(ctx({ id: 'rec-6', editItem }), {
      title: '',
      body: '',
      description: '',
      file: null,
      recordedBlob: blob,
      recordingDuration: 3,
      transcript: '',
    });

    expect((result?.item as AudioItem).collectionId).toBe('col-42');
  });
});

describe('buildDocumentItem', () => {
  it('returns null without a file or edit target', async () => {
    expect(
      await buildDocumentItem(ctx(), {
        title: '',
        description: '',
        file: null,
      }),
    ).toBeNull();
  });

  it('captures fileSize and fileName from the picked file', async () => {
    const file = new File(['hello'], 'report.pdf', {
      type: 'application/pdf',
    });

    const result = await buildDocumentItem(ctx({ id: 'doc-1' }), {
      title: '',
      description: '',
      file,
    });

    expect(result?.item).toMatchObject({
      type: 'document',
      filePath: 'files/doc-1.pdf',
      mimeType: 'application/pdf',
      fileSize: 5,
      fileName: 'report.pdf',
      title: 'report.pdf',
    });
  });

  it('reuses the existing filePath on replacement edit', async () => {
    const editItem: DocumentItem = {
      id: 'doc-1',
      type: 'document',
      title: 'Old',
      filePath: 'files/doc-1.pdf',
      mimeType: 'application/pdf',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const file = new File(['hi'], 'updated.pdf', {
      type: 'application/pdf',
    });

    const result = await buildDocumentItem(ctx({ id: 'doc-1', editItem }), {
      title: '',
      description: '',
      file,
    });

    expect((result?.item as DocumentItem).filePath).toBe('files/doc-1.pdf');
  });

  it('preserves collectionId when replacing a filed document', async () => {
    const editItem: DocumentItem = {
      id: 'doc-1',
      type: 'document',
      title: 'Old',
      filePath: 'files/doc-1.pdf',
      mimeType: 'application/pdf',
      collectionId: 'col-42',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const file = new File(['hi'], 'updated.pdf', { type: 'application/pdf' });

    const result = await buildDocumentItem(ctx({ id: 'doc-1', editItem }), {
      title: '',
      description: '',
      file,
    });

    expect((result?.item as DocumentItem).collectionId).toBe('col-42');
  });
});

describe('buildEmailItem', () => {
  it('falls back to "Untitled email" when subject is blank', () => {
    const result = buildEmailItem(ctx(), {
      title: '',
      body: 'Hello world',
      from: '',
      notes: '',
    });

    expect((result.item as EmailItem).title).toBe('Untitled email');
    expect((result.item as EmailItem).from).toBeUndefined();
    expect((result.item as EmailItem).notes).toBeUndefined();
    expect((result.item as EmailItem).messageUrl).toBeUndefined();
  });

  it('preserves messageUrl from edit target', () => {
    const editItem: EmailItem = {
      id: 'mail-1',
      type: 'email',
      title: 'Hello',
      body: 'orig',
      messageUrl: 'mid:abc@example.com',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const result = buildEmailItem(ctx({ id: 'mail-1', editItem }), {
      title: 'Hello',
      body: 'updated',
      from: 'sender@example.com',
      notes: '',
    });

    expect(result.item).toMatchObject({
      title: 'Hello',
      body: 'updated',
      from: 'sender@example.com',
      messageUrl: 'mid:abc@example.com',
    });
  });

  it('does not preserve messageUrl when crossing types', () => {
    const editItem = {
      id: 'note-1',
      type: 'note',
      title: 'Old note',
      body: 'note body',
      createdAt: '2026-04-29T08:00:00.000Z',
    } as const;

    const result = buildEmailItem(ctx({ editItem }), {
      title: 'New email',
      body: 'b',
      from: '',
      notes: '',
    });

    expect((result.item as EmailItem).messageUrl).toBeUndefined();
  });

  it('preserves collectionId when editing an email filed in a collection', () => {
    const editItem: EmailItem = {
      id: 'mail-1',
      type: 'email',
      title: 'Hello',
      body: 'orig',
      collectionId: 'col-42',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const result = buildEmailItem(ctx({ id: 'mail-1', editItem }), {
      title: 'Hello',
      body: 'updated',
      from: '',
      notes: '',
    });

    expect((result.item as EmailItem).collectionId).toBe('col-42');
  });
});

describe('buildTodoItem', () => {
  it('stamps completedAt on a fresh false→true completion', () => {
    const result = buildTodoItem(ctx({ id: 'todo-1' }), {
      title: 'Buy milk',
      body: '',
      description: '',
      completed: true,
    });

    expect((result.item as TodoItem).completed).toBe(true);
    expect((result.item as TodoItem).completedAt).toBe(FIXED_NOW);
    expect((result.item as TodoItem).isTodo).toBe(true);
  });

  it('preserves the historical completedAt when re-saving an already-completed todo', () => {
    const editItem: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Buy milk',
      completed: true,
      completedAt: '2025-12-01T00:00:00.000Z',
      isTodo: true,
      createdAt: '2025-11-30T00:00:00.000Z',
    };

    const result = buildTodoItem(ctx({ id: 'todo-1', editItem }), {
      title: 'Buy milk (and bread)',
      body: '',
      description: '',
      completed: true,
    });

    expect((result.item as TodoItem).completedAt).toBe(
      '2025-12-01T00:00:00.000Z',
    );
  });

  it('keeps the historical completedAt even when the user unchecks completed', () => {
    // Regression guard: a previous refactor draft cleared completedAt on
    // uncheck, which silently lost completion history. We intentionally
    // pass the old timestamp through so downstream UI can still surface
    // "previously completed at <time>" if it wants to.
    const editItem: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Buy milk',
      completed: true,
      completedAt: '2025-12-01T00:00:00.000Z',
      isTodo: true,
      createdAt: '2025-11-30T00:00:00.000Z',
    };

    const result = buildTodoItem(ctx({ id: 'todo-1', editItem }), {
      title: 'Buy milk',
      body: '',
      description: '',
      completed: false,
    });

    expect((result.item as TodoItem).completed).toBe(false);
    expect((result.item as TodoItem).completedAt).toBe(
      '2025-12-01T00:00:00.000Z',
    );
  });

  it('leaves completedAt undefined when neither the form nor the edit target had completion', () => {
    const result = buildTodoItem(ctx(), {
      title: 'New todo',
      body: '',
      description: '',
      completed: false,
    });

    expect((result.item as TodoItem).completed).toBe(false);
    expect((result.item as TodoItem).completedAt).toBeUndefined();
  });

  it('coerces empty body and description to undefined', () => {
    const result = buildTodoItem(ctx(), {
      title: 'Title',
      body: '',
      description: '',
      completed: false,
    });

    expect((result.item as TodoItem).body).toBeUndefined();
    expect((result.item as TodoItem).description).toBeUndefined();
  });

  it('preserves collectionId when editing a todo filed in a collection', () => {
    const editItem: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Buy milk',
      completed: false,
      isTodo: true,
      collectionId: 'col-42',
      createdAt: '2026-04-29T08:00:00.000Z',
    };

    const result = buildTodoItem(ctx({ id: 'todo-1', editItem }), {
      title: 'Buy milk and bread',
      body: '',
      description: '',
      completed: false,
    });

    expect((result.item as TodoItem).collectionId).toBe('col-42');
  });
});
