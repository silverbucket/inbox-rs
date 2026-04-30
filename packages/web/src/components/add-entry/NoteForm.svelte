<script lang="ts">
  import type { Component } from 'svelte';
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import {
    type BuildItemFn,
    loadMarkdownEditorComponent,
    type MarkdownEditorProps,
    shouldLoadMarkdownEditor,
  } from '../../lib/add-entry-modal';
  import { buildNoteItem } from '../../lib/build-item';
  import { createCodeKeydownHandler } from '../../lib/code-indent';
  import { renderMarkdown } from '../../lib/markdown';

  let {
    editItem,
    canSubmit = $bindable(false),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
    canSubmit?: boolean;
    buildItem?: BuildItemFn;
  } = $props();

  let title = $state(editItem?.title ?? '');
  let body = $state(editItem && 'body' in editItem ? (editItem.body ?? '') : '');
  let description = $state(editItem?.description ?? '');

  let editorMode = $state<'visual' | 'write' | 'preview'>('visual');
  let MarkdownEditorComponent = $state<Component<MarkdownEditorProps> | null>(
    null,
  );
  let markdownEditorLoadError = $state('');
  let previewHtml = $state('');

  const handleCodeKeydown = createCodeKeydownHandler();

  // A note is captureable as soon as the user has typed a title or any body.
  $effect(() => {
    canSubmit = !!(title || body);
  });

  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildNoteItem(
      { id, createdAt, editItem: ctxEditItem },
      { title, body, description },
    );

  // Lazy-load the visual editor on demand: it pulls in TipTap and friends
  // (~hundreds of KB) and only ~60% of users open the note modal in any
  // given session. Falls back to the markdown textarea if loading fails so
  // the user can still capture content.
  $effect(() => {
    if (
      !shouldLoadMarkdownEditor(
        'note',
        editorMode,
        !!MarkdownEditorComponent,
        !!markdownEditorLoadError,
      )
    ) {
      return;
    }

    let cancelled = false;

    loadMarkdownEditorComponent()
      .then((component) => {
        if (!cancelled) {
          MarkdownEditorComponent = component;
        }
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

  // Render markdown preview asynchronously. Re-checks `body === currentBody`
  // before applying the rendered HTML so a stale render from a previous body
  // value doesn't overwrite a fresher one.
  $effect(() => {
    if (editorMode !== 'preview') {
      previewHtml = '';
      return;
    }

    const currentBody = body;
    let cancelled = false;

    renderMarkdown(currentBody)
      .then((html) => {
        if (!cancelled && body === currentBody && editorMode === 'preview') {
          previewHtml = html;
        }
      })
      .catch(() => {
        if (!cancelled) {
          previewHtml = '';
        }
      });

    return () => {
      cancelled = true;
    };
  });
</script>

<label class="field">
  <span>Title</span>
  <!--
    Title is autofocused for the note modal too. The visual editor below is
    async-loaded and doesn't autofocus on mount, so without this the user
    opens the modal and lands on no field at all. When in `write` (Markdown)
    mode the body textarea also has `use:autofocus` and runs later in the
    DOM, so it wins the focus race and the user lands in the editor —
    which is what they want once they've explicitly switched to Markdown
    mode.
  -->
  <input use:autofocus type="text" bind:value={title} placeholder="Note title" />
</label>
<div class="field note-editor-field">
  <div class="field-header">
    <span>Content</span>
    <div class="editor-tabs">
      <button
        type="button"
        class="tab"
        class:active={editorMode === 'visual'}
        onclick={() => (editorMode = 'visual')}
        disabled={!!markdownEditorLoadError}>Visual</button
      >
      <button
        type="button"
        class="tab"
        class:active={editorMode === 'write'}
        onclick={() => (editorMode = 'write')}>Markdown</button
      >
      <button
        type="button"
        class="tab"
        class:active={editorMode === 'preview'}
        onclick={() => (editorMode = 'preview')}>Preview</button
      >
    </div>
  </div>
  {#if editorMode === 'visual'}
    {#if MarkdownEditorComponent}
      <MarkdownEditorComponent bind:value={body} placeholder="Write your note..." />
    {:else if markdownEditorLoadError}
      <textarea
        use:autofocus
        class="code-input"
        bind:value={body}
        rows="10"
        placeholder="Write your note in Markdown..."
        onkeydown={handleCodeKeydown}
      ></textarea>
    {:else}
      <div class="editor-loading" aria-live="polite">Loading visual editor…</div>
    {/if}
  {:else if editorMode === 'write'}
    <textarea
      use:autofocus
      class="code-input"
      bind:value={body}
      rows="10"
      placeholder="Write your note in Markdown..."
      onkeydown={handleCodeKeydown}
    ></textarea>
  {:else}
    <div class="preview-wrap markdown-body">
      {#if previewHtml}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html previewHtml}
      {:else if body.trim()}
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
