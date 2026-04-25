import type { Component } from 'svelte';
import type { InboxItem, InboxItemType } from '@inbox-rs/rs-module';

const SUBMITTABLE_INPUT_TYPES = new Set(['text', 'url', 'email', 'search', 'tel']);

export function shouldSubmitAddEntryForm(
  key: string,
  target: EventTarget | null,
  canSubmit: boolean,
): boolean {
  if (!canSubmit || key !== 'Enter' || !(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest('.tiptap-editor') || target instanceof HTMLTextAreaElement) {
    return false;
  }

  return target instanceof HTMLInputElement && SUBMITTABLE_INPUT_TYPES.has(target.type);
}

export async function loadMarkdownEditorComponent(): Promise<Component<any>> {
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
): InboxItem {
  return {
    id,
    type: 'todo',
    title: title.trim(),
    createdAt: now.toISOString(),
    completed: false,
    isTodo: true,
  };
}

export function normalizeInitialCollectionId(
  type: InboxItemType,
  collectionId: string | undefined,
  uncategorizedCollectionId: string,
): string | undefined {
  if (type === 'todo' && collectionId === uncategorizedCollectionId) return undefined;
  return collectionId;
}

export function shouldShowCollectionPicker(
  isEdit: boolean,
  type: InboxItemType,
  hasAnyCollection: boolean,
  selectedCollectionId: string | undefined,
  uncategorizedCollectionId: string,
): boolean {
  return !isEdit && (type !== 'todo' || hasAnyCollection || selectedCollectionId === uncategorizedCollectionId);
}

export function shouldMarkUncategorized(
  isEdit: boolean,
  type: InboxItemType,
  selectedCollectionId: string | undefined,
  uncategorizedCollectionId: string,
): boolean {
  return !isEdit && type !== 'todo' && selectedCollectionId === uncategorizedCollectionId;
}
