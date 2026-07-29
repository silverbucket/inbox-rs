<script lang="ts">
  import type { InboxItem, InboxItemType } from '@inbox-rs/rs-module';
  import {
    storeItem,
    moveItemToCollection,
    removeFile,
    sortedGroups,
    groupCollections,
  } from '../lib/stores';
  import {
    type BuildItemFn,
    shouldShowCollectionPicker,
    shouldSubmitAddEntryForm,
  } from '../lib/add-entry-modal';
  import { enrichBookmark, needsEnrichment } from '../lib/enrich';
  import type { FilingSubject } from '../lib/collection-suggest';
  import CollectionPicker from './CollectionPicker.svelte';
  import BookmarkForm from './add-entry/BookmarkForm.svelte';
  import NoteForm from './add-entry/NoteForm.svelte';
  import ImageForm from './add-entry/ImageForm.svelte';
  import AudioForm from './add-entry/AudioForm.svelte';
  import DocumentForm from './add-entry/DocumentForm.svelte';
  import EmailForm from './add-entry/EmailForm.svelte';
  import TodoForm from './add-entry/TodoForm.svelte';

  let {
    type,
    editItem = undefined,
    collectionId = undefined,
    prefillTitle = '',
    prefillFile = undefined,
    onclose,
    ondelete,
  }: {
    type: InboxItemType;
    editItem?: InboxItem;
    collectionId?: string;
    prefillTitle?: string;
    prefillFile?: File;
    onclose: () => void;
    ondelete?: (item: InboxItem) => void;
  } = $props();

  const isEdit = !!editItem;
  let saving = $state(false);
  let error = $state('');

  // Each per-type form sets these via $bindable. The shell stays unaware
  // of how the item is constructed — it just calls `buildItem` on Save and
  // reads `formCanSubmit` to gate the action button.
  let formCanSubmit = $state(false);
  let formBuildItem = $state<BuildItemFn | undefined>(undefined);

  // Initial destination for new items: honour the caller's explicit
  // `collectionId` prop (e.g. a collection quick-add button), otherwise leave
  // unset. For todos, unset means "unfiled" — we deliberately don't
  // auto-select organization so capture stays frictionless. For refs, unset
  // means Inbox.
  let selectedCollectionId = $state<string | undefined>(collectionId);
  let collectionPickerOpen = $state(false);
  // For refs, `undefined` means Inbox. For todos, `undefined` means unfiled:
  // no collectionId is written, and the todo stays available to organize
  // later without creating any synthetic group or collection.
  const isTodoType = $derived(type === 'todo');
  const noCollectionLabel = 'Inbox';

  // `undefined` is the non-collection sentinel: Inbox for refs, unfiled for
  // todos.
  const collectionLabel = $derived.by(() => {
    if (selectedCollectionId === undefined) {
      return isTodoType ? 'Unfiled' : noCollectionLabel;
    }
    for (const group of $sortedGroups) {
      const cols = $groupCollections[group.id] ?? [];
      const found = cols.find((c) => c.id === selectedCollectionId);
      if (found) return found.name;
    }
    return isTodoType ? 'Unfiled' : noCollectionLabel;
  });

  // Whether the user has any real grouped collections at all. Todo capture
  // hides the picker entirely when this is false so an empty account can still
  // jot things down immediately.
  const hasAnyCollection = $derived.by(() => {
    for (const group of $sortedGroups) {
      if (($groupCollections[group.id] ?? []).length > 0) return true;
    }
    return false;
  });

  const showCollectionPicker = $derived(
    shouldShowCollectionPicker(isEdit, type, hasAnyCollection),
  );

  const addLabels: Record<InboxItemType, string> = {
    bookmark: 'Add Bookmark',
    note: 'Add Note',
    image: 'Add Image',
    audio: 'Add Audio',
    video: 'Add Video',
    document: 'Add File',
    todo: 'Add Todo',
    email: 'Add Email',
  };

  const editLabels: Record<InboxItemType, string> = {
    bookmark: 'Edit Bookmark',
    note: 'Edit Note',
    image: 'Edit Image',
    audio: 'Edit Audio',
    video: 'Edit Video',
    document: 'Edit File',
    todo: 'Edit Todo',
    email: 'Edit Email',
  };

  function selectCollection(id: string | undefined) {
    selectedCollectionId = id;
    collectionPickerOpen = false;
  }

  /**
   * What the CollectionPicker files. The item doesn't exist yet, so this is
   * a lightweight subject: no title/url means content-based suggestions
   * degrade gracefully to recency, and `collectionId` reflects the pending
   * selection so the picker excludes it from the list and offers the
   * Inbox/Unfiled row to clear it.
   */
  const pickerSubject = $derived<FilingSubject>({
    id: editItem?.id,
    title: '',
    collectionId: selectedCollectionId,
    isTodo: isTodoType,
  });

  async function handleSubmit() {
    if (!formBuildItem || !formCanSubmit) return;
    saving = true;
    error = '';
    try {
      const id = isEdit ? (editItem?.id ?? crypto.randomUUID()) : crypto.randomUUID();
      const createdAt = isEdit
        ? (editItem?.createdAt ?? new Date().toISOString())
        : new Date().toISOString();
      const result = await formBuildItem({ id, createdAt, isEdit, editItem });
      if (!result) return;
      const { item, fileData, thumbData, removePaths } = result;

      // Preserve todo fields when editing non-todo types (converted items).
      // For actual todo types, the form's completed checkbox is the source
      // of truth and already wrote whatever it needs.
      if (isEdit && type !== 'todo') {
        if (editItem?.isTodo) item.isTodo = true;
        if (editItem?.completed) item.completed = editItem?.completed;
        if (editItem?.completedAt) item.completedAt = editItem?.completedAt;
      }

      // Picker → storage shape:
      //   undefined + ref         → Inbox (default; no flag, no collectionId)
      //   undefined + todo        → unfiled todo (no collectionId, no fake
      //                              collection/group written)
      //   real id                 → assign via moveItemToCollection after storage
      await storeItem(item, fileData, thumbData);
      // Clean up files this edit orphaned (e.g. a previous thumbnail that the
      // replacement image no longer produces). Best-effort; never blocks save.
      if (removePaths) {
        for (const path of removePaths) await removeFile(path);
      }
      if (selectedCollectionId && !isEdit) {
        await moveItemToCollection(item.id, selectedCollectionId);
      }
      // Fill blank bookmark fields (title, description, preview image) from
      // the page's metadata in the background. New items only — an edit is
      // the user deliberately setting fields, and the view card offers a
      // manual fetch for older bookmarks.
      if (!isEdit && item.type === 'bookmark' && needsEnrichment(item)) {
        void enrichBookmark(item).catch(() => {});
      }
      onclose();
    } catch (e) {
      console.error('Save failed:', e);
      error =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : String(e) || 'Failed to save';
    } finally {
      saving = false;
    }
  }
