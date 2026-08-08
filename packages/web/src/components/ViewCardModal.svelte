<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { clearCardDraft } from '../lib/card-draft';
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
  import ScheduleSheet from './ScheduleSheet.svelte';
  import AddToCalendarSheet from './AddToCalendarSheet.svelte';
  import { formatScheduled, isOverdue } from '../lib/schedule';
  import BookmarkView from './view-card/BookmarkView.svelte';
  import ImageView from './view-card/ImageView.svelte';
  import AudioView from './view-card/AudioView.svelte';
  import DocumentView from './view-card/DocumentView.svelte';
  import CardInlineEditor, { type SaveStatus } from './CardInlineEditor.svelte';

  let {
    item,
    onclose,
  }: {
    item: InboxItem;
    onclose: () => void;
  } = $props();

  const TITLE_ID = 'view-modal-title';

  let showActions = $state(false);
  let showDelete = $state(false);
  let deleting = $state(false);

  // One CollectionPicker serves both flows: re-filing the card ('move') and
  // choosing where a converted todo lands ('todo').
  let showPicker = $state(false);
  let pickerMode = $state<'move' | 'todo'>('move');

  let showSchedule = $state(false);
  let showCalendarSheet = $state(false);

  let convertingTodo = $state(false);
  let convertingRef = $state(false);
  let saveStatus = $state<SaveStatus>('saved');
  let flushEdits = $state<() => Promise<void>>(async () => {});
  let retrySave = $state<() => void>(() => {});
  let closing = $state(false);

  const saveLabel = $derived(
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'pending'
        ? 'Saved on this device'
        : saveStatus === 'error'
          ? 'Couldn’t sync · Retry'
          : saveStatus === 'restored'
            ? 'Draft restored'
            : 'Saved',
  );

  async function prepareAction() {
    try {
      await flushEdits();
    } catch {
      showToast('Changes are safe on this device, but could not sync');
      throw new Error('Pending card changes could not sync');
    }
  }

  async function requestClose() {
    if (closing) return;
    closing = true;
    try {
      await flushEdits();
    } catch {
      // The immediate local draft survives navigation and refresh, so closing
      // remains safe even when remoteStorage is temporarily unavailable.
    } finally {
      onclose();
    }
  }

  async function handleDelete() {
    deleting = true;
    try {
      await flushEdits();
    } catch {
      // The save attempt has settled. Deletion must now win.
    }
    await deleteItem(item.id, item);
    clearCardDraft(item.id, localStorage);
    showDelete = false;
    deleting = false;
    onclose();
  }

  /**
   * A todo↔reference conversion changes the card's kind, so a posted
   * calendar entry no longer matches what the receipt claims (a VEVENT for
   * what is now a task, or vice versa) — and archive state belongs to the
   * calendar ownership that conversion breaks. Drop the receipt + archive
   * flags locally and keep the time, flipping its kind to match. The
   * calendar keeps its entry untouched: publishing is one-shot, inbox-rs
   * never updates or deletes there.
   */
  function detachCalendarOnConversion(
    updated: Record<string, unknown>,
    newKind: 'event' | 'task',
  ) {
    delete updated.eventUrl;
    delete updated.eventEtag;
    delete updated.archived;
    delete updated.archivedAt;
    if (updated.startsAt) updated.scheduleKind = newKind;
  }

  /** Promote the current item to an unfiled todo. */
  async function convertToUnfiledTodo() {
    convertingTodo = true;
    try {
      await prepareAction();
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
      detachCalendarOnConversion(updated, 'task');
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
      await prepareAction();
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
      const updated: Record<string, unknown> = {
        ...rest,
        isTodo: true,
        completed: false,
        collectionId,
      };
      detachCalendarOnConversion(updated, 'task');
      await storeItem(updated as unknown as InboxItem);
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
      await prepareAction();
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
      detachCalendarOnConversion(updated, 'event');
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
  async function handlePick(collectionId: string | undefined) {
    if (pickerMode === 'todo') {
      // Conversion closes the picker + modal itself on success so a failure
      // can leave both open for a retry.
      if (collectionId) {
        await convertToTodoInCollection(collectionId);
      } else {
        await convertToUnfiledTodo();
      }
      return;
    }
    showPicker = false;
    // Close only once the move settles — a failure leaves the card open (with
    // a toast) so the user can retry, matching the todo-conversion branches.
    // The write is a local-first IndexedDB store, so the await is cheap.
    try {
      await prepareAction();
      await moveItemToCollection(item.id, collectionId);
      if (collectionId) recordCollectionUse(collectionId);
      onclose();
    } catch (e) {
      console.error('Move failed:', e);
      showToast('Move failed');
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

  const scheduledLabel = $derived(item.startsAt ? formatScheduled(item) : '');
  const scheduleOverdue = $derived(isOverdue(item));

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
   *   - CollectionPicker, ScheduleSheet: they close themselves via their own
   *     window escape listeners — we early-return so both layers don't close
   *     at once.
   *
   * Since `<svelte:window>` listeners fire in registration order, this outer
   * listener is registered first (parent mounts before children) and runs
   * before the nested ones — so checking state here is safe even though the
   * nested handlers will fire immediately after.
   */
  function handleWindowEscape(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void flushEdits().catch(() => {});
      return;
    }
    if (e.key !== 'Escape') return;
    if (showDelete || showPicker || showSchedule || showCalendarSheet) return;
    if (showActions) {
      showActions = false;
      return;
    }
    void requestClose();
  }

  function handleOverlayClick() {
    if (showActions) {
      showActions = false;
      return;
    }
    void requestClose();
  }

  function handleModalClick(e: MouseEvent) {
    e.stopPropagation();
    if (showActions && !(e.target as HTMLElement).closest('.header-actions')) {
      showActions = false;
    }
  }

  async function openSchedule() {
    try {
      await prepareAction();
      showSchedule = true;
    } catch {
      // prepareAction already explains that the draft is safe locally.
    }
  }

  async function openCalendar() {
    try {
      await prepareAction();
      showCalendarSheet = true;
    } catch {
      // prepareAction already explains that the draft is safe locally.
    }
  }
</script>

<svelte:window onkeydown={handleWindowEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={handleOverlayClick}>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby={TITLE_ID}
    onclick={handleModalClick}
  >
    <div class="modal-header">
      <span class="type-badge">{item.type}</span>
      <time class="date">{formatDate(item.createdAt)}</time>
      <button
        type="button"
        class="save-status"
        class:error={saveStatus === 'error'}
        onclick={() => saveStatus === 'error' && retrySave()}
        disabled={saveStatus !== 'error'}
        aria-live="polite"
      >
        <span class="save-dot" aria-hidden="true"></span>{saveLabel}
      </button>
      <div class="header-actions">
        <button
          type="button"
          class="icon-btn"
          title="Card actions"
          aria-label="Card actions"
          aria-haspopup="menu"
          aria-expanded={showActions}
          onclick={() => (showActions = !showActions)}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <circle cx="5" cy="12" r="1.75"></circle>
            <circle cx="12" cy="12" r="1.75"></circle>
            <circle cx="19" cy="12" r="1.75"></circle>
          </svg>
        </button>
        {#if showActions}
          <div class="actions-menu" role="menu">
            <button
              type="button"
              class="actions-menu-item actions-menu-danger"
              role="menuitem"
              onclick={() => {
                showActions = false;
                showDelete = true;
              }}
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
              Delete card
            </button>
          </div>
        {/if}
        <button
          type="button"
          class="icon-btn"
          title="Close"
          aria-label="Close"
          onclick={() => void requestClose()}
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

    <h2 class="sr-only" id={TITLE_ID}>{item.title || 'Untitled card'}</h2>
    {#key item.id}
      <CardInlineEditor
        {item}
        bind:status={saveStatus}
        bind:flush={flushEdits}
        bind:retry={retrySave}
      />
    {/key}

    <!-- Type-specific previews and file actions stay available beneath the
         always-editable content without duplicating title/body fields. -->
    {#key item.id}
      {#if item.type === 'bookmark'}
        <BookmarkView {item} titleId={TITLE_ID} showTitle={false} beforeAction={prepareAction} />
      {:else if item.type === 'image'}
        <ImageView {item} titleId={TITLE_ID} showTitle={false} />
      {:else if item.type === 'audio'}
        <AudioView {item} titleId={TITLE_ID} showTitle={false} showBody={false} beforeAction={prepareAction} />
      {:else if item.type === 'document'}
        <DocumentView {item} titleId={TITLE_ID} showTitle={false} />
      {/if}
    {/key}

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
      {#if scheduledLabel}
        <span class="meta-item" class:overdue={scheduleOverdue}>
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
            <rect x="3" y="4" width="18" height="18" rx="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          {scheduledLabel}
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
      <!-- Setting a time is card metadata; adding to a calendar is a
           separate publish action that only appears once a time exists. -->
      <button
        type="button"
        class="action-row"
        onclick={() => void openSchedule()}
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
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        {scheduledLabel ? `${scheduledLabel} — change…` : 'Set time…'}
      </button>
      {#if item.startsAt}
        <button
          type="button"
          class="action-row"
          onclick={() => void openCalendar()}
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
            <rect x="3" y="4" width="18" height="18" rx="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          {item.eventUrl ? 'On calendar — manage…' : 'Add to calendar…'}
        </button>
      {/if}
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

    {#if showSchedule}
      <ScheduleSheet {item} onclose={() => (showSchedule = false)} />
    {/if}

    {#if showCalendarSheet}
      <AddToCalendarSheet {item} onclose={() => (showCalendarSheet = false)} />
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    background: var(--overlay);
    overflow: hidden;
    overscroll-behavior: contain;
    padding: 1.25rem;
  }

  .modal {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 1120px;
    height: min(920px, calc(100dvh - 2.5rem));
    overflow-y: auto;
    padding: 1.5rem;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  }

  @media (max-width: 600px), (display-mode: standalone) {
    .overlay {
      padding: env(safe-area-inset-top) env(safe-area-inset-right)
        env(safe-area-inset-bottom) env(safe-area-inset-left);
      background: var(--bg);
    }

    .modal {
      max-width: none;
      width: 100%;
      height: 100dvh;
      border: none;
      border-radius: 0;
      padding: 1rem;
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    min-height: 36px;
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

  .save-status {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: none;
    background: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.25rem 0.4rem;
  }

  .save-status.error {
    color: var(--danger);
    cursor: pointer;
  }

  .save-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.65;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    clip-path: inset(50%);
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
    max-height: 42vh;
    object-fit: contain;
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
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  /* ── Header icons ─────────────────────── */

  .header-actions {
    margin-left: auto;
    display: flex;
    gap: 0.25rem;
    position: relative;
  }

  .icon-btn {
    width: 40px;
    height: 40px;
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

  .actions-menu {
    position: absolute;
    z-index: 10;
    top: calc(100% + 0.35rem);
    right: 44px;
    min-width: 168px;
    padding: 0.3rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: 0 12px 32px var(--shadow);
  }

  .actions-menu-item {
    width: 100%;
    min-height: 40px;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
  }

  .actions-menu-danger {
    color: var(--danger);
  }

  .actions-menu-danger:hover,
  .actions-menu-danger:focus-visible {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  @media (max-width: 600px), (display-mode: standalone) {
    .icon-btn {
      width: 44px;
      height: 44px;
    }

    .actions-menu {
      right: 48px;
    }

    .actions-menu-item {
      min-height: 44px;
    }
  }

  /* ── Meta strip ───────────────────────── */

  .meta-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem;
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

  .meta-item.overdue {
    color: var(--danger);
  }

  /* ── Primary filing action ────────────── */

  .btn-file {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    width: 100%;
    background: var(--accent-subtle);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    color: var(--accent);
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
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: auto;
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
