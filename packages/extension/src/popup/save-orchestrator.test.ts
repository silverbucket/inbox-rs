import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `runSavePage` / `runSaveNote` orchestrate calls into `save-logic.ts`
 * (which itself calls `rs.store(...)` and the SW message round-trip for
 * image downloads). The orchestrator's contract is "never throws":
 * everything that used to escape the popup's click handler must now be
 * captured and returned as `{ ok: false, error }`.
 *
 * Browser globals are mocked at the module-loading boundary so the
 * orchestrator and the underlying `save-logic` see consistent stubs.
 */
const { mockSendMessage, mockFetch } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage: mockSendMessage },
    storage: { local: { get: vi.fn(), set: vi.fn() } },
  },
}));

vi.stubGlobal('fetch', mockFetch);

import { DirectRS } from '../lib/rs';
import { runSaveNote, runSavePage } from './save-orchestrator';

function makeRS(): DirectRS {
  return new DirectRS({
    userAddress: 'test@example.com',
    token: 'tok',
    href: 'https://storage.example.com',
  });
}

const basePageParams = {
  pageUrl: 'https://example.com/article',
  pageTitle: 'Article',
  pageNote: '',
  pageDescription: '',
  embeddedContent: '',
  tweetImages: [] as string[],
  ogImage: '',
  favicon: '',
  siteName: '',
  isDirectImage: false,
  generateId: () => 'page-uuid-1',
  now: () => '2026-01-01T00:00:00.000Z',
};

const baseNoteParams = {
  noteTitle: 'Title',
  noteBody: 'Body',
  generateId: () => 'note-uuid-1',
  now: () => '2026-01-01T00:00:00.000Z',
};

describe('runSavePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:true on a successful bookmark save', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    const result = await runSavePage({ rs, ...basePageParams });

    expect(result).toEqual({ ok: true });
    // No image to fetch — SW round-trip must not be invoked.
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION: the popup used to call `await saveAsBookmark(...)` with no
   * try/catch. When the underlying PUT failed (401, 5xx, network error,
   * MV3 SW termination) the rejection escaped the click handler, leaving
   * `saving` stuck true and the popup hanging in "Saving…" forever.
   */
  it('returns ok:false when the bookmark PUT fails (e.g. 401 expired token)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const rs = makeRS();

    const result = await runSavePage({ rs, ...basePageParams });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });

  it('returns ok:false when fetch rejects (network failure / CORS block)', async () => {
    mockFetch.mockRejectedValue(new TypeError('NetworkError'));
    const rs = makeRS();

    const result = await runSavePage({ rs, ...basePageParams });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/NetworkError/);
  });

  it('falls back to bookmark when image save returns null (SW download failed)', async () => {
    // First call: SW image download — returns ok:false.
    mockSendMessage.mockResolvedValue({ ok: false });
    // Second call: bookmark PUT — succeeds.
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    const result = await runSavePage({
      rs,
      ...basePageParams,
      isDirectImage: true,
      pageUrl: 'https://cdn.example.com/photo.jpg',
    });

    expect(result).toEqual({ ok: true });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    // bookmark PUT happened
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/inbox/items/page-uuid-1'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('falls back to bookmark when image save throws (SW round-trip rejected)', async () => {
    mockSendMessage.mockRejectedValue(
      new Error(
        'Could not establish connection. Receiving end does not exist.',
      ),
    );
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    const result = await runSavePage({
      rs,
      ...basePageParams,
      isDirectImage: true,
      pageUrl: 'https://cdn.example.com/photo.jpg',
    });

    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false when both image and bookmark fail', async () => {
    mockSendMessage.mockResolvedValue({ ok: false });
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const rs = makeRS();

    const result = await runSavePage({
      rs,
      ...basePageParams,
      isDirectImage: true,
      pageUrl: 'https://cdn.example.com/photo.jpg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('500');
  });

  it('returns ok:true when isDirectImage save succeeds (no fallback)', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, mimeType: 'image/jpeg' });
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    const result = await runSavePage({
      rs,
      ...basePageParams,
      isDirectImage: true,
      pageUrl: 'https://cdn.example.com/photo.jpg',
    });

    expect(result).toEqual({ ok: true });
    // Exactly one fetch — the ImageItem metadata PUT. No bookmark fallback.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/inbox/items/page-uuid-1'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('uses the supplied generateId / now hooks (deterministic in tests)', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    await runSavePage({
      ...basePageParams,
      rs,
      generateId: () => 'custom-id',
      now: () => '2099-12-31T23:59:59.999Z',
    });

    const stored = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
    expect(stored.id).toBe('custom-id');
    expect(stored.createdAt).toBe('2099-12-31T23:59:59.999Z');
  });

  it('reuses the same id across image-fail -> bookmark fallback', async () => {
    // When direct-image save fails and we fall back to bookmark, both
    // should share the same item id. Otherwise debugging "I clicked save
    // once but got two ids" gets impossible.
    mockSendMessage.mockResolvedValue({ ok: false }); // SW download fails
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    await runSavePage({
      ...basePageParams,
      rs,
      isDirectImage: true,
      pageUrl: 'https://cdn.example.com/photo.jpg',
      generateId: () => 'shared-id',
    });

    // The SW received the same id-derived path as the bookmark would have.
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: expect.stringContaining('shared-id'),
      }),
    );
    // And the bookmark stored under the same id.
    const bookmark = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
    expect(bookmark.id).toBe('shared-id');
  });

  it('persists pageNote into the saved bookmark description', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    await runSavePage({
      ...basePageParams,
      rs,
      pageNote: 'My note',
      pageDescription: 'OG description',
    });

    const stored = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
    expect(stored.description).toContain('My note');
    expect(stored.description).toContain('OG description');
  });
});

