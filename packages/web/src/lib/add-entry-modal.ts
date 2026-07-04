import type { InboxItem, InboxItemType, TodoItem } from '@inbox-rs/rs-module';
import type { Component } from 'svelte';

/**
 * Context passed by the AddEntryModal shell to a per-type form's `buildItem`
 * function. The shell owns the id/createdAt allocation so the same identity
 * survives an edit, and so that the modal's "Save" action can reach into the
 * form for a finished item without the form needing to know about storage.
 */
export interface BuildItemContext {
  id: string;
  createdAt: string;
  isEdit: boolean;
  editItem?: InboxItem;
}

/**
 * What a per-type form returns from `buildItem`. `fileData` is the binary
 * payload to pass alongside the metadata-only item to `storeItem`. Returning
 * `null` is a soft cancel — the form is in a state where save is meaningless
 * (e.g. an image form with no file picked and no existing file to keep).
 */
export interface BuildItemResult {
  item: InboxItem;
  fileData?: ArrayBuffer;
  /** Downscaled preview bytes for image items (see lib/thumbnail.ts). */
  thumbData?: ArrayBuffer;
}

/**
 * Callable a per-type form exposes to the modal shell via $bindable. The
 * shell calls this once on Save; per-type forms keep their own UI state and
 * just translate it into an InboxItem when asked.
 */
export type BuildItemFn = (
  ctx: BuildItemContext,
) => Promise<BuildItemResult | null> | BuildItemResult | null;

/** Get a filename's extension including the leading dot (or '' if none). */
export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '';
}

/**
 * Format a recording timer as `m:ss`. Used by both the Add Audio form and
 * any other place that might want to surface elapsed seconds in mm:ss.
 */
export function formatRecordingTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SUBMITTABLE_INPUT_TYPES = new Set([
  'text',
  'url',
  'email',
  'search',
  'tel',
]);

export function shouldSubmitAddEntryForm(
  key: string,
  target: EventTarget | null,
  canSubmit: boolean,
): boolean {
  if (!canSubmit || key !== 'Enter' || !(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target.closest('.tiptap-editor') ||
    target instanceof HTMLTextAreaElement
  ) {
    return false;
  }

  return (
    target instanceof HTMLInputElement &&
    SUBMITTABLE_INPUT_TYPES.has(target.type)
  );
}

/** Props the MarkdownEditor lazy-loaded component expects. */
export type MarkdownEditorProps = {
  value: string;
  placeholder?: string;
  focusOnMount?: boolean;
};

export async function loadMarkdownEditorComponent(): Promise<
  Component<MarkdownEditorProps>
> {
  const module = await import('../components/MarkdownEditor.svelte');
  return module.default;
}

export function shouldLoadMarkdownEditor(
  type: InboxItemType,
  mode: 'visual' | 'write' | 'preview',
  componentLoaded: boolean,
  loadError: boolean,
): boolean {
  return type === 'note' && mode === 'visual' && !componentLoaded && !loadError;
}

export function canCaptureTodo(title: string): boolean {
  return title.trim().length > 0;
}

export function makeUnfiledTodo(
  title: string,
  now: Date = new Date(),
  id: string = crypto.randomUUID(),
): TodoItem {
  return {
    id,
    type: 'todo',
    title: title.trim(),
    createdAt: now.toISOString(),
    completed: false,
    isTodo: true,
  };
}

export function shouldShowCollectionPicker(
  isEdit: boolean,
  type: InboxItemType,
  hasAnyCollection: boolean,
): boolean {
  return !isEdit && (type !== 'todo' || hasAnyCollection);
}
