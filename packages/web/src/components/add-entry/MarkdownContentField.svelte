<script lang="ts">
  import type { Component } from 'svelte';
  import { autofocus } from '../../lib/actions';
  import {
    loadMarkdownEditorComponent,
    type MarkdownEditorHandle,
    type MarkdownEditorProps,
  } from '../../lib/add-entry-modal';
  import { createCodeKeydownHandler } from '../../lib/code-indent';
  import { liveItemLinks } from '../../lib/item-link-live';
  import { renderMarkdown } from '../../lib/markdown';

  let {
    value = $bindable(''),
    label = 'Content',
    placeholder = 'Write your note...',
    focusOnMount = false,
    selfId = undefined,
    onchange = undefined,
  }: {
    value?: string;
    label?: string;
    placeholder?: string;
    focusOnMount?: boolean;
    /** The item being edited, left out of the item-link picker. */
    selfId?: string;
    onchange?: () => void;
  } = $props();

  let editorMode = $state<'visual' | 'write' | 'preview'>('visual');
  let MarkdownEditorComponent = $state<Component<
    MarkdownEditorProps,
    MarkdownEditorHandle
  > | null>(null);
  let markdownEditor = $state<MarkdownEditorHandle>();
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
      {#if editorMode === 'visual' && MarkdownEditorComponent}
        <!-- mousedown is cancelled so the editor keeps its cursor position. -->
        <button
          type="button"
          class="tab link-item"
          title="Link to another item (or type [[ )"
          aria-label="Link item"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => markdownEditor?.linkItem()}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"></path><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"></path></svg>
          <span class="link-item-label">Link item</span>
        </button>
      {/if}
      <button type="button" class="tab" class:active={editorMode === 'visual'} onclick={() => (editorMode = 'visual')} disabled={!!markdownEditorLoadError}>Visual</button>
      <button type="button" class="tab" class:active={editorMode === 'write'} onclick={() => (editorMode = 'write')}>Markdown</button>
      <button type="button" class="tab" class:active={editorMode === 'preview'} onclick={() => (editorMode = 'preview')}>Preview</button>
    </div>
  </div>
  {#if editorMode === 'visual'}
    {#if MarkdownEditorComponent}
      <MarkdownEditorComponent bind:this={markdownEditor} bind:value {placeholder} {focusOnMount} {selfId} />
    {:else if markdownEditorLoadError}
      <textarea use:autofocus class="code-input" bind:value rows="10" {placeholder} onkeydown={handleCodeKeydown}></textarea>
    {:else}
      <div class="editor-loading" aria-live="polite">Loading visual editor…</div>
    {/if}
  {:else if editorMode === 'write'}
    <textarea use:autofocus class="code-input" bind:value rows="10" {placeholder} onkeydown={handleCodeKeydown}></textarea>
  {:else}
    <div class="preview-wrap markdown-body" use:liveItemLinks>
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
    color: var(--accent-text);
  }

  .tab.link-item {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-right: 0.5rem;
    white-space: nowrap;
  }

  /* Phone width: the three tabs need the room; the icon carries it. */
  @media (max-width: 480px) {
    .link-item-label {
      display: none;
    }
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
