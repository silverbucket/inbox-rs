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
    onchange = undefined,
  }: {
    value?: string;
    label?: string;
    placeholder?: string;
    focusOnMount?: boolean;
    onchange?: () => void;
  } = $props();

  let editorMode = $state<'visual' | 'write' | 'preview'>('visual');
  let MarkdownEditorComponent = $state<Component<MarkdownEditorProps> | null>(
    null,
  );
  let markdownEditorLoadError = $state('');
  let previewHtml = $state('');

  const handleCodeKeydown = createCodeKeydownHandler();
  let previousValue = value;

  $effect(() => {
    const currentValue = value;
    if (currentValue === previousValue) return;
    previousValue = currentValue;
    onchange?.();
  });

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

<style>
  .field {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 0;
  }

  .field-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .field-header > span {
    color: var(--text-muted);
    font-size: 0.78rem;
    font-weight: 500;
  }

  .editor-tabs {
    display: flex;
    gap: 0.25rem;
  }

  .tab {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
  }

  .tab:hover {
    color: var(--text);
  }

  .tab.active {
    border-color: var(--border);
    background: var(--surface-hover);
    color: var(--accent);
  }

  .tab:disabled {
    cursor: default;
    opacity: 0.45;
  }

  textarea {
    flex: 1;
    min-height: 16rem;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    font-size: 1rem;
    line-height: 1.55;
    padding: 0.9rem;
  }

  textarea:focus {
    border-color: var(--accent);
    outline: none;
  }

  .editor-loading,
  .preview-wrap {
    flex: 1;
    min-height: 16rem;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    padding: 0.9rem;
  }

  .editor-loading {
    display: grid;
    place-items: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .preview-empty,
  .info-note {
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  :global(.tiptap-wrap .tiptap-editor) {
    min-height: 16rem;
  }
</style>
