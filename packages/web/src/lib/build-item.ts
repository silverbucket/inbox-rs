/**
 * Pure per-item-type builders that translate the AddEntryModal's per-type
 * form state into a fully-formed `InboxItem` (plus optional `fileData` for
 * binary types). Pulled out of the Svelte form components so the
 * field-shaping rules — title fallbacks, edit-time metadata preservation,
 * file extension picking, completedAt stamping — can be unit-tested
 * without mounting the UI.
 *
 * Each function takes a `ctx` (id/createdAt/editItem) plus a typed `data`
 * bag of the form's own state. Synchronous types return `BuildItemResult`
 * directly; file-backed types are async because they have to materialise
 * `arrayBuffer()` from a `File` or `Blob`. Functions that can fail in a
 * non-error way (e.g. an Image form with no file picked and no existing
 * file to keep) return `null` — the caller treats that as "save is a
 * no-op right now".
 */

import type {
  AudioItem,
  BookmarkItem,
  DocumentItem,
  EmailItem,
  ImageItem,
  InboxItem,
  NoteItem,
  TodoItem,
} from '@inbox-rs/rs-module';
import { type BuildItemResult, getFileExtension } from './add-entry-modal';

export interface BuildContext {
  id: string;
  createdAt: string;
  editItem?: InboxItem;
}

/**
 * Carry the edit target's collection membership onto a freshly-rebuilt item.
 * `collectionId` is a type-agnostic placement field the per-type forms never
 * surface, so without this every edit would drop it and silently move the
 * item back to the Inbox. Applied unconditionally on edit (including across
 * type conversions) so an item filed in a collection stays there.
 */
function preserveCollection<T extends InboxItem>(
  ctx: BuildContext,
  item: T,
): T {
  if (ctx.editItem?.collectionId) {
    item.collectionId = ctx.editItem.collectionId;
  }
  return item;
}

export interface BookmarkFormData {
  url: string;
  title: string;
  description: string;
}

export function buildBookmarkItem(
  ctx: BuildContext,
  data: BookmarkFormData,
): BuildItemResult {
  const bookmark: BookmarkItem = {
    id: ctx.id,
    type: 'bookmark',
    title: data.title || data.url,
    url: data.url,
    description: data.description || undefined,
    createdAt: ctx.createdAt,
  };
  // Preserve enrichment metadata fetched by the extension (favicon,
  // ogImage, siteName, embedded body, downloaded image) — the web form
  // doesn't surface these fields, so we'd lose them if we didn't copy
  // them through on edit.
  if (ctx.editItem && ctx.editItem.type === 'bookmark') {
    if (ctx.editItem.favicon) bookmark.favicon = ctx.editItem.favicon;
    if (ctx.editItem.ogImage) bookmark.ogImage = ctx.editItem.ogImage;
    if (ctx.editItem.siteName) bookmark.siteName = ctx.editItem.siteName;
    if (ctx.editItem.body) bookmark.body = ctx.editItem.body;
    if (ctx.editItem.filePath) bookmark.filePath = ctx.editItem.filePath;
    if (ctx.editItem.mimeType) bookmark.mimeType = ctx.editItem.mimeType;
  }
  return { item: preserveCollection(ctx, bookmark) };
}

export interface NoteFormData {
  title: string;
  body: string;
  description: string;
}

export function buildNoteItem(
  ctx: BuildContext,
  data: NoteFormData,
): BuildItemResult {
  const item: NoteItem = {
    id: ctx.id,
    type: 'note',
    title: data.title || data.body.slice(0, 50),
    body: data.body,
    description: data.description || undefined,
    createdAt: ctx.createdAt,
  };
  return { item: preserveCollection(ctx, item) };
}

export interface ImageFormData {
  title: string;
  description: string;
  file: File | null;
}

export async function buildImageItem(
  ctx: BuildContext,
  data: ImageFormData,
): Promise<BuildItemResult | null> {
  if (data.file) {
    // On edit, reuse the original file path so the new bytes overwrite
    // the existing storage location instead of leaving the old blob behind.
    const existingPath =
      ctx.editItem?.type === 'image' ? ctx.editItem.filePath : undefined;
    const ext = getFileExtension(data.file.name);
    const filePath = existingPath || `files/${ctx.id}${ext}`;
    const fileData = await data.file.arrayBuffer();
    const item: ImageItem = {
      id: ctx.id,
      type: 'image',
      title: data.title || data.file.name,
      filePath,
      mimeType: data.file.type,
      description: data.description || undefined,
      createdAt: ctx.createdAt,
    };
    return { item: preserveCollection(ctx, item), fileData };
  }
  if (ctx.editItem && ctx.editItem.type === 'image') {
    const item: ImageItem = {
      ...ctx.editItem,
      title: data.title || ctx.editItem.title,
      description: data.description || undefined,
    };
    return { item };
  }
  return null;
}

export interface AudioFormData {
  title: string;
  body: string;
  description: string;
  file: File | null;
  recordedBlob: Blob | null;
  recordingDuration: number;
  transcript: string;
}

