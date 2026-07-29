<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import {
    collections,
    deleteItem,
    groups,
    moveItemToCollection,
    storeItem,
  } from '../lib/stores';
  import { recordCollectionUse } from '../lib/collection-suggest';
  import { showToast } from '../lib/toast';
  import ShareButton from './ShareButton.svelte';
  import CollectionPicker from './CollectionPicker.svelte';
  import DeleteConfirm from './DeleteConfirm.svelte';
  import BookmarkView from './view-card/BookmarkView.svelte';
  import NoteView from './view-card/NoteView.svelte';
  import ImageView from './view-card/ImageView.svelte';
  import AudioView from './view-card/AudioView.svelte';
  import DocumentView from './view-card/DocumentView.svelte';
  import EmailView from './view-card/EmailView.svelte';
  import TodoView from './view-card/TodoView.svelte';

  let {
    item,
    onclose,
    onedit,
  }: {
    item: InboxItem;
    onclose: () => void;
    onedit: (item: InboxItem) => void;
  } = $props();

  const TITLE_ID = 'view-modal-title';

  let showDelete = $state(false);
  let deleting = $state(false);

  // One CollectionPicker serves both flows: re-filing the card ('move') and
  // choosing where a converted todo lands ('todo').
  let showPicker = $state(false);
  let pickerMode = $state<'move' | 'todo'>('move');

  let convertingTodo = $state(false);
  let convertingRef = $state(false);

  async function handleDelete() {
    deleting = true;
    await deleteItem(item.id, item);
    showDelete = false;
    deleting = false;
    onclose();
  }

  /** Promote the current item to an unfiled todo. */
  async function convertToUnfiledTodo() {
    convertingTodo = true;
    try {
      const { completedAt: _, ...rest } = item;
      await moveItemToCollection(item.id, undefined);
      // Strip collectionId so the converted todo lands in Unfiled. Cast to
      // Record<string,unknown> for the structural mutation, then back to
      // InboxItem when we're done.
      const updated: Record<string, unknown> = {
        ...rest,
        isTodo: true,
        completed: false,
      };
      delete updated.collectionId;
      await storeItem(updated as unknown as InboxItem);
      showPicker = false;
      onclose();
    } catch (error) {
      console.error('Failed to convert to unfiled todo', error);
      showToast('Failed to convert to todo');
    } finally {
      convertingTodo = false;
    }
  }

  /** Promote the current item to a todo and file it into the chosen collection. */
  async function convertToTodoInCollection(collectionId: string) {
    convertingTodo = true;
    try {
      // Snapshot the rest of the item BEFORE we do any writes — once we move
      // the item, the store reflects the new collectionId and the prop might
      // be re-read as a different object, so working off a local copy keeps
      // the todo flip deterministic.
      const { completedAt: _, ...rest } = item;
      // Route the collection change through moveItemToCollection FIRST. The
      // helper reads the item's current collectionId from the store to know
      // which source collection's itemIds to scrub. If we store the new
      // collectionId via storeItem first, moveItemToCollection would see the
      // target collection as the source and never remove the item from the
      // original collection's itemIds — leaving stale membership behind that
      // later collection operations can trip over.
      await moveItemToCollection(item.id, collectionId);
      // Now flip the todo flags. storeItem only touches the item doc — the
      // itemIds arrays are already reconciled by the move above.
      const updated = {
        ...rest,
        isTodo: true,
        completed: false,
        collectionId,
      };
      await storeItem(updated as InboxItem);
      recordCollectionUse(collectionId);
      showPicker = false;
      onclose();
    } catch (error) {
      console.error('Failed to convert to todo', error);
      showToast('Failed to convert to todo');
    } finally {
      convertingTodo = false;
    }
  }

  async function convertToReference() {
    convertingRef = true;
    try {
      // Cast to Record<string,unknown> for the structural rewrite below —
      // we're deleting and re-typing fields, which the discriminated InboxItem
      // union actively prevents at the type level.
      const updated: Record<string, unknown> = { ...item };
      delete updated.isTodo;
      delete updated.completed;
      delete updated.completedAt;
      // type: 'todo' items require `completed` in the schema — convert to note
      if (updated.type === 'todo') {
        updated.type = 'note';
        if (!updated.body) updated.body = '';
      }
      await storeItem(updated as unknown as InboxItem);
      onclose();
    } finally {
      convertingRef = false;
    }
  }

  const canMakeTodo = $derived(item.type !== 'todo' && !item.isTodo);
  const canMakeRef = $derived(item.isTodo || item.type === 'todo');

  function openMovePicker() {
    pickerMode = 'move';
    showPicker = true;
  }

  function openMakeTodoPicker() {
    pickerMode = 'todo';
    showPicker = true;
  }

  /** Route the picker's choice to the flow that opened it. */
  function handlePick(collectionId: string | undefined) {
    if (pickerMode === 'todo') {
      // Conversion closes the picker + modal itself on success so a failure
      // can leave both open for a retry.
      if (collectionId) {
        void convertToTodoInCollection(collectionId);
      } else {
        void convertToUnfiledTodo();
      }
      return;
    }
    showPicker = false;
    moveItemToCollection(item.id, collectionId)
      .then(() => {
        if (collectionId) recordCollectionUse(collectionId);
      })
      .catch((e) => {
        console.error('Move failed:', e);
        showToast('Move failed');
      });
    onclose();
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // The discriminated union narrows nicely on `item.type === 'X'`, but a few
  // shared trailing sections (notes/description/share) want to peek at
  // optional fields without forcing the per-type branches. Use a Record cast
  // for those structural reads.
  const description = $derived(item.description);
  const hasFile = $derived(
    'filePath' in item && !!(item as unknown as Record<string, unknown>).filePath,
  );

  // ── Meta strip ─────────────────────────────────────────────────────────

  const isTodoish = $derived(item.isTodo || item.type === 'todo');

  /** Current home resolved to display parts (name, dot color, parent group). */
  const location = $derived.by(() => {
    const col = item.collectionId ? $collections[item.collectionId] : undefined;
    if (!col) {
      return {
        label: isTodoish ? 'Unfiled' : 'Inbox',
        color: '#9ca3af',
        group: undefined,
      };
    }
    return {
      label: col.name,
      color: col.color || '#6366f1',
      group: col.groupId ? $groups[col.groupId] : undefined,
    };
  });

  const wordCount = $derived.by(() => {
    if (!('body' in item)) return 0;
    const body = (item as unknown as Record<string, unknown>).body;
    if (typeof body !== 'string') return 0;
    const trimmed = body.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  });

  /** "Open · 3d" for pending todos, "Done" once completed. */
  const todoStatus = $derived.by(() => {
    if (!isTodoish) return '';
    if (item.completed) return 'Done';
    const days = Math.floor(
      (Date.now() - new Date(item.createdAt).getTime()) / 86_400_000,
    );
    return days < 1 ? 'Open · today' : `Open · ${days}d`;
  });

  /**
   * Window-level Escape handler. Defers to nested overlays when any are open
   * so Escape peels one layer at a time instead of collapsing the stack:
   *
   *   - DeleteConfirm, Lightbox: they register their own window handlers and
   *     will close themselves. We only need to keep *this* modal open so the
   *     user isn't unexpectedly dumped back to the card list.
   *   - CollectionPicker: it closes itself via its own window escape
   *     listener — we early-return so both layers don't close at once.
   *
   * Since `<svelte:window>` listeners fire in registration order, this outer
   * listener is registered first (parent mounts before children) and runs
   * before the nested ones — so checking state here is safe even though the
   * nested handlers will fire immediately after.
   */
  function handleWindowEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (showDelete || showPicker) return;
    onclose();
  }
