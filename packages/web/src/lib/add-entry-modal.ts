import type { Component } from 'svelte';

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