export async function buildAudioItem(
  ctx: BuildContext,
  data: AudioFormData,
): Promise<BuildItemResult | null> {
  if (data.recordedBlob || data.file) {
    const existingPath =
      ctx.editItem?.type === 'audio' ? ctx.editItem.filePath : undefined;
    let filePath: string;
    let mimeType: string;
    let duration: number | undefined;
    let fileData: ArrayBuffer;
    if (data.recordedBlob) {
      const ext = data.recordedBlob.type.includes('webm')
        ? '.webm'
        : data.recordedBlob.type.includes('mp4')
          ? '.mp4'
          : '.ogg';
      filePath = existingPath || `files/${ctx.id}${ext}`;
      mimeType = data.recordedBlob.type || 'audio/webm';
      fileData = await data.recordedBlob.arrayBuffer();
      duration = data.recordingDuration || undefined;
    } else if (data.file) {
      const ext = getFileExtension(data.file.name);
      filePath = existingPath || `files/${ctx.id}${ext}`;
      mimeType = data.file.type;
      fileData = await data.file.arrayBuffer();
    } else {
      return null;
    }
    const memoBody = data.body || data.transcript || undefined;
    const autoTitle = data.title || data.transcript || 'Audio';
    const transcribed =
      !!(data.recordedBlob || data.transcript || data.body) || undefined;
    const item: AudioItem = {
      id: ctx.id,
      type: 'audio',
      title: autoTitle,
      filePath,
      mimeType,
      duration,
      body: memoBody,
      transcribed,
      description: data.description || undefined,
      createdAt: ctx.createdAt,
    };
    return { item: preserveCollection(ctx, item), fileData };
  }
  if (ctx.editItem && ctx.editItem.type === 'audio') {
    const item: AudioItem = {
      ...ctx.editItem,
      title: data.title || ctx.editItem.title,
      body: data.body || undefined,
      description: data.description || undefined,
    };
    return { item };
  }
  return null;
}

export interface DocumentFormData {
  title: string;
  description: string;
  file: File | null;
}

export async function buildDocumentItem(
  ctx: BuildContext,
  data: DocumentFormData,
): Promise<BuildItemResult | null> {
  if (data.file) {
    const existingPath =
      ctx.editItem?.type === 'document' ? ctx.editItem.filePath : undefined;
    const ext = getFileExtension(data.file.name);
    const filePath = existingPath || `files/${ctx.id}${ext}`;
    const fileData = await data.file.arrayBuffer();
    const item: DocumentItem = {
      id: ctx.id,
      type: 'document',
      title: data.title || data.file.name,
      filePath,
      mimeType: data.file.type,
      fileSize: data.file.size,
      fileName: data.file.name,
      description: data.description || undefined,
      createdAt: ctx.createdAt,
    };
    return { item: preserveCollection(ctx, item), fileData };
  }
  if (ctx.editItem && ctx.editItem.type === 'document') {
    const item: DocumentItem = {
      ...ctx.editItem,
      title: data.title || ctx.editItem.title,
      description: data.description || undefined,
    };
    return { item };
  }
  return null;
}

export interface EmailFormData {
  title: string;
  body: string;
  from: string;
  notes: string;
}

export function buildEmailItem(
  ctx: BuildContext,
  data: EmailFormData,
): BuildItemResult {
  // Preserve the mid: URI when editing — this links the captured email
  // back to the user's mail client and isn't surfaced in the form.
  const messageUrl =
    ctx.editItem?.type === 'email' ? ctx.editItem.messageUrl : undefined;
  const item: EmailItem = {
    id: ctx.id,
    type: 'email',
    title: data.title || 'Untitled email',
    body: data.body,
    from: data.from || undefined,
    notes: data.notes || undefined,
    messageUrl,
    createdAt: ctx.createdAt,
  };
  return { item: preserveCollection(ctx, item) };
}

export interface TodoFormData {
  title: string;
  body: string;
  description: string;
  completed: boolean;
}

export function buildTodoItem(
  ctx: BuildContext,
  data: TodoFormData,
): BuildItemResult {
  // Stamp `completedAt` only on the false→true transition. Otherwise we
  // pass the editItem's existing value through untouched — including the
  // case where the user *unchecks* a previously-completed todo, where we
  // intentionally retain the historical timestamp instead of clearing
  // it. This matches the pre-refactor behaviour and means downstream
  // surfaces can still show "last completed at <time>" hints on a
  // re-opened todo.
  const wasCompleted =
    ctx.editItem && 'completed' in ctx.editItem && !!ctx.editItem.completed;
  const previousCompletedAt =
    ctx.editItem && 'completedAt' in ctx.editItem
      ? ctx.editItem.completedAt
      : undefined;
  const completedAt =
    data.completed && !wasCompleted
      ? new Date().toISOString()
      : previousCompletedAt;
  const item: TodoItem = {
    id: ctx.id,
    type: 'todo',
    title: data.title,
    body: data.body || undefined,
    completed: data.completed,
    completedAt,
    description: data.description || undefined,
    createdAt: ctx.createdAt,
    isTodo: true,
  };
  return { item: preserveCollection(ctx, item) };
}