describe('runSaveNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:true on a successful save', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    const result = await runSaveNote({ rs, ...baseNoteParams });

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/inbox/items/note-uuid-1'),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
  });

  it('produces a NoteItem with the expected shape', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    await runSaveNote({
      rs,
      noteTitle: 'Reminder',
      noteBody: 'Buy groceries',
      generateId: () => 'note-1',
      now: () => '2026-04-29T12:00:00.000Z',
    });

    const stored = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
    expect(stored).toEqual({
      id: 'note-1',
      type: 'note',
      title: 'Reminder',
      body: 'Buy groceries',
      createdAt: '2026-04-29T12:00:00.000Z',
    });
  });

  it('uses first 50 chars of body as title when title is empty', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();
    const longBody =
      'This is a long note body that should get truncated for the title at fifty characters exactly.';

    await runSaveNote({
      rs,
      ...baseNoteParams,
      noteTitle: '',
      noteBody: longBody,
    });

    const stored = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
    expect(stored.title).toBe(longBody.slice(0, 50));
    expect(stored.body).toBe(longBody);
  });

  it('uses only the first body line as the title when title is empty', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();
    const body = 'a short title\nand some more text about stuff';

    await runSaveNote({
      rs,
      ...baseNoteParams,
      noteTitle: '',
      noteBody: body,
    });

    const stored = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
    expect(stored.title).toBe('a short title');
    expect(stored.body).toBe(body);
  });

  it('trims whitespace-only title and body', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const rs = makeRS();

    await runSaveNote({
      rs,
      ...baseNoteParams,
      noteTitle: '   ',
      noteBody: '  hello  ',
    });

    const stored = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
    expect(stored.title).toBe('hello');
    expect(stored.body).toBe('hello');
  });

  it('returns ok:false (without calling fetch) when body is empty', async () => {
    const rs = makeRS();

    const result = await runSaveNote({ rs, ...baseNoteParams, noteBody: '' });

    expect(result).toEqual({ ok: false, error: 'Note body is empty' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns ok:false (without calling fetch) when body is whitespace only', async () => {
    const rs = makeRS();

    const result = await runSaveNote({
      rs,
      ...baseNoteParams,
      noteBody: '   \n\t  ',
    });

    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION: same as for runSavePage — the popup used `await rs.store(item)`
   * unprotected. Any rejection there would leave the popup hanging.
   */
  it('returns ok:false when the PUT fails (e.g. 500 server error)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const rs = makeRS();

    const result = await runSaveNote({ rs, ...baseNoteParams });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('500');
  });

  it('never throws — pathological rejections become tagged failures', async () => {
    for (const reason of [undefined, null, { weird: 'shape' }, 42]) {
      mockFetch.mockRejectedValue(reason);
      const rs = makeRS();
      await expect(
        runSaveNote({ rs, ...baseNoteParams }),
      ).resolves.toMatchObject({ ok: false });
    }
  });
});