</script>

<svelte:window onkeydown={handleWindowEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby={TITLE_ID}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="modal-header">
      <span class="type-badge">{item.type}</span>
      <time class="date">{formatDate(item.createdAt)}</time>
      <div class="header-actions">
        <button
          type="button"
          class="icon-btn icon-btn-danger"
          title="Delete"
          aria-label="Delete"
          onclick={() => (showDelete = true)}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
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
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Close"
          aria-label="Close"
          onclick={onclose}
        >
          <svg
            aria-hidden="true"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>

    <!--
      Per-type body. Each child renders the title (with type-specific link
      icon for bookmark/email) plus its own meta and main content. Wrapping
      in `{#key item.id}` resets per-type local state (audio transcribe
      flags, document blob URL caches, image lightbox state, etc.) when the
      user navigates between cards without forcing every child to write its
      own reset effect.
    -->
    {#key item.id}
      {#if item.type === 'bookmark'}
        <BookmarkView {item} titleId={TITLE_ID} />
      {:else if item.type === 'note'}
        <NoteView {item} titleId={TITLE_ID} />
      {:else if item.type === 'image'}
        <ImageView {item} titleId={TITLE_ID} />
      {:else if item.type === 'audio'}
        <AudioView {item} titleId={TITLE_ID} />
      {:else if item.type === 'document'}
        <DocumentView {item} titleId={TITLE_ID} />
      {:else if item.type === 'email'}
        <EmailView {item} titleId={TITLE_ID} />
      {:else if item.type === 'todo'}
        <TodoView {item} titleId={TITLE_ID} />
      {:else}
        <!--
          Generic fallback for item types without a dedicated view (e.g.
          `video`, which the rs-module schema reserves but the web UI
          doesn't yet render). Renders the title only so the modal still
          presents something legible — and so `aria-labelledby` always
          resolves to a real heading.
        -->
        <h2 class="title" id={TITLE_ID}>{item.title}</h2>
      {/if}
    {/key}

    {#if description}
      <div class="content-block">
        <span class="content-label">Description</span>
        <p class="content-text">{description}</p>
      </div>
    {/if}

    {#if hasFile}
      <div class="share-row">
        <ShareButton
          filePath={(item as unknown as Record<string, unknown>).filePath as string}
          mimeType={(item as unknown as Record<string, unknown>).mimeType as
            | string
            | undefined}
          filename={item.title || undefined}
        />
      </div>
    {/if}

    <div class="meta-strip">
      <span class="meta-item">
        <span class="loc-dot" style="background: {location.color}"></span>
        {#if location.group}
          <span
            class="meta-group"
            style="color: {location.group.color || 'var(--accent)'}"
            >{location.group.name}</span
          >
          <span aria-hidden="true">·</span>
        {/if}
        {location.label}
      </span>
      {#if wordCount > 0}
        <span class="meta-item">
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
          {wordCount}
          {wordCount === 1 ? 'word' : 'words'}
        </span>
      {/if}
      {#if todoStatus}
        <span class="meta-item">
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          {todoStatus}
        </span>
      {/if}
    </div>

    <button type="button" class="btn-file" onclick={openMovePicker}>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
        ></path>
      </svg>
      {item.collectionId ? 'Move to collection…' : 'File into collection…'}
    </button>

    <div class="action-list">
      {#if canMakeTodo}
        <button
          type="button"
          class="action-row"
          disabled={convertingTodo}
          onclick={openMakeTodoPicker}
        >
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
            ></path>
          </svg>
          Make a todo
        </button>
      {/if}
      {#if canMakeRef}
        <button
          type="button"
          class="action-row"
          disabled={convertingRef}
          onclick={convertToReference}
        >
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
            ></path>
          </svg>
          Make a reference
        </button>
      {/if}
      <button type="button" class="action-row" onclick={() => onedit(item)}>
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
        </svg>
        Edit
      </button>
    </div>

    {#if showDelete}
      <DeleteConfirm
        onConfirm={handleDelete}
        onCancel={() => (showDelete = false)}
        {deleting}
      />
    {/if}

    {#if showPicker}
      <CollectionPicker
        {item}
        mode={pickerMode}
        onpick={handlePick}
        onclose={() => (showPicker = false)}
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
    max-width: 560px;
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

  .modal-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .type-badge {
    background: var(--accent-subtle);
    color: var(--accent);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .date {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  /*
   * Per-type view styles. Children render `.title` / `.meta-row` / etc. into
   * the modal's DOM, but Svelte CSS scoping would otherwise prevent these
   * rules from matching them. Scoping under `.modal` keeps the leak bounded
   * to this modal's children.
   */
  .modal :global(.title) {
    font-size: 1.15rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    line-height: 1.3;
  }

  .modal :global(.title a) {
    color: var(--text);
    transition: color 0.15s;
  }

  .modal :global(.title a:hover) {
    color: var(--accent);
  }

  .modal :global(.title .link-icon) {
    display: inline;
    vertical-align: middle;
    margin-left: 0.35rem;
    opacity: 0.5;
  }

  .modal :global(.title a:hover .link-icon) {
    opacity: 1;
  }

  .modal :global(.meta-row) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .modal :global(.favicon) {
    border-radius: 2px;
    flex-shrink: 0;
  }

  .modal :global(.domain) {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .modal :global(.meta-text) {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }

  .modal :global(.view-image-link) {
    cursor: zoom-in;
    margin-bottom: 0.75rem;
  }

  .modal :global(.view-image) {
    width: 100%;
    max-height: 300px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }

  .modal :global(.player) {
    margin-bottom: 0.75rem;
  }

  .modal :global(.player audio) {
    width: 100%;
    height: 36px;
  }

  .modal :global(.duration) {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .modal :global(.status-text) {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .modal :global(.btn-action) {
    background: var(--accent-subtle);
    color: var(--accent);
    border: none;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s;
    margin-bottom: 0.75rem;
  }

  .modal :global(.btn-action:hover) {
    background: var(--accent-subtle-strong);
  }

  .modal :global(.btn-action:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  .modal :global(.content-block) {
    margin-bottom: 0.75rem;
  }

  .modal :global(.content-label) {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.25rem;
  }

  .modal :global(.content-text) {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .modal :global(.notes-block .content-text) {
    color: var(--accent);
    font-style: italic;
  }

  /* Markdown rendering inside note view. */
  .modal :global(.markdown-body) {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    word-break: break-word;
  }

  .modal :global(.markdown-body h1) {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0.75rem 0 0.4rem;
  }
  .modal :global(.markdown-body h2) {
    font-size: 1rem;
    font-weight: 600;
    margin: 0.6rem 0 0.35rem;
  }
  .modal :global(.markdown-body h3) {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0.5rem 0 0.3rem;
  }
  .modal :global(.markdown-body h4),
  .modal :global(.markdown-body h5),
  .modal :global(.markdown-body h6) {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0.4rem 0 0.25rem;
  }

  .modal :global(.markdown-body p) {
    margin: 0 0 0.5rem;
  }
  .modal :global(.markdown-body p:last-child) {
    margin-bottom: 0;
  }

  .modal :global(.markdown-body ul),
  .modal :global(.markdown-body ol) {
    padding-left: 1.5rem;
    margin: 0 0 0.5rem;
  }
  .modal :global(.markdown-body ul) {
    list-style: disc;
  }
  .modal :global(.markdown-body ol) {
    list-style: decimal;
  }
  .modal :global(.markdown-body li) {
    margin-bottom: 0.15rem;
  }
  .modal :global(.markdown-body li > ul),
  .modal :global(.markdown-body li > ol) {
    margin-top: 0.15rem;
    margin-bottom: 0;
  }

  .modal :global(.markdown-body blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 0.75rem;
    margin: 0 0 0.5rem;
    color: var(--text-muted);
  }

  .modal :global(.markdown-body a) {
    color: var(--accent);
    text-decoration: none;
  }
  .modal :global(.markdown-body a:hover) {
    text-decoration: underline;
  }

  .modal :global(.markdown-body code) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }

  .modal :global(.markdown-body pre) {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin: 0 0 0.5rem;
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  .modal :global(.markdown-body pre code) {
    background: none;
    padding: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #e6edf3;
  }

  .modal :global(.markdown-body pre .hljs) {
    background: transparent;
    padding: 0;
  }

  .modal :global(.markdown-body hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.75rem 0;
  }

  .modal :global(.markdown-body strong) {
    font-weight: 600;
  }
  .modal :global(.markdown-body em) {
    font-style: italic;
  }

  .modal :global(.markdown-body table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
  }
  .modal :global(.markdown-body th),
  .modal :global(.markdown-body td) {
    border: 1px solid var(--border);
    padding: 0.35rem 0.6rem;
    text-align: left;
  }
  .modal :global(.markdown-body th) {
    font-weight: 600;
    background: rgba(255, 255, 255, 0.03);
  }

  .share-row {
    margin-bottom: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  /* ── Header icons ─────────────────────── */

  .header-actions {
    margin-left: auto;
    display: flex;
    gap: 0.25rem;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    display: grid;
    place-items: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .icon-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .icon-btn-danger:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  /* ── Meta strip ───────────────────────── */

  .meta-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem;
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .loc-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .meta-group {
    font-weight: 600;
  }

  /* ── Primary filing action ────────────── */

  .btn-file {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    width: 100%;
    margin-top: 0.85rem;
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.6rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-file:hover {
    opacity: 0.9;
  }

  /* ── Secondary action list ────────────── */

  .action-list {
    display: flex;
    flex-direction: column;
    margin-top: 0.5rem;
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.55rem 0.5rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: var(--radius-sm);
    text-align: left;
    transition: background 0.15s;
  }

  .action-row:hover {
    background: var(--accent-subtler);
  }

  .action-row:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .action-row svg {
    color: var(--text-muted);
    flex-shrink: 0;
  }
</style>
