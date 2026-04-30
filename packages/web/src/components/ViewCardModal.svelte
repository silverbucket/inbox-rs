<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { InboxItem } from '@inbox-rs/rs-module';
  import {
    deleteItem,
    storeItem,
    sortedGroups,
    groupCollections,
    moveItemToCollection,
  } from '../lib/stores';
  import ShareButton from './ShareButton.svelte';
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
  let showMoveMenu = $state(false);
  let moveButtonEl = $state<HTMLButtonElement | null>(null);
  let dropdownStyle = $state('');

  // "Make Todo" can file into a collection when one exists. Without a
  // collection choice, converted todos stay unfiled and appear on the Todos
  // page without creating any organization.
  let showMakeTodoMenu = $state(false);
  let makeTodoButtonEl = $state<HTMLButtonElement | null>(null);
  let makeTodoDropdownStyle = $state('');

  let convertingTodo = $state(false);
  // Surface conversion failures inline. Both Make-Todo paths share this so
  // either flow can announce its error in the same dropdown.
  let convertError = $state('');
  let convertingRef = $state(false);

  onDestroy(() => {
    removeMoveMenuListeners();
    removeMakeTodoMenuListeners();
  });

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
    convertError = '';
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
      closeMakeTodoMenu();
      onclose();
    } catch (error) {
      console.error('Failed to convert to unfiled todo', error);
      convertError =
        error instanceof Error ? error.message : 'Failed to convert to todo';
    } finally {
      convertingTodo = false;
    }
  }

  /** Promote the current item to a todo and file it into the chosen collection. */
  async function convertToTodoInCollection(collectionId: string) {
    convertingTodo = true;
    convertError = '';
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
      closeMakeTodoMenu();
      onclose();
    } catch (error) {
      console.error('Failed to convert to todo', error);
      convertError =
        error instanceof Error ? error.message : 'Failed to convert to todo';
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

  function toggleMoveMenu() {
    // Only one picker can be open at a time — close Make Todo if it's open
    // so the overlays don't stack.
    if (showMakeTodoMenu) closeMakeTodoMenu();
    showMoveMenu = !showMoveMenu;
    if (showMoveMenu) {
      updateDropdownPosition();
      window.addEventListener('scroll', handleMoveMenuScroll, true);
      window.addEventListener('resize', closeMoveMenu);
      window.addEventListener('keydown', handleMoveMenuKeydown);
    } else {
      removeMoveMenuListeners();
    }
  }

  function handleMoveMenuScroll(event: Event) {
    const target = event.target;
    if (target instanceof Element && target.closest('.move-dropdown')) return;
    closeMoveMenu();
  }

  function handleMoveMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeMoveMenu();
  }

  function closeMoveMenu() {
    showMoveMenu = false;
    removeMoveMenuListeners();
  }

  function removeMoveMenuListeners() {
    window.removeEventListener('scroll', handleMoveMenuScroll, true);
    window.removeEventListener('resize', closeMoveMenu);
    window.removeEventListener('keydown', handleMoveMenuKeydown);
  }

  // ── Make Todo menu ─────────────────────────────────────────────────────
  // Mirrors the Move menu pattern so the two dropdowns feel identical.
  // Kept as a parallel menu (rather than collapsed into a single generic
  // picker) to keep the option list semantics crystal clear.

  function toggleMakeTodoMenu() {
    if (showMoveMenu) closeMoveMenu();
    showMakeTodoMenu = !showMakeTodoMenu;
    if (showMakeTodoMenu) {
      updateMakeTodoDropdownPosition();
      window.addEventListener('scroll', handleMakeTodoMenuScroll, true);
      window.addEventListener('resize', closeMakeTodoMenu);
      window.addEventListener('keydown', handleMakeTodoMenuKeydown);
    } else {
      removeMakeTodoMenuListeners();
    }
  }

  function handleMakeTodoMenuScroll(event: Event) {
    const target = event.target;
    if (target instanceof Element && target.closest('.make-todo-dropdown'))
      return;
    closeMakeTodoMenu();
  }

  function handleMakeTodoMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeMakeTodoMenu();
  }

  function closeMakeTodoMenu() {
    showMakeTodoMenu = false;
    removeMakeTodoMenuListeners();
  }

  function removeMakeTodoMenuListeners() {
    window.removeEventListener('scroll', handleMakeTodoMenuScroll, true);
    window.removeEventListener('resize', closeMakeTodoMenu);
    window.removeEventListener('keydown', handleMakeTodoMenuKeydown);
  }

  function updateMakeTodoDropdownPosition() {
    if (!makeTodoButtonEl) return;
    const rect = makeTodoButtonEl.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownMaxHeight = 280;
    const viewportPadding = 16;
    const gap = 6;

    const openUpward = spaceAbove > spaceBelow;
    const available = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(
      0,
      Math.min(available - viewportPadding, dropdownMaxHeight),
    );

    const dropdownWidth = Math.min(280, window.innerWidth - viewportPadding * 2);
    // Anchor to the right edge of the button so the picker doesn't drift off
    // the right side of the modal on tight layouts — Make Todo lives on the
    // right side of the header.
    const right = window.innerWidth - rect.right;
    const clampedRight = Math.max(
      viewportPadding,
      Math.min(right, window.innerWidth - dropdownWidth - viewportPadding),
    );

    if (openUpward) {
      makeTodoDropdownStyle = `bottom: ${window.innerHeight - rect.top + gap}px; right: ${clampedRight}px; max-height: ${maxHeight}px;`;
    } else {
      makeTodoDropdownStyle = `top: ${rect.bottom + gap}px; right: ${clampedRight}px; max-height: ${maxHeight}px;`;
    }
  }

  function updateDropdownPosition() {
    if (!moveButtonEl) return;
    const rect = moveButtonEl.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownMaxHeight = 240;
    const viewportPadding = 16;
    const gap = 4;

    const openUpward = spaceAbove > spaceBelow;
    const available = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(
      0,
      Math.min(available - viewportPadding, dropdownMaxHeight),
    );

    // Clamp horizontal position using max possible rendered width
    const dropdownWidth = Math.min(280, window.innerWidth - viewportPadding * 2);
    const left = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - dropdownWidth - viewportPadding),
    );

    if (openUpward) {
      dropdownStyle = `bottom: ${window.innerHeight - rect.top + gap}px; left: ${left}px; max-height: ${maxHeight}px;`;
    } else {
      dropdownStyle = `top: ${rect.bottom + gap}px; left: ${left}px; max-height: ${maxHeight}px;`;
    }
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
    'filePath' in item && !!(item as Record<string, unknown>).filePath,
  );

  /**
   * Window-level Escape handler. Defers to nested overlays when any are open
   * so Escape peels one layer at a time instead of collapsing the stack:
   *
   *   - DeleteConfirm, Lightbox: they register their own window handlers and
   *     will close themselves. We only need to keep *this* modal open so the
   *     user isn't unexpectedly dumped back to the card list.
   *   - Move / Make-Todo menus: they already close themselves via their own
   *     document-level escape listeners — we still early-return so both don't
   *     close simultaneously.
   *
   * Since `<svelte:window>` listeners fire in registration order, this outer
   * listener is registered first (parent mounts before children) and runs
   * before the nested ones — so checking state here is safe even though the
   * nested handlers will fire immediately after.
   */
  function handleWindowEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (showDelete || showMoveMenu || showMakeTodoMenu) return;
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
      {#if canMakeTodo}
        <button
          type="button"
          class="btn-todo btn-todo-top"
          class:open={showMakeTodoMenu}
          bind:this={makeTodoButtonEl}
          disabled={convertingTodo}
          onclick={toggleMakeTodoMenu}
          aria-haspopup="listbox"
          aria-expanded={showMakeTodoMenu}
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
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
            ></path>
          </svg>
          Make Todo
          <svg
            aria-hidden="true"
            class="caret"
            class:open={showMakeTodoMenu}
            width="10"
            height="10"
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
      {/if}
      {#if canMakeRef}
        <button
          type="button"
          class="btn-todo btn-todo-top"
          disabled={convertingRef}
          onclick={convertToReference}
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
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
            ></path>
          </svg>
          Make Reference
        </button>
      {/if}
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
          filePath={(item as Record<string, unknown>).filePath as string}
          mimeType={(item as Record<string, unknown>).mimeType as
            | string
            | undefined}
          filename={item.title || undefined}
        />
      </div>
    {/if}

    <div class="actions">
      <button type="button" class="btn-delete" onclick={() => (showDelete = true)}>
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
      <div class="move-container">
        <button
          type="button"
          class="btn-move"
          bind:this={moveButtonEl}
          onclick={toggleMoveMenu}
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
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
          </svg>
          {item.collectionId ? 'Move' : 'Collect'}
        </button>
      </div>
      <button type="button" class="btn-cancel" onclick={onclose}>Close</button>
      <button type="button" class="btn-edit" onclick={() => onedit(item)}>Edit</button>
    </div>

    {#if showDelete}
      <DeleteConfirm
        onConfirm={handleDelete}
        onCancel={() => (showDelete = false)}
        {deleting}
      />
    {/if}

    {#if showMakeTodoMenu}
      <button
        type="button"
        class="move-backdrop"
        tabindex="-1"
        aria-label="Close make todo menu"
        onclick={() => closeMakeTodoMenu()}
      ></button>
      <div
        class="move-dropdown make-todo-dropdown"
        style={makeTodoDropdownStyle}
        role="listbox"
        aria-label="Choose a collection for this todo"
      >
        <div class="picker-title">File todo</div>
        {#if convertError}
          <p class="move-error" role="status" aria-live="polite">
            {convertError}
          </p>
        {/if}
        <button
          type="button"
          class="move-option"
          onclick={convertToUnfiledTodo}
          disabled={convertingTodo}
        >
          <span class="move-dot" style="background: #9ca3af"></span>
          Unfiled
        </button>
        {#if $sortedGroups.some((g) => ($groupCollections[g.id] ?? []).length > 0)}
          <div class="move-divider"></div>
        {/if}
        {#each $sortedGroups as group (group.id)}
          {#each $groupCollections[group.id] ?? [] as col (col.id)}
            <button
              type="button"
              class="move-option"
              onclick={() => convertToTodoInCollection(col.id)}
              disabled={convertingTodo}
            >
              <span
                class="move-dot"
                style="background: {col.color || '#6366f1'}"
              ></span>
              <span
                class="move-group-prefix"
                style="color: {group.color || 'var(--accent)'}">{group.name}</span
              > : {col.name}
            </button>
          {/each}
        {/each}
      </div>
    {/if}

    {#if showMoveMenu}
      <button
        type="button"
        class="move-backdrop"
        tabindex="-1"
        aria-label="Close move menu"
        onclick={() => closeMoveMenu()}
      ></button>
      <div class="move-dropdown" style={dropdownStyle}>
        {#if item.collectionId}
          <button
            type="button"
            class="move-option"
            onclick={() => {
              moveItemToCollection(item.id, undefined).catch((e) =>
                console.error('Move failed:', e),
              );
              closeMoveMenu();
              onclose();
            }}
          >
            <span class="move-dot" style="background: #9ca3af"></span>
            {item.isTodo || item.type === 'todo' ? 'Unfile' : 'Inbox'}
          </button>
          <div class="move-divider"></div>
        {/if}
        {#each $sortedGroups as group (group.id)}
          {#each $groupCollections[group.id] ?? [] as col (col.id)}
            {#if col.id !== item.collectionId}
              <button
                type="button"
                class="move-option"
                onclick={() => {
                  moveItemToCollection(item.id, col.id).catch((e) =>
                    console.error('Move failed:', e),
                  );
                  closeMoveMenu();
                  onclose();
                }}
              >
                <span
                  class="move-dot"
                  style="background: {col.color || '#6366f1'}"
                ></span>
                <span
                  class="move-group-prefix"
                  style="color: {group.color || 'var(--accent)'}"
                  >{group.name}</span
                > : {col.name}
              </button>
            {/if}
          {/each}
        {/each}
        {#if $sortedGroups.every((g) => ($groupCollections[g.id] ?? []).every((col) => col.id === item.collectionId))}
          <div class="move-empty">No collections</div>
        {/if}
      </div>
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

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .btn-delete {
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

  .btn-delete:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent 90%);
    border-color: var(--danger, #ef4444);
  }

  .btn-todo {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-todo:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .btn-todo:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-todo.open {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent 90%);
  }

  .btn-todo .caret {
    opacity: 0.7;
    transition: transform 150ms ease;
  }

  .btn-todo .caret.open {
    transform: rotate(180deg);
  }

  .btn-todo-top {
    margin-left: auto;
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

  .btn-edit {
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

  .btn-edit:hover {
    opacity: 0.9;
  }

  .move-container {
    position: relative;
  }

  .btn-move {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-move:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .move-dropdown {
    position: fixed;
    min-width: 200px;
    max-width: 280px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.3rem;
    z-index: 300;
    box-shadow: 0 8px 24px var(--shadow);
    overflow-y: auto;
  }

  /*
   * Make Todo picker — sized a touch wider so the group : collection
   * double label doesn't wrap awkwardly when users have long names.
   */
  .make-todo-dropdown {
    min-width: 240px;
  }

  .picker-title {
    padding: 0.35rem 0.55rem 0.4rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0.25rem;
  }

  .move-backdrop {
    position: fixed;
    inset: 0;
    z-index: 250;
    background: none;
    border: none;
    padding: 0;
    cursor: default;
  }

  .move-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.8rem;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
  }

  .move-option:hover {
    background: var(--accent-subtler);
  }

  .move-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .move-group-prefix {
    font-weight: 600;
    font-size: 0.78rem;
  }

  .move-divider {
    height: 1px;
    background: var(--border);
    margin: 0.2rem 0;
  }

  .move-empty {
    padding: 0.4rem 0.5rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .move-error {
    margin: 0 0.2rem 0.4rem;
    padding: 0.4rem 0.5rem;
    font-size: 0.8rem;
    color: var(--danger);
  }
</style>
