/**
 * Save-flow orchestrators for the popup.
 *
 * The popup has historically called `saveAsImage` / `saveAsBookmark` /
 * `rs.store()` directly inside its click handlers, with no error handling
 * around the call. When any underlying step rejected — expired token, network
 * failure, MV3 service-worker termination during the image-download
 * round-trip — the exception bubbled out of the handler, the handler's
 * `saving` flag was never reset, and the popup appeared to hang in "Saving…"
 * forever.
 *
 * These orchestrators move that logic out of Svelte and turn errors into
 * tagged results so the popup just renders state. They never throw — every
 * failure becomes `{ ok: false, error }`, leaving the popup free to reset its
 * spinner in `finally` regardless of outcome.
 */

import type { NoteItem } from '@inbox-rs/rs-module';
import type { DirectRS } from '../lib/rs';
import { saveAsBookmark, saveAsImage } from './save-logic';

/** Tagged outcome for a save attempt. Errors never throw — they become `{ ok: false }`. */
export type SaveResult = { ok: true } | { ok: false; error: string };

export interface SavePageOrchestratorParams {
  rs: DirectRS;
  pageUrl: string;
  pageTitle: string;
  pageNote: string;
  pageDescription: string;
  embeddedContent: string;
  tweetImages: string[];
  ogImage: string;
  favicon: string;
  siteName: string;
  isDirectImage: boolean;
  /** Override for tests; defaults to `crypto.randomUUID()`. */
  generateId?: () => string;
  /** Override for tests; defaults to `new Date().toISOString()`. */
  now?: () => string;
}

/**
 * Save the active page. For direct-image pages, attempts an `ImageItem` save
 * first and falls back to `BookmarkItem` if that fails (matching legacy
 * behaviour). Always resolves — never throws.
 */
export async function runSavePage(
  params: SavePageOrchestratorParams,
): Promise<SaveResult> {
  const id = params.generateId?.() ?? crypto.randomUUID();
  const createdAt = params.now?.() ?? new Date().toISOString();

  if (params.isDirectImage) {
    try {
      const result = await saveAsImage({
        rs: params.rs,
        id,
        pageUrl: params.pageUrl,
        pageTitle: params.pageTitle,
        pageNote: params.pageNote,
        createdAt,
      });
      if (result) return { ok: true };
      // saveAsImage returned null (download via SW failed) — fall through.
    } catch {
      // Image save threw — fall through to bookmark save.
    }
  }

  try {
    await saveAsBookmark({
      rs: params.rs,
      id,
      pageUrl: params.pageUrl,
      pageTitle: params.pageTitle,
      pageNote: params.pageNote,
      pageDescription: params.pageDescription,
      embeddedContent: params.embeddedContent,
      tweetImages: params.tweetImages,
      ogImage: params.ogImage,
      favicon: params.favicon,
      siteName: params.siteName,
      createdAt,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: errorMessage(e) };
  }
}

export interface SaveNoteOrchestratorParams {
  rs: DirectRS;
  noteTitle: string;
  noteBody: string;
  generateId?: () => string;
  now?: () => string;
}

/**
 * Save a quick note. Returns `{ ok: false }` if the body is empty or if
 * `rs.store` rejects. Always resolves.
 */
export async function runSaveNote(
  params: SaveNoteOrchestratorParams,
): Promise<SaveResult> {
  const body = params.noteBody.trim();
  if (!body) return { ok: false, error: 'Note body is empty' };

  const id = params.generateId?.() ?? crypto.randomUUID();
  const createdAt = params.now?.() ?? new Date().toISOString();

  const item: NoteItem = {
    id,
    type: 'note',
    title: params.noteTitle.trim() || body.slice(0, 50),
    body,
    createdAt,
  };

  try {
    await params.rs.store(item);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: errorMessage(e) };
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'Save failed';
}
