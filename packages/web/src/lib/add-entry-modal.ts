import type { Component } from 'svelte';
import type { InboxItemType } from '@inbox-rs/rs-module';

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
