<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { deleteItem, storeItem, blobUrls, connected, sortedGroups, groupCollections, ungroupedCollections, moveItemToCollection, loadFileBlobUrl, hasUncategorizedItems } from '../lib/stores';
  import rs from '../lib/rs';
  import { transcribeAudio } from '../lib/transcribe';
  import ShareButton from './ShareButton.svelte';
  import Lightbox from './Lightbox.svelte';
  import DeleteConfirm from './DeleteConfirm.svelte';
  import 'highlight.js/styles/github-dark.min.css';
  import { renderMarkdown } from '../lib/markdown';

  let { item, onclose, onedit }: {
    item: InboxItem;
    onclose: () => void;
    onedit: (item: InboxItem) => void;
  } = $props();

  let showDelete = $state(false);
  let deleting = $state(false);
  let showLightbox = $state(false);
  let showMoveMenu = $state(false);
  let moveButtonEl = $state<HTMLButtonElement | null>(null);
  let dropdownStyle = $state('');

  // "Make Todo" forces the user to choose a collection up-front — a loose
  // todo sitting in the Inbox/Uncategorized bucket is almost always an
  // unintended leak. The picker reuses the move-dropdown styling so it
  // looks and behaves identically to the existing move affordance.
  let showMakeTodoMenu = $state(false);
  let makeTodoButtonEl = $state<HTMLButtonElement | null>(null);
  let makeTodoDropdownStyle = $state('');

  // Audio playback
  const audioSrc = $derived(
    item.type === 'audio'
      ? ($blobUrls[item.filePath] || null)
      : null
  );

  // Audio state
  let audioError = $state(false);
  let transcribing = $state(false);
  let transcriptionError = $state(false);

  // Markdown rendering for notes
  let renderedBody = $state('');

  // Document download
  let docBlobUrl = $state<string | null>(null);
  let docLoading = $state(false);

  $effect(() => {
    // Track only item to trigger reloads when it changes
    const currentItem = item;

    // Reset per-item state
    audioError = false;
    transcribing = false;
    transcriptionError = false;
    renderedBody = '';
    showLightbox = false;
    untrack(() => { if (docBlobUrl) URL.revokeObjectURL(docBlobUrl); });
    docBlobUrl = null;
    docLoading = false;

    if (currentItem.type === 'note' && (currentItem as any).body) {
      renderMarkdown((currentItem as any).body).then((html) => {
        if (item.id === currentItem.id) renderedBody = html;
      });
    }
  });

  onDestroy(() => {
    if (docBlobUrl) URL.revokeObjectURL(docBlobUrl);
    removeMoveMenuListeners();
    removeMakeTodoMenuListeners();
  });

  async function handleTranscribe() {
    if (item.type !== 'audio') return;
    const target = item; // snapshot to guard against item changing mid-transcription
    transcribing = true;
    transcriptionError = false;
    try {
      const inbox = (rs as any).inbox;
      const file = await inbox.getFile(target.filePath);
      if (!file?.data) throw new Error('Could not load audio file');
      const blob = new Blob([file.data], { type: target.mimeType });
      const text = await transcribeAudio(blob);
      const updated = {
        ...target,
        body: text || undefined,
        title: text && target.title === 'Audio' ? text.slice(0, 50) : target.title,
        transcribed: true,
      };
      await storeItem(updated);
    } catch (e) {
      console.warn('Transcription failed:', e);
      if (item.id === target.id) transcriptionError = true;
    } finally {
      if (item.id === target.id) transcribing = false;
    }
  }

  async function downloadDoc() {
    if (item.type !== 'document') return;
    if (docBlobUrl) { openDownload(docBlobUrl); return; }
    docLoading = true;
    try {
      const inbox = (rs as any).inbox;
      const file = await inbox.getFile(item.filePath);
      if (file?.data) {
        docBlobUrl = URL.createObjectURL(new Blob([file.data], { type: item.mimeType }));
        openDownload(docBlobUrl);
      }
    } finally {
      docLoading = false;
    }
  }

  function openDownload(url: string) {
    if (item.type !== 'document') return;
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName || item.title;
    a.click();
  }

  async function handleDelete() {
    deleting = true;
    await deleteItem(item.id, item);
    showDelete = false;
    deleting = false;
    onclose();
  }

  let convertingTodo = $state(false);

  /**
   * Promote the current item to a todo and file it into the chosen collection
   * atomically. We always route through a collection — loose todos (no
   * collection) tend to be accidental leaks, so the Make Todo flow now
   * surfaces an inline collection picker rather than silently dropping the
   * new todo into Uncategorized.
   */
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
      const updated = { ...rest, isTodo: true, completed: false, collectionId };
      // Moving into a real collection should clear any Uncategorized marker
      // so the item doesn't simultaneously appear in both places.
      delete (updated as any).uncategorized;
      await storeItem(updated as InboxItem);
      closeMakeTodoMenu();
      onclose();
    } finally {
      convertingTodo = false;
    }
  }

  const canMakeTodo = $derived(item.type !== 'todo' && !item.isTodo);
  const canMakeRef = $derived(item.isTodo || item.type === 'todo');

  // True when the item already lives in the Uncategorized bucket: a todo without
  // a collection (todos can't be in the Inbox), or a reference flagged with
  // `uncategorized: true`. Items in this state shouldn't see an "Uncategorized"
  // move option — it would be a no-op.
  const isInUncategorized = $derived(
    !item.collectionId && (item.uncategorized === true || item.isTodo || item.type === 'todo')
  );

  // Show the "Uncategorized" entry in the move dropdown when:
  //   - the item is in a real collection (preserves the existing "remove from
  //     collection" affordance — items leaving a collection always land in
  //     Uncategorized rather than the Inbox), OR
  //   - Uncategorized already exists (has stragglers), so an Inbox ref can be
  //     filed alongside them. Per design, Uncategorized isn't a first-class
  //     destination unless it already exists.
  const showUncategorizedOption = $derived(
    !isInUncategorized && (!!item.collectionId || $hasUncategorizedItems)
  );

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
  // picker) to keep the option list semantics crystal clear: Move can send
  // items to Uncategorized, Make Todo can't.

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
    if (target instanceof Element && target.closest('.make-todo-dropdown')) return;
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
    const maxHeight = Math.max(0, Math.min(available - viewportPadding, dropdownMaxHeight));

    const dropdownWidth = Math.min(280, window.innerWidth - viewportPadding * 2);
    // Anchor to the right edge of the button so the picker doesn't drift off
    // the right side of the modal on tight layouts — Make Todo lives on the
    // right side of the header.
    const right = window.innerWidth - rect.right;
    const clampedRight = Math.max(viewportPadding, Math.min(right, window.innerWidth - dropdownWidth - viewportPadding));

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
    const maxHeight = Math.max(0, Math.min(available - viewportPadding, dropdownMaxHeight));

    // Clamp horizontal position using max possible rendered width
    const dropdownWidth = Math.min(280, window.innerWidth - viewportPadding * 2);
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - dropdownWidth - viewportPadding));

    if (openUpward) {
      dropdownStyle = `bottom: ${window.innerHeight - rect.top + gap}px; left: ${left}px; max-height: ${maxHeight}px;`;
    } else {
      dropdownStyle = `top: ${rect.bottom + gap}px; left: ${left}px; max-height: ${maxHeight}px;`;
    }
  }

  let convertingRef = $state(false);

  async function convertToReference() {
    convertingRef = true;
    try {
      const updated = { ...item };
      delete (updated as any).isTodo;
      delete (updated as any).completed;
      delete (updated as any).completedAt;
      // type: 'todo' items require `completed` in the schema — convert to note
      if (updated.type === 'todo') {
        (updated as any).type = 'note';
        if (!(updated as any).body) (updated as any).body = '';
      }
      await storeItem(updated as InboxItem);
      onclose();
    } finally {
      convertingRef = false;
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  }

  // Notes and body helpers
  const notes = $derived(
    'notes' in item ? (item as any).notes : undefined
  );
  const body = $derived(
    'body' in item ? (item as any).body : undefined
  );
  const description = $derived(item.description);

  const hasFile = $derived('filePath' in item && !!(item as any).filePath);

  const imageSrc = $derived(
    item.type === 'bookmark'
      ? ((item.filePath ? ($blobUrls[item.filePath] || null) : null) || item.ogImage || null)
      : item.type === 'image'
        ? ($blobUrls[item.filePath] || null)
        : null
  );

  // Fetch file-backed items via Authorization header (works on all RS servers).
  // Forward mimeType so the blob is tagged with the clean type from item
  // metadata rather than the server's Content-Type (5apps preserves the
  // `; charset=binary` suffix that wireclient adds on upload, and Chrome won't
  // render an <img>/<audio> whose Blob type carries that suffix).
  $effect(() => {
    if (!$connected) return;
    if (item.type === 'image' && item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
    if (item.type === 'audio' && item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
    if (item.type === 'bookmark' && 'filePath' in item && item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });

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
    if (showDelete || showLightbox || showMoveMenu || showMakeTodoMenu) return;
    onclose();
  }
</script>

<svelte:window onkeydown={handleWindowEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="view-modal-title" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <span class="type-badge">{item.type}</span>
      <time class="date">{formatDate(item.createdAt)}</time>
      {#if canMakeTodo}
        <button
          class="btn-todo btn-todo-top"
          class:open={showMakeTodoMenu}
          bind:this={makeTodoButtonEl}
          disabled={convertingTodo}
          onclick={toggleMakeTodoMenu}
          aria-haspopup="listbox"
          aria-expanded={showMakeTodoMenu}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          Make Todo
          <svg class="caret" class:open={showMakeTodoMenu} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      {/if}
      {#if canMakeRef}
        <button class="btn-todo btn-todo-top" disabled={convertingRef} onclick={convertToReference}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          Make Reference
        </button>
      {/if}
    </div>

    <h2 class="title" id="view-modal-title">
      {#if item.type === 'bookmark'}
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<svg class="link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>
      {:else if item.type === 'email' && 'messageUrl' in item && item.messageUrl}
        <a href={item.messageUrl}>{item.title}<svg class="link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>
      {:else}
        {item.title}
      {/if}
    </h2>

    {#if item.type === 'bookmark'}
      <div class="meta-row">
        {#if item.favicon}
          <img class="favicon" src={item.favicon} alt="" width="16" height="16"
            onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
        {/if}
        <span class="domain">{item.siteName || getDomain(item.url)}</span>
      </div>
    {/if}

    {#if item.type === 'email' && 'from' in item && item.from}
      <p class="meta-text">From: {item.from}</p>
    {/if}

    {#if imageSrc}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="view-image-link" onclick={() => showLightbox = true}>
        <img class="view-image" src={imageSrc} alt=""
          onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
      </div>
    {/if}
    {#if showLightbox && imageSrc}
      <Lightbox
        src={imageSrc}
        alt={item.title}
        onclose={() => showLightbox = false}
        filePath={'filePath' in item ? (item as any).filePath : undefined}
        mimeType={'mimeType' in item ? (item as any).mimeType : undefined}
        filename={item.title || undefined}
      />
    {/if}

    {#if item.type === 'audio'}
      <div class="player">
        {#if audioError}
          <p class="status-text">Failed to load audio</p>
        {:else if audioSrc}
          <audio controls src={audioSrc} preload="metadata"
            onerror={() => audioError = true}></audio>
        {:else}
          <p class="status-text">Connect to load audio</p>
        {/if}
        {#if item.duration}
          <span class="duration">{formatDuration(item.duration)}</span>
        {/if}
        {#if transcribing}
          <p class="status-text">Transcribing...</p>
        {:else if transcriptionError}
          <p class="status-text">Transcription failed</p>
          <button class="btn-action" onclick={handleTranscribe}>Retry</button>
        {:else if audioSrc && !item.transcribed && !item.body}
          <button class="btn-action" onclick={handleTranscribe}>Transcribe</button>
        {/if}
      </div>
    {/if}

    {#if item.type === 'document'}
      {#if item.fileName}
        <p class="meta-text">{item.fileName}</p>
      {/if}
      {#if item.fileSize}
        <span class="meta-text">{formatSize(item.fileSize)}</span>
      {/if}
      <button class="btn-action" onclick={(e) => { e.stopPropagation(); downloadDoc(); }} disabled={docLoading}>
        {docLoading ? 'Loading...' : 'Download'}
      </button>
    {/if}

    <!-- Notes prioritized over body -->
    {#if notes}
      <div class="content-block notes-block">
        <span class="content-label">Notes</span>
        <p class="content-text">{notes}</p>
      </div>
    {/if}

    {#if body}
      <div class="content-block">
        <span class="content-label">{item.type === 'audio' ? 'Transcription' : 'Body'}</span>
        {#if item.type === 'note' && renderedBody}
          <div class="markdown-body">{@html renderedBody}</div>
        {:else}
          <p class="content-text">{body}</p>
        {/if}
      </div>
    {/if}

    {#if description}
      <div class="content-block">
        <span class="content-label">Description</span>
        <p class="content-text">{description}</p>
      </div>
    {/if}

    {#if hasFile}
      <div class="share-row">
        <ShareButton filePath={(item as any).filePath} mimeType={(item as any).mimeType} filename={item.title || undefined} />
      </div>
    {/if}

    <div class="actions">
      <button class="btn-delete" onclick={() => showDelete = true}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        Delete
      </button>
      <div class="move-container">
        <button class="btn-move" bind:this={moveButtonEl} onclick={toggleMoveMenu}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
          </svg>
          {item.collectionId ? 'Move' : 'Collect'}
        </button>
      </div>
      <button class="btn-cancel" onclick={onclose}>Close</button>
      <button class="btn-edit" onclick={() => onedit(item)}>Edit</button>
    </div>

    {#if showDelete}
      <DeleteConfirm
        onConfirm={handleDelete}
        onCancel={() => showDelete = false}
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
      <div class="move-dropdown make-todo-dropdown" style={makeTodoDropdownStyle} role="listbox" aria-label="Choose a collection for this todo">
        <div class="picker-title">Pick a collection</div>
        {#each $sortedGroups as group (group.id)}
          {#each ($groupCollections[group.id] ?? []) as col (col.id)}
            <button class="move-option" onclick={() => convertToTodoInCollection(col.id)} disabled={convertingTodo}>
              <span class="move-dot" style="background: {col.color || '#6366f1'}"></span>
              <span class="move-group-prefix" style="color: {group.color || 'var(--accent)'}">{group.name}</span> : {col.name}
            </button>
          {/each}
        {/each}
        <!-- Ungrouped collections — legacy collections from before groups
             became mandatory, or collections whose parent group was deleted.
             Without this, a user whose only collection is ungrouped would see
             an empty picker and the "create a collection first" message
             despite already having one. -->
        {#each $ungroupedCollections as col (col.id)}
          <button class="move-option" onclick={() => convertToTodoInCollection(col.id)} disabled={convertingTodo}>
            <span class="move-dot" style="background: {col.color || '#6366f1'}"></span>
            <span class="move-group-prefix" style="color: #9ca3af">Ungrouped</span> : {col.name}
          </button>
        {/each}
        {#if $sortedGroups.every((g) => ($groupCollections[g.id] ?? []).length === 0) && $ungroupedCollections.length === 0}
          <!-- No real collections yet — guide the user instead of silently
               allowing an Uncategorized-only choice, which would undo the
               point of this forced-picker flow. -->
          <div class="move-empty">Create a collection first to file this todo.</div>
        {/if}
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
        {#if showUncategorizedOption}
          <button class="move-option" onclick={() => { moveItemToCollection(item.id, undefined).catch(e => console.error('Move failed:', e)); closeMoveMenu(); onclose(); }}>
            <span class="move-dot" style="background: #9ca3af"></span>
            Uncategorized
          </button>
          <div class="move-divider"></div>
        {/if}
        {#each $sortedGroups as group (group.id)}
          {#each ($groupCollections[group.id] ?? []) as col (col.id)}
            {#if col.id !== item.collectionId}
              <button class="move-option" onclick={() => { moveItemToCollection(item.id, col.id).catch(e => console.error('Move failed:', e)); closeMoveMenu(); onclose(); }}>
                <span class="move-dot" style="background: {col.color || '#6366f1'}"></span>
                <span class="move-group-prefix" style="color: {group.color || 'var(--accent)'}">{group.name}</span> : {col.name}
              </button>
            {/if}
          {/each}
        {/each}
        <!-- Ungrouped collections — must be offered as move targets too,
             otherwise an item can't be moved into a collection whose group
             was deleted (or a legacy ungrouped collection). -->
        {#each $ungroupedCollections as col (col.id)}
          {#if col.id !== item.collectionId}
            <button class="move-option" onclick={() => { moveItemToCollection(item.id, col.id).catch(e => console.error('Move failed:', e)); closeMoveMenu(); onclose(); }}>
              <span class="move-dot" style="background: {col.color || '#6366f1'}"></span>
              <span class="move-group-prefix" style="color: #9ca3af">Ungrouped</span> : {col.name}
            </button>
          {/if}
        {/each}
        {#if $sortedGroups.length === 0 && $ungroupedCollections.length === 0}
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
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
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

  .title {
    font-size: 1.15rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    line-height: 1.3;
  }

  .title a {
    color: var(--text);
    transition: color 0.15s;
  }

  .title a:hover {
    color: var(--accent);
  }

  .title :global(.link-icon) {
    display: inline;
    vertical-align: middle;
    margin-left: 0.35rem;
    opacity: 0.5;
  }

  .title a:hover :global(.link-icon) {
    opacity: 1;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .favicon {
    border-radius: 2px;
    flex-shrink: 0;
  }

  .domain {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .meta-text {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }

  .view-image-link {
    cursor: zoom-in;
    margin-bottom: 0.75rem;
  }

  .view-image {
    width: 100%;
    max-height: 300px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }

  .player {
    margin-bottom: 0.75rem;
  }

  .player audio {
    width: 100%;
    height: 36px;
  }

  .duration {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .status-text {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .content-block {
    margin-bottom: 0.75rem;
  }

  .content-label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.25rem;
  }

  .content-text {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown-body {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    word-break: break-word;
  }

  .markdown-body :global(h1) { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
  .markdown-body :global(h2) { font-size: 1rem; font-weight: 600; margin: 0.6rem 0 0.35rem; }
  .markdown-body :global(h3) { font-size: 0.95rem; font-weight: 600; margin: 0.5rem 0 0.3rem; }
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) { font-size: 0.9rem; font-weight: 600; margin: 0.4rem 0 0.25rem; }

  .markdown-body :global(p) { margin: 0 0 0.5rem; }
  .markdown-body :global(p:last-child) { margin-bottom: 0; }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    padding-left: 1.5rem;
    margin: 0 0 0.5rem;
  }
  .markdown-body :global(ul) { list-style: disc; }
  .markdown-body :global(ol) { list-style: decimal; }
  .markdown-body :global(li) { margin-bottom: 0.15rem; }
  .markdown-body :global(li > ul),
  .markdown-body :global(li > ol) { margin-top: 0.15rem; margin-bottom: 0; }

  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 0.75rem;
    margin: 0 0 0.5rem;
    color: var(--text-muted);
  }

  .markdown-body :global(a) {
    color: var(--accent);
    text-decoration: none;
  }
  .markdown-body :global(a:hover) { text-decoration: underline; }

  .markdown-body :global(code) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }

  .markdown-body :global(pre) {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin: 0 0 0.5rem;
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  .markdown-body :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #e6edf3;
  }

  .markdown-body :global(pre .hljs) {
    background: transparent;
    padding: 0;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.75rem 0;
  }

  .markdown-body :global(strong) { font-weight: 600; }
  .markdown-body :global(em) { font-style: italic; }

  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
  }
  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--border);
    padding: 0.35rem 0.6rem;
    text-align: left;
  }
  .markdown-body :global(th) {
    font-weight: 600;
    background: rgba(255, 255, 255, 0.03);
  }

  .notes-block .content-text {
    color: var(--accent);
    font-style: italic;
  }

  .share-row {
    margin-bottom: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .btn-action {
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

  .btn-action:hover {
    background: var(--accent-subtle-strong);
  }

  .btn-action:disabled {
    opacity: 0.5;
    cursor: default;
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
</style>
