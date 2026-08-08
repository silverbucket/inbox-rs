<script lang="ts">
  import type { Component } from 'svelte';
  import { autofocus } from '../../lib/actions';
  import {
    loadMarkdownEditorComponent,
    type MarkdownEditorProps,
  } from '../../lib/add-entry-modal';
  import { createCodeKeydownHandler } from '../../lib/code-indent';
  import { renderMarkdown } from '../../lib/markdown';

  let {
    value = $bindable(''),
    label = 'Content',
    placeholder = 'Write your note...',
    focusOnMount = false,
  }: {
    value?: string;
    label?: string;
    placeholder?: string;
    focusOnMount?: boolean;
  } = $props();

  let editorMode = $state<'visual' | 'write' | 'preview'>('visual');
  let MarkdownEditorComponent = $state<Component<MarkdownEditorProps> | null>(
    null,
  );
  let markdownEditorLoadError = $state('');
  let previewHtml = $state('');

  const handleCodeKeydown = createCodeKeydownHandler();

  $effect(() => {
    if (
      editorMode !== 'visual' ||
      MarkdownEditorComponent ||
      markdownEditorLoadError
    ) {
      return;
    }

    let cancelled = false;
    loadMarkdownEditorComponent()
      .then((component) => {
        if (!cancelled) MarkdownEditorComponent = component;
      })
      .catch((loadError) => {
        console.error('Failed to load markdown editor:', loadError);
        if (!cancelled) {
          markdownEditorLoadError =
            'Visual editor unavailable. Markdown mode is still available.';
          editorMode = 'write';
        }
      });

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (editorMode !== 'preview') {
      previewHtml = '';
      return;
    }

    const currentValue = value;
    let cancelled = false;
    renderMarkdown(currentValue)
      .then((html) => {
        if (!cancelled && value === currentValue && editorMode === 'preview') {
          previewHtml = html;
        }
      })
      .catch(() => {
        if (!cancelled) previewHtml = '';
      });

    return () => {
      cancelled = true;
    };
  });
</script>

<div class="field note-editor-field">
  <div class="field-header">
    <span>{label}</span>
    <div class="editor-tabs">
      <button type="button" class="tab" class:active={editorMode === 'visual'} onclick={() => (editorMode = 'visual')} disabled={!!markdownEditorLoadError}>Visual</button>
      <button type="button" class="tab" class:active={editorMode === 'write'} onclick={() => (editorMode = 'write')}>Markdown</button>
      <button type="button" class="tab" class:active={editorMode === 'preview'} onclick={() => (editorMode = 'preview')}>Preview</button>
    </div>
  </div>
  {#if editorMode === 'visual'}
    {#if MarkdownEditorComponent}
      <MarkdownEditorComponent bind:value {placeholder} {focusOnMount} />
    {:else if markdownEditorLoadError}
      <textarea use:autofocus class="code-input" bind:value rows="10" {placeholder} onkeydown={handleCodeKeydown}></textarea>
    {:else}
      <div class="editor-loading" aria-live="polite">Loading visual editor…</div>
    {/if}
  {:else if editorMode === 'write'}
    <textarea use:autofocus class="code-input" bind:value rows="10" {placeholder} onkeydown={handleCodeKeydown}></textarea>
  {:else}
    <div class="preview-wrap markdown-body">
      {#if previewHtml}
        {@html previewHtml}
      {:else if value.trim()}
        <span class="preview-empty">Preview unavailable</span>
      {:else}
        <span class="preview-empty">Nothing to preview</span>
      {/if}
    </div>
  {/if}
</div>
{#if markdownEditorLoadError}
  <p class="info-note">{markdownEditorLoadError}</p>
{/if}