</script>

<!--
  Window-level Escape handler — closes the modal so the user can dismiss it
  from anywhere (including textareas and rich editors that might otherwise
  swallow keys). When the collection picker is open, ESC closes the picker
  first instead of dropping the user out of the whole modal — matches what
  users expect from layered overlays elsewhere in the app.
-->
<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if (collectionPickerOpen) {
      collectionPickerOpen = false;
      return;
    }
    onclose();
  }}
/>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div
    class="modal"
    class:modal-note={type === 'note'}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    onclick={(e) => e.stopPropagation()}
  >
    <h2 class="modal-title" id="modal-title">
      {isEdit ? editLabels[type] : addLabels[type]}
    </h2>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="form"
      onkeydown={(e) => {
        if (shouldSubmitAddEntryForm(e.key, e.target, formCanSubmit && !saving)) {
          e.preventDefault();
          handleSubmit();
        }
      }}
    >
      {#if type === 'bookmark'}
        <BookmarkForm
          {editItem}
          bind:canSubmit={formCanSubmit}
          bind:buildItem={formBuildItem}
        />
      {:else if type === 'note'}
        <NoteForm
          {editItem}
          {prefillTitle}
          bind:canSubmit={formCanSubmit}
          bind:buildItem={formBuildItem}
        />
      {:else if type === 'image'}
        <ImageForm
          {editItem}
          {prefillFile}
          bind:canSubmit={formCanSubmit}
          bind:buildItem={formBuildItem}
        />
      {:else if type === 'audio'}
        <AudioForm
          {editItem}
          bind:canSubmit={formCanSubmit}
          bind:buildItem={formBuildItem}
        />
      {:else if type === 'document'}
        <DocumentForm
          {editItem}
          {prefillFile}
          bind:canSubmit={formCanSubmit}
          bind:buildItem={formBuildItem}
        />
      {:else if type === 'email'}
        <EmailForm
          {editItem}
          bind:canSubmit={formCanSubmit}
          bind:buildItem={formBuildItem}
        />
      {:else if type === 'todo'}
        <TodoForm
          {editItem}
          {prefillTitle}
          bind:canSubmit={formCanSubmit}
          bind:buildItem={formBuildItem}
        />
      {/if}

      {#if showCollectionPicker}
        <div class="field">
          <span>{isTodoType ? 'File in' : 'Collection'}</span>
          <button
            type="button"
            class="dest-trigger"
            onclick={() => (collectionPickerOpen = true)}
            aria-haspopup="dialog"
            aria-expanded={collectionPickerOpen}
          >
            <span class="dest-label">{collectionLabel}</span>
            <svg
              aria-hidden="true"
              class="dest-chevron"
              class:open={collectionPickerOpen}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        {#if isEdit && ondelete && editItem}
          <button
            type="button"
            class="btn-delete-item"
            disabled={saving}
            onclick={() => editItem && ondelete?.(editItem)}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="3 6 5 6 21 6"></polyline>
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              ></path>
            </svg>
            Delete
          </button>
        {/if}
        <button type="button" class="btn-cancel" onclick={onclose}>Cancel</button>
        <button
          type="button"
          class="btn-save"
          disabled={!formCanSubmit || saving}
          onclick={handleSubmit}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>

    {#if collectionPickerOpen}
      <CollectionPicker
        item={pickerSubject}
        mode={isTodoType ? 'todo' : 'move'}
        onpick={selectCollection}
        onclose={() => (collectionPickerOpen = false)}
      />
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--overlay);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 3rem 1rem;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 480px;
    padding: 1.5rem;
    margin-left: auto;
    margin-right: auto;
  }

  @media (max-width: 600px), (display-mode: standalone) {
    .overlay {
      padding: env(safe-area-inset-top) env(safe-area-inset-right)
        env(safe-area-inset-bottom) env(safe-area-inset-left);
      background: var(--bg);
    }

    .modal {
      max-width: none;
      min-height: 100%;
      border: none;
      border-radius: 0;
    }
  }

  .modal-note {
    max-width: 720px;
    height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-note .form {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .modal-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  /*
   * Form-field styles. Per-type form components render `.field` / `.info-note`
   * / `.error` / etc. into the modal's DOM. Because Svelte CSS is scoped per
   * component, a child component's plain `.field` selector wouldn't match
   * styles defined here unless we mark them `:global`. They're scoped under
   * `.form` so the leak stays bounded to this modal's children.
   */
  .form :global(.field) {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.75rem;
  }

  .form :global(.field span) {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .form :global(.checkbox-field) {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  .form :global(.checkbox-field input[type='checkbox']) {
    accent-color: var(--accent);
  }

  .form :global(input[type='text']),
  .form :global(input[type='url']),
  .form :global(textarea) {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    /* Keep at >=1rem to avoid iOS Safari focus-zoom on touch devices. */
    font-size: 1rem;
    color: var(--text);
    font-family: inherit;
    resize: vertical;
  }

  .form :global(input[type='text']:focus),
  .form :global(input[type='url']:focus),
  .form :global(textarea:focus) {
    outline: none;
    border-color: var(--accent);
  }

  .form :global(input[type='file']) {
    /* Keep at >=1rem for consistency with the other form controls. iOS doesn't
       zoom on file inputs specifically, but the floor applies repo-wide. */
    font-size: 1rem;
    color: var(--text-muted);
  }

  /* Name of a file pre-attached from the capture bar (the native input can't
     reflect a programmatically-set file). */
  .form :global(.picked) {
    font-size: 0.82rem;
    color: var(--accent);
    font-weight: 500;
    word-break: break-all;
  }

  .form :global(.auto-expand) {
    resize: vertical;
    min-height: 4.5em;
    max-height: 50vh;
    overflow-y: auto;
    field-sizing: content;
  }

  .form :global(.code-input) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    /* `.code-input` is applied to a <textarea>; keep >=1rem to avoid iOS
       Safari focus-zoom on touch devices. */
    font-size: 1rem;
    line-height: 1.5;
    tab-size: 2;
  }

  .form :global(.editor-loading) {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 14rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .form :global(.preview-wrap) {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    overflow-y: auto;
    min-height: 0;
  }

  .form :global(.preview-empty) {
    color: var(--text-muted);
    font-style: italic;
    font-size: 0.85rem;
  }

  .form :global(.info-note) {
    font-size: 0.8rem;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    margin: 0 0 0.75rem;
    line-height: 1.5;
  }

  .form :global(.error) {
    color: #ef4444;
    font-size: 0.8rem;
    margin: 0;
  }

  .form :global(.recorder) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .form :global(.recorder audio) {
    flex: 1;
    height: 36px;
  }

  .form :global(.rec-indicator) {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ef4444;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .form :global(.rec-timer) {
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  .form :global(.rec-btn) {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .form :global(.rec-btn:hover) {
    border-color: var(--accent);
  }

  .form :global(.rec-start) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .form :global(.rec-stop) {
    border-color: #ef4444;
    color: #ef4444;
  }

  .form :global(.rec-discard) {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .form :global(.transcript-status) {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
    font-style: italic;
  }

  .form :global(.transcript) {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    white-space: pre-wrap;
    margin: 0;
  }

  .form :global(.field-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .form :global(.editor-tabs) {
    display: flex;
    gap: 0.25rem;
  }

  .form :global(.tab) {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.7rem;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .form :global(.tab:hover) {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .form :global(.tab.active) {
    color: var(--accent);
    border-color: var(--accent);
  }

  .form :global(.note-editor-field) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .form :global(.markdown-body) {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    word-break: break-word;
  }

  .form :global(.markdown-body h1) {
    font-size: 1.3rem;
    font-weight: 600;
    margin: 0.75rem 0 0.4rem;
  }
  .form :global(.markdown-body h2) {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0.6rem 0 0.35rem;
  }
  .form :global(.markdown-body h3) {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0.5rem 0 0.3rem;
  }
  .form :global(.markdown-body p) {
    margin: 0 0 0.5rem;
  }
  .form :global(.markdown-body p:last-child) {
    margin-bottom: 0;
  }
  .form :global(.markdown-body ul),
  .form :global(.markdown-body ol) {
    padding-left: 1.5rem;
    margin: 0 0 0.5rem;
  }
  .form :global(.markdown-body ul) {
    list-style: disc;
  }
  .form :global(.markdown-body ol) {
    list-style: decimal;
  }
  .form :global(.markdown-body li) {
    margin-bottom: 0.15rem;
  }
  .form :global(.markdown-body blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 0.75rem;
    margin: 0 0 0.5rem;
    color: var(--text-muted);
  }
  .form :global(.markdown-body a) {
    color: var(--accent);
    text-decoration: none;
  }
  .form :global(.markdown-body a:hover) {
    text-decoration: underline;
  }
  .form :global(.markdown-body code) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }
  .form :global(.markdown-body pre) {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin: 0 0 0.5rem;
    overflow-x: auto;
  }
  .form :global(.markdown-body pre code) {
    background: none;
    padding: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #e6edf3;
  }
  .form :global(.markdown-body hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.75rem 0;
  }
  .form :global(.markdown-body strong) {
    font-weight: 600;
  }
  .form :global(.markdown-body em) {
    font-style: italic;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .btn-delete-item {
    margin-right: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--danger, #ef4444);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: background 0.15s, border-color 0.15s;
  }

  .btn-delete-item:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent 90%);
    border-color: var(--danger, #ef4444);
  }

  .btn-delete-item:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn-cancel:hover {
    border-color: var(--text-muted);
  }

  .btn-save {
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-save:hover {
    opacity: 0.9;
  }

  .btn-save:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .dest-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s;
    white-space: nowrap;
  }

  .dest-trigger:hover {
    border-color: var(--accent);
  }

  .dest-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
    color: var(--text);
    font-weight: 400;
  }

  .dest-chevron {
    transition: transform 150ms;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .dest-chevron.open {
    transform: rotate(180deg);
  }
</style>
