<script lang="ts">
  import LinkCalendarSheet from './LazyLinkCalendarSheet.svelte';
  import EventAgenda from './EventAgenda.svelte';
  import { calendarSyncStatus } from '../lib/calendar-sync';
  import type { InboxItem, InboxItemType, Collection } from '@inbox-rs/rs-module';
  import {
    collectionItems,
    collections,
    deleteItem,
    sortedGroups, moveCollectionToGroup,
    appConfig, updateConfig, reorderCollectionItems,
    groups,
  } from '../lib/stores';
  import { makeTodo } from '../lib/item-utils';
  import {
    filterCompletedTodos,
    filterOnCalendarItems,
    filterOpenTodos,
    filterReferenceItems,
    filterTodos,
    sortCompletedTodosByCompletedAt,
    spliceOpenTodoOrder,
  } from '../lib/collection-todos';
  import { compareByDueTime, isDueTodayOrOverdue } from '../lib/schedule';
  import { todayStart } from '../lib/now';
  import { slide, fade } from 'svelte/transition';
  import { get } from 'svelte/store';
  import { createDndLeaveGuard } from '../lib/dnd-leave-guard';
  import { createReorderFade } from '../lib/reorder-fade';
  import { flip } from 'svelte/animate';
  import { type DndEvent, dragHandleZone } from 'svelte-dnd-action';
  import ReorderGrip from './ReorderGrip.svelte';
  import { captureDetected, captureFile } from '../lib/capture';
  import { collectionDropTarget, startNativeDrag } from '../lib/collection-drop';
  import { COLLECTION_DRAG_MIME, draggingCollectionId, draggingItemId } from '../lib/drag';
  import {
    favoriteCollectionIds,
    items as allItems,
    toggleFavoriteCollection,
  } from '../lib/stores';
  import { fileItem } from '../lib/triage-actions';
  import { columnSets } from '../lib/board-actions';
  import { showToast } from '../lib/toast';
  import InboxCard from './InboxCard.svelte';
  import CaptureBar from './CaptureBar.svelte';
  import AddEntryModal from './AddEntryModal.svelte';
  import TodoQuickAdd from './TodoQuickAdd.svelte';
  import TodoRow from './TodoRow.svelte';

  let showActions = $state(false);

  let { collection, expanded = false, onselect, onedit, ontoggle, onfocus, isTouchDevice = false, reorderable = false }: {
    collection: Collection;
    expanded?: boolean;
    onselect: (item: InboxItem) => void;
    onedit: () => void;
    ontoggle: () => void;
    /** When set, show a header button that opens this collection in focus mode. */
    onfocus?: () => void;
    isTouchDevice?: boolean;
    /** When true, show a grip on the header for drag-sorting on the Collections page. */
    reorderable?: boolean;
  } = $props();

  let showCalendarLink = $state(false);

  // Collection body renders both todos (at the top, drag-sortable) and
  // reference items (the existing masonry grid below) so the page keeps all
  // data in context while the flat Todos page shows the cross-collection view.
  const items = $derived($collectionItems[collection.id] ?? []);
  const todoItems = $derived(filterTodos(items));
  const openTodos = $derived(filterOpenTodos(todoItems));
  // Due/overdue todos render as a pinned non-draggable band above the manual
  // order — same treatment as the flat Todos page, earliest due first.
  const dueTodos = $derived(
    openTodos
      .filter(t => isDueTodayOrOverdue(t, $todayStart))
      .sort(compareByDueTime),
  );
  const restOpenTodos = $derived(
    openTodos.filter(t => !isDueTodayOrOverdue(t, $todayStart)),
  );
  const completedTodos = $derived(
    sortCompletedTodosByCompletedAt(filterCompletedTodos(todoItems))
  );
  // Events lead the references in date order; ones that have ended drop to
  // a collapsed "Past" section — kept, never deleted.
  const allReferenceItems = $derived(filterReferenceItems(items));
  const isEvent = (i: InboxItem) => !!i.startsAt && i.scheduleKind !== 'task';
  const eventEnded = (i: InboxItem, start: number) => {
    const end = new Date(i.endsAt ?? i.startsAt ?? 0);
    if (i.allDay) end.setHours(23, 59, 59, 999);
    return end.getTime() < start;
  };
  const pastEvents = $derived(
    allReferenceItems
      .filter((i) => isEvent(i) && eventEnded(i, $todayStart))
      .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? '')),
  );
  const upcomingEvents = $derived(
    allReferenceItems
      .filter((i) => isEvent(i) && !eventEnded(i, $todayStart))
      .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
  );
  const referenceItems = $derived(allReferenceItems.filter((i) => !isEvent(i)));
  let pastExpanded = $state(false);

  // Items moved to a calendar (todos and cards alike) — one combined
  // collapsed section; the calendar owns them until the entry is removed.
  const onCalendarItems = $derived(filterOnCalendarItems(items));
  const onCalendarTodos = $derived(filterTodos(onCalendarItems));
  const onCalendarRefs = $derived(
    onCalendarItems.filter((i) => !i.isTodo && i.type !== 'todo'),
  );
  let onCalendarExpanded = $state(false);

  // Shared group lookup for TodoRow styling — collection's own color takes
  // priority, but we also supply the group so the pill colour degrades
  // gracefully when a collection has no colour of its own.
  const group = $derived(
    collection.groupId ? ($groups[collection.groupId] ?? null) : null
  );

  // Reuse the global "show completed todos" flag so toggling it here stays in
  // sync with the flat Todos page — users have a single "show completed work"
  // preference rather than N per-collection toggles.
  const completedExpanded = $derived($appConfig.completedTodosExpanded === true);

  let addingType = $state<InboxItemType | null>(null);
  let prefillTitle = $state('');
  let prefillFile = $state<File | undefined>(undefined);
  let showMoveMenu = $state(false);

  // References capture bar — mirrors the inbox, but everything it creates is
  // filed into this collection.
  async function handleCapture(raw: string) {
    let res: Awaited<ReturnType<typeof captureDetected>>;
    try {
      res = await captureDetected(raw, collection.id);
    } catch (error) {
      // e.g. the collection was deleted from another device mid-capture.
      console.error('Failed to capture into collection', error);
      showToast("Couldn't save — this collection is no longer available.");
      return;
    }
    if (!res) return;
    const label = res.item.type === 'bookmark' ? 'Saved bookmark' : 'Saved note';
    showToast(label, {
      label: 'Undo',
      run: () => {
        void deleteItem(res.item.id, res.item);
      },
    });
  }

  function handleOpenEditor(text: string) {
    prefillFile = undefined;
    prefillTitle = text;
    addingType = 'note';
  }

  function handleCaptureFile(file: File) {
    prefillTitle = '';
    prefillFile = file;
    addingType = file.type.startsWith('image/') ? 'image' : 'document';
  }

  // Drop/paste onto the bar: store the file directly into this collection,
  // with the same Undo as a text capture.
  async function handleFileCaptureDirect(file: File, caption = '') {
    let res: Awaited<ReturnType<typeof captureFile>>;
    try {
      res = await captureFile(file, caption, collection.id);
    } catch (error) {
      console.error('Failed to capture file into collection', error);
      showToast("Couldn't save — this collection is no longer available.");
      return;
    }
    if (!res) return;
    const label = res.item.type === 'image' ? 'Saved image' : 'Saved file';
    showToast(label, {
      label: 'Undo',
      run: () => {
        void deleteItem(res.item.id, res.item);
      },
    });
  }

  function notifyExtraFiles(ignored: number) {
    showToast(
      `Captured the first file — ignored ${ignored} other${ignored === 1 ? '' : 's'}.`,
    );
  }

  function handleRecord() {
    prefillTitle = '';
    prefillFile = undefined;
    addingType = 'audio';
  }

  let moveButtonEl = $state<HTMLButtonElement>();
  let menuPos = $state({ top: 0, right: 0 });

  const availableGroups = $derived($sortedGroups);

  function toggleMoveMenu(e: Event) {
    e.stopPropagation();
    if (!showMoveMenu && moveButtonEl) {
      const rect = moveButtonEl.getBoundingClientRect();
      menuPos = {
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      };
    }
    showMoveMenu = !showMoveMenu;
  }

  async function handleMoveToGroup(groupId: string) {
    showMoveMenu = false;
    await moveCollectionToGroup(collection.id, groupId);
  }

  // ── Drag this collection onto a sidebar group to move it there ───────────
  // The sidebar's group rows have always accepted this drop — `groupDropTarget`
  // gates on whether a collection drag is in flight, not on which page is
  // showing — but until now the only thing that could *start* one was a
  // sidebar row. This is the second source, so the gesture works from the
  // Collections page too.
  //
  // It hangs off the move button rather than the header for the same reason it
  // does in the sidebar: a native drag source swallows its own click once the
  // pointer travels a few pixels, and the header's click is expand/collapse.
  // Here that click opens the group menu, which is the same gesture by another
  // route — so losing it to a deliberate drag costs nothing.
  const beingMoved = $derived($draggingCollectionId === collection.id);

  function onCollectionDragStart(e: DragEvent) {
    showMoveMenu = false;
    // `stopPropagation` inside `startNativeDrag` is load-bearing here:
    // svelte-dnd-action puts `ondragstart = () => false` on every direct child
    // of a drop zone, and on the Collections page this card is one.
    const started = startNativeDrag(e, {
      mime: COLLECTION_DRAG_MIME,
      id: collection.id,
      label: collection.name,
    });
    if (started) draggingCollectionId.set(collection.id);
  }

  function onCollectionDragEnd() {
    draggingCollectionId.set(null);
  }

  // ---- Drag-and-drop reordering of open todos ----
  let dndOpen = $state<Array<InboxItem & { id: string }>>([]);
  $effect(() => {
    dndOpen = restOpenTodos.map(t => ({ ...t }));
  });

  // Rows fade when added or removed, but not while being reordered — a
  // lingering outro copy makes svelte-dnd-action lose the row it is carrying.
  const reorderFade = createReorderFade();

  // A two-row list is barely taller than the row being carried, so dragging
  // one todo above the other takes the pointer out of the list; the library
  // would revert the order and the drop would snap back.
  const leaveGuard = createDndLeaveGuard();

  function handleDndConsider(e: CustomEvent<DndEvent<InboxItem & { id: string }>>) {
    if (leaveGuard.ignores(e.detail.info)) return;
    reorderFade.start();
    dndOpen = e.detail.items;
  }

  async function handleDndFinalize(e: CustomEvent<DndEvent<InboxItem & { id: string }>>) {
    leaveGuard.reset();
    const previous = restOpenTodos.map(t => ({ ...t }));
    dndOpen = e.detail.items;
    await reorderFade.end();
    try {
      // Due-band todos lead the persisted order so they resume a sane manual
      // slot once their due date passes out of the band.
      const newItemIds = spliceOpenTodoOrder(
        collection.itemIds,
        openTodos.map(t => t.id),
        [...dueTodos.map(t => t.id), ...dndOpen.map(t => t.id)],
      );
      await reorderCollectionItems(collection.id, newItemIds);
    } catch (error) {
      console.error('Failed to reorder collection todos', error);
      dndOpen = previous;
    }
  }

  // ── Drop an item on the header to file it here ───────────────────────────
  // The classic layout has no sidebar, so this header is the only collection
  // drop target those users get. It's live in both layouts.
  let filingDragOver = $state(false);
  const filingDrag = $derived($draggingItemId !== null);

  async function fileItemHere(itemId: string) {
    filingDragOver = false;
    draggingItemId.set(null);
    if (!itemId || items.some(({ id }) => id === itemId)) return;
    const item = get(allItems)[itemId];
    if (item) await fileItem(item, collection);
  }

  async function toggleCompletedSection() {
    try {
      await updateConfig({ completedTodosExpanded: !completedExpanded });
    } catch (error) {
      console.error('Failed to toggle completed todos', error);
    }
  }

  const isFavorite = $derived($favoriteCollectionIds.includes(collection.id));
  // Board badge: the column set this collection's board uses.
  const boardSetName = $derived(
    collection.boardSetId ? $columnSets.find((s) => s.id === collection.boardSetId)?.name : undefined,
  );
  // Another live collection in the same group with the same name is easy to
  // file into by mistake; say so on both.
  const sameNameInGroup = $derived(
    !!collection.groupId &&
      Object.values($collections).some(
        (c) =>
          c.id !== collection.id &&
          !c.archived &&
          c.groupId === collection.groupId &&
          c.name.trim().toLowerCase() === collection.name.trim().toLowerCase(),
      ),
  );

  async function toggleFavorite(e: MouseEvent) {
    e.stopPropagation();
    try {
      await toggleFavoriteCollection(collection.id);
    } catch (error) {
      console.error('Failed to update favourites', error);
      showToast('Couldn’t update favourites');
    }
  }
</script>

<div class="collection" class:reorderable class:being-moved={beingMoved} style="--col-color: {collection.color || '#6366f1'}" class:expanded>
  <!-- Header bar -->
  <div
    class="collection-header"
    class:filing={filingDrag}
    class:filing-over={filingDragOver}
    role="button"
    tabindex="0"
    onclick={ontoggle}
    onkeydown={(e) => {
      // Only when the header itself is focused — Enter/Space on a child
      // button (focus/edit/move) bubbles here, and without this guard the
      // preventDefault would swallow the button's activation and toggle
      // the collection instead.
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ontoggle(); }
    }}
    aria-expanded={expanded}
    aria-describedby={`collection-counts-${collection.id}`}
    aria-label="{expanded ? 'Collapse' : 'Expand'} {collection.name}"
    use:collectionDropTarget={{
      ondrop: (itemId) => void fileItemHere(itemId),
      onhover: (isOver) => { filingDragOver = isOver; },
    }}
  >
    {#if reorderable}
      <ReorderGrip label="Drag to reorder {collection.name}" />
    {/if}
    <span class="color-indicator"></span>
    <svg aria-hidden="true" class="chevron" class:open={expanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
    <div class="header-info">
      <!-- The heading holds the name alone: anything else inside it (even
           whitespace before a sibling block) changes its text, which is how
           tests and assistive tech identify the collection. -->
      <div class="title-line">
        <h3>{collection.name}</h3>
        {#if isFavorite}
          <svg class="fav-mark" role="img" aria-label="Favourite" width="13" height="13" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z"></path></svg>
        {/if}
      </div>
      {#if boardSetName || collection.offPlan || sameNameInGroup || collection.calendar}
        <span class="col-tags">
          {#if collection.calendar}
            {@const calStatus = $calendarSyncStatus[collection.calendar.url]}
            <button
              type="button"
              class="cal-badge"
              class:error={!!calStatus?.error}
              style="--cal-color: {collection.calendar.color || 'var(--accent)'}"
              title={calStatus?.error
                ? `${collection.calendar.name}: ${calStatus.error}`
                : `Linked to ${collection.calendar.name} — kept in sync`}
              aria-label="Calendar link: {collection.calendar.name}"
              onclick={(e) => { e.stopPropagation(); showCalendarLink = true; }}
            >
              <svg class="cal-badge-icon" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>{collection.calendar.name} calendar
            </button>
          {/if}
          {#if boardSetName}<span class="board-badge" title="Board columns: {boardSetName}">{boardSetName}</span>{/if}
          {#if collection.offPlan}<span class="board-badge list" title={collection.planColumnId
              ? 'A list: its todos stay off the Todos plan, except its plan column’s'
              : 'A list: its todos stay off the Todos plan'}>List</span>{/if}
          {#if sameNameInGroup}<span class="name-warn">same name as another collection here</span>{/if}
        </span>
      {/if}
      {#if collection.description && !expanded}
        <span class="col-description">{collection.description}</span>
      {/if}
    </div>
    <div class="header-badges" id={`collection-counts-${collection.id}`}>
      {#if openTodos.length > 0}
        <span class="badge badge-todos" aria-label="{openTodos.length} open todos" title="{openTodos.length} open {openTodos.length === 1 ? 'todo' : 'todos'}">
          {openTodos.length} {openTodos.length === 1 ? 'todo' : 'todos'}
        </span>
      {/if}
      {#if upcomingEvents.length > 0}
        <span class="badge badge-ref" aria-label="{upcomingEvents.length} upcoming events" title="{upcomingEvents.length} upcoming {upcomingEvents.length === 1 ? 'event' : 'events'}">
          {upcomingEvents.length} upcoming
        </span>
      {/if}
      {#if referenceItems.length > 0}
        <span class="badge badge-ref" aria-label="{referenceItems.length} reference items" title="{referenceItems.length} reference items">
          {referenceItems.length} {referenceItems.length === 1 ? 'reference' : 'references'}
        </span>
      {:else if openTodos.length === 0 && upcomingEvents.length === 0}
        <span class="badge badge-ref" aria-label="0 reference items" title="0 reference items">0 references</span>
      {/if}
    </div>
    <button
      type="button"
      class="actions-toggle"
      aria-label="Actions for {collection.name}"
      aria-expanded={showActions}
      aria-controls="collection-actions-{collection.id}"
      onclick={(e) => { e.stopPropagation(); showActions = !showActions; }}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
    </button>
    <div class="header-actions" class:actions-open={showActions} id="collection-actions-{collection.id}">
      {#if !collection.archived && !group?.archived}
      <button
        type="button"
        class="btn-header btn-favorite"
        class:on={isFavorite}
        aria-pressed={isFavorite}
        onclick={toggleFavorite}
        aria-label={isFavorite ? `Remove ${collection.name} from favourites` : `Add ${collection.name} to favourites`}
        title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
      >
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z"></path>
        </svg>
      </button>
      {/if}
      {#if onfocus}
        <button type="button" class="btn-header" onclick={(e) => { e.stopPropagation(); onfocus(); }} aria-label="Focus on {collection.name}" title="Focus">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
            <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
            <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
            <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
          </svg>
        </button>
      {/if}
      <button type="button" class="btn-header" onclick={(e) => { e.stopPropagation(); onedit(); }} aria-label="Edit collection" title="Edit">
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
      {#if availableGroups.length > 0}
        <div class="move-menu-wrapper">
          <button
            type="button"
            class="btn-header collection-move-btn"
            bind:this={moveButtonEl}
            draggable="true"
            aria-label="Move to group"
            aria-haspopup="menu"
            aria-expanded={showMoveMenu}
            title="Drag onto a group in the sidebar, or click to choose one"
            onclick={toggleMoveMenu}
            ondragstart={onCollectionDragStart}
            ondragend={onCollectionDragEnd}
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <polyline points="9 14 12 11 15 14"></polyline>
            </svg>
          </button>
          {#if showMoveMenu}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="move-menu-backdrop" onclick={(e) => { e.stopPropagation(); showMoveMenu = false; }}></div>
            <div class="move-menu" style="top: {menuPos.top}px; right: {menuPos.right}px;" onclick={(e) => e.stopPropagation()}>
              <div class="move-menu-label">Move to group</div>
              {#each availableGroups as g (g.id)}
                <button type="button"
                  class="move-menu-item"
                  class:current={collection.groupId === g.id}
                  onclick={() => handleMoveToGroup(g.id)}
                  disabled={collection.groupId === g.id}
                >
                  <span class="move-dot" style="background: {g.color || 'var(--accent)'}"></span>
                  {g.name}
                  {#if collection.groupId === g.id}
                    <svg aria-hidden="true" class="check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Expanded body: Todos section (drag-sortable) and References section,
       each with a simple header + inline add affordance. Both sections are
       always rendered when expanded so users have a consistent path to add
       new items regardless of current contents — empty states sit quietly
       under the headers instead of replacing them. -->
  {#if expanded}
    <div
      class="collection-body"
      transition:slide={{ duration: isTouchDevice ? 0 : 200 }}
      onmousedown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest('input, button, a, .reorder-handle')) e.stopPropagation();
      }}
      ontouchstart={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest('input, button, a, .reorder-handle')) e.stopPropagation();
      }}
    >
      <section class="todos-section" aria-label="Todos in {collection.name}">
        <div class="section-header">
          <h4>Todos</h4>
        </div>
        <!-- Same quick-add as the Todos page, filing into this collection (no
             collection select needed — it's fixed). ⌘↵ opens the full modal. -->
        <TodoQuickAdd
          compact
          fixedCollectionId={collection.id}
          onopenmodal={(t) => { prefillTitle = t; addingType = 'todo'; }}
        />

        {#if dueTodos.length > 0}
          <div class="due-band">
            <div class="due-header">Due</div>
            <ul class="todo-list" role="list">
              {#each dueTodos as todo (todo.id)}
                <TodoRow {todo} {collection} viewing={collection} {group} {onselect} />
              {/each}
            </ul>
          </div>
        {/if}

        {#if dndOpen.length > 0}
          <ul
            class="todo-list" role="list"
            use:dragHandleZone={{
              items: dndOpen,
              flipDurationMs: 200,
              // A wide row's centre can leave the zone while its left-hand
              // grip is still over a valid slot. Detect drops at the pointer.
              useCursorForDetection: true,
              dropTargetStyle: {},
              // No `dragDisabled` — see the note in SidebarShell. Every
              // `dragHandleZone` shares one module-global copy of that flag,
              // so setting it here disabled every grip on the page. Reorder is
              // gated on the handle anyway.
              type: `todos-collection-${collection.id}`,
            }}
            onconsider={handleDndConsider}
            onfinalize={handleDndFinalize}
          >
            {#each dndOpen as todo (todo.id)}
              <li animate:flip={{ duration: 200 }} in:reorderFade.fade={{ duration: 180 }} out:reorderFade.fade={{ duration: 120 }}>
                <TodoRow as="div" {todo} {collection} viewing={collection} {group} reorderable {onselect} />
              </li>
            {/each}
          </ul>
        {:else if dueTodos.length === 0 && completedTodos.length === 0}
          <p class="section-empty">No todos yet.</p>
        {/if}

        {#if completedTodos.length > 0}
          <button type="button"
            class="btn-completed-toggle"
            onclick={toggleCompletedSection}
            aria-expanded={completedExpanded}
          >
            <svg aria-hidden="true" class="chevron-sm" class:open={completedExpanded} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            {completedTodos.length} completed
          </button>
          {#if completedExpanded}
            <ul class="todo-list completed-list" role="list" transition:slide={{ duration: isTouchDevice ? 0 : 200 }}>
              {#each completedTodos as todo (todo.id)}
                <div in:fade={{ duration: 150 }}>
                  <TodoRow {todo} {collection} viewing={collection} {group} {onselect} />
                </div>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>

      {#if upcomingEvents.length > 0}
        <section class="events-section" aria-label="Upcoming events in {collection.name}">
          <div class="section-header">
            <h4>Upcoming</h4>
          </div>
          <EventAgenda events={upcomingEvents} {onselect} viewing={collection} />
        </section>
      {/if}

      <section class="references-section" aria-label="References in {collection.name}">
        <div class="section-header">
          <h4>References</h4>
        </div>
        <!-- Same capture input as the inbox; everything it creates is filed
             into this collection. Todos have their own section above, so
             ⌘↵ here opens the note editor (not a todo). -->
        <CaptureBar
          oncapture={handleCapture}
          onopeneditor={handleOpenEditor}
          onfile={handleCaptureFile}
          onfilecapture={handleFileCaptureDirect}
          onextrafiles={notifyExtraFiles}
          onrecord={handleRecord}
        />

        {#if referenceItems.length > 0}
          <div class="grid">
            {#each referenceItems as item (item.id)}
              <div class="grid-card-wrapper">
                <InboxCard {item} {onselect} viewing={collection} />
                <div class="card-actions">
                  <button type="button" class="btn-card-action" onclick={() => makeTodo(item)} title="Move to todos" aria-label="Make todo">
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="section-empty">No references yet.</p>
        {/if}
      </section>

      {#if pastEvents.length > 0}
        <section class="on-calendar-section" aria-label="Past events in {collection.name}">
          <button type="button"
            class="btn-completed-toggle"
            onclick={() => (pastExpanded = !pastExpanded)}
            aria-expanded={pastExpanded}
          >
            <svg aria-hidden="true" class="chevron-sm" class:open={pastExpanded} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            {pastEvents.length} past {pastEvents.length === 1 ? 'event' : 'events'}
          </button>
          {#if pastExpanded}
            <div class="on-calendar-body" transition:slide={{ duration: isTouchDevice ? 0 : 200 }}>
              <EventAgenda events={pastEvents} {onselect} viewing={collection} past />
            </div>
          {/if}
        </section>
      {/if}

      {#if onCalendarItems.length > 0}
        <section class="on-calendar-section" aria-label="Archived in {collection.name}">
          <button type="button"
            class="btn-completed-toggle"
            onclick={() => (onCalendarExpanded = !onCalendarExpanded)}
            aria-expanded={onCalendarExpanded}
          >
            <svg aria-hidden="true" class="chevron-sm" class:open={onCalendarExpanded} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            {onCalendarItems.length} archived
          </button>
          {#if onCalendarExpanded}
            <div class="on-calendar-body" transition:slide={{ duration: isTouchDevice ? 0 : 200 }}>
              {#if onCalendarTodos.length > 0}
                <ul class="todo-list completed-list" role="list">
                  {#each onCalendarTodos as todo (todo.id)}
                    <TodoRow {todo} readonly {collection} viewing={collection} {group} {onselect} />
                  {/each}
                </ul>
              {/if}
              {#if onCalendarRefs.length > 0}
                <div class="grid on-calendar-grid">
                  {#each onCalendarRefs as item (item.id)}
                    <div class="grid-card-wrapper">
                      <InboxCard {item} {onselect} viewing={collection} />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
</div>

{#if addingType}
  <AddEntryModal
    type={addingType}
    collectionId={collection.id}
    {prefillTitle}
    {prefillFile}
    onclose={() => { addingType = null; prefillTitle = ''; prefillFile = undefined; }}
    ondelete={async (item) => { await deleteItem(item.id, item); addingType = null; prefillTitle = ''; prefillFile = undefined; }}
  />
{/if}

{#if showCalendarLink}
  <LinkCalendarSheet {collection} onclose={() => (showCalendarLink = false)} />
{/if}

<style>
  /* ================================================================
     COLLECTION — mirrors the inbox page layout when expanded
     ================================================================ */
  .collection {
    --_col: var(--col-color);
    border-radius: var(--radius);
    transition: box-shadow 250ms ease;
  }

  /* Dims in place while it's being carried to a sidebar group, so it's obvious
     which card the drag picked up. Matches the sidebar row's own feedback. */
  .collection.being-moved {
    opacity: 0.4;
  }

  @media (pointer: fine) {
    .collection {
      overflow: hidden;
    }
  }

  .collection.expanded {
    box-shadow:
      0 1px 0 0 color-mix(in srgb, var(--_col) 20%, transparent 80%),
      0 4px 24px -4px var(--shadow);
  }

  /* ---- Header bar ---- */
  .cal-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.08rem 0.45rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--cal-color) 40%, var(--border));
    background: color-mix(in srgb, var(--cal-color) 10%, transparent);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.7rem;
    font-weight: 550;
    line-height: 1.4;
    cursor: pointer;
    white-space: nowrap;
  }

  .cal-badge:hover {
    color: var(--text);
  }

  .cal-badge.error {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
    color: var(--danger-text);
  }

  .cal-badge-icon {
    color: var(--cal-color);
  }

  .collection-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: background 150ms, border-color 150ms, border-radius 200ms;
    min-height: 3rem;
    -webkit-tap-highlight-color: transparent;
  }

  .expanded .collection-header {
    border-radius: var(--radius) var(--radius) 0 0;
    border-bottom-color: transparent;
  }

  .collection-header:hover {
    border-color: color-mix(in srgb, var(--_col) 40%, var(--border) 60%);
  }

  /* Filing-drag feedback. Layout-neutral on purpose (colour and outline only):
     anything that reflows the header would move the subtree under the cursor
     mid-drag and the browser would cancel the drop instead of delivering it. */
  .collection-header.filing {
    outline: 1px dashed color-mix(in srgb, var(--_col) 55%, var(--border));
    outline-offset: -1px;
  }

  /* The header must be the only hit-test target in its subtree while a filing
     drag is in flight, or every crossing onto the chevron, a badge or an icon
     button fires dragleave/dragenter and the drop state flickers. */
  .collection-header.filing > * {
    pointer-events: none;
  }

  .collection-header.filing-over {
    background: color-mix(in srgb, var(--_col) 18%, var(--surface));
    outline: 2px solid var(--_col);
  }

  .color-indicator {
    width: 4px;
    align-self: stretch;
    min-height: 1.25rem;
    border-radius: 2px;
    background: var(--_col);
    flex-shrink: 0;
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1);
    color: var(--text-muted);
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .header-info {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  h3 {
    font-size: 0.95rem;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .col-description {
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    opacity: 0.7;
  }

  .header-badges {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    line-height: 1.3;
  }

  .badge-ref {
    color: var(--text-muted);
    background: color-mix(in srgb, var(--text-muted) 12%, transparent 88%);
    font-weight: 500;
  }

  /* Separate open-todo badge so the colored count reads as "active work" and
     doesn't blend into the neutral reference count. */
  .col-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.15rem;
  }

  .board-badge {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--accent-text);
    background: var(--accent-subtler);
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
  }

  .board-badge.list {
    color: var(--text-muted);
    background: var(--surface-tint);
  }

  .name-warn {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--warn-text);
  }

  .badge-todos {
    color: var(--text);
    background: color-mix(in srgb, var(--_col) 18%, var(--surface));
  }

  .actions-toggle { display: none; }

  .header-actions {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
    opacity: 1;
    transition: opacity 150ms;
  }

  /* Keyboard users tabbing into the header see its actions too. */
  .collection-header:hover .header-actions,
  .collection-header:focus-within .header-actions {
    opacity: 1;
  }

  /* Same reveal rule as `.header-actions` below: quiet until you're on the
     header, and always on for touch, where there is no hover to reveal it
     with and the grip is the only way to reorder. */
  .collection-header:hover,
  .collection-header:focus-within {
    --row-action-opacity: 1;
  }

  .collection-header {
    --row-action-color: var(--_col, var(--accent));
    --row-action-opacity: 1;
  }

  @media (hover: none) {
    .collection-header {
      --row-action-opacity: 1;
    }
  }

  /* On touch devices, always show actions */
  @media (hover: none) {
    .header-actions {
      opacity: 1;
    }
  }

  .btn-favorite.on {
    color: var(--favorite);
  }

  .title-line {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .fav-mark {
    flex-shrink: 0;
    fill: var(--favorite);
  }

  .btn-header {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
    -webkit-tap-highlight-color: transparent;
  }

  .btn-header:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .btn-header:active {
    background: var(--surface-tint-hover);
  }

  /* ---- Move menu (dropdown) ---- */
  .move-menu-wrapper {
    position: relative;
  }

  .move-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
  }

  .move-menu {
    position: fixed;
    z-index: 50;
    min-width: 180px;
    padding: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px var(--shadow);
  }

  .move-menu-label {
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 0.3rem 0.5rem 0.2rem;
  }

  .move-menu-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.5rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.82rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 120ms;
    text-align: left;
    min-height: 2.25rem;
  }

  .move-menu-item:hover:not(:disabled) {
    background: var(--accent-subtler);
  }

  .move-menu-item:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .move-menu-item.current {
    color: var(--text-muted);
  }

  .move-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .check-icon {
    margin-left: auto;
    color: var(--accent-text);
    flex-shrink: 0;
  }

  /* ================================================================
     EXPANDED BODY — dark background so cards pop (like inbox page)
     ================================================================ */
  .collection-body {
    background: var(--bg);
    border: 1px solid var(--border);
    border-top: 1px solid color-mix(in srgb, var(--_col) 15%, var(--border) 85%);
    border-radius: 0 0 var(--radius) var(--radius);
    padding: 1.25rem;
  }

  /* ---- Section framing (Todos + References share the same pattern) ---- */
  .todos-section,
  .events-section {
    margin-bottom: 1.25rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    /* Allow the add-strip to shrink/scroll rather than push the title out. */
    min-width: 0;
  }

  .section-header h4 {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin: 0;
    flex-shrink: 0;
  }

  /* Capture bar sits below the References header; give it room above the grid. */
  .references-section :global(.capture) {
    margin-bottom: 0.75rem;
  }

  .section-empty {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0.15rem;
    opacity: 0.75;
  }

  /* Inline quick-add (todos) + capture bar (references) sit below their section
     headers; give them room before the list/grid that follows. */
  .todos-section :global(.quick-add) {
    margin-bottom: 0.6rem;
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  /* Pinned due/overdue band — mirrors the flat Todos page's treatment. */
  .due-band {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.6rem;
    padding-bottom: 0.6rem;
    border-bottom: 1px dashed var(--border);
  }

  .due-header {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--danger-text);
    padding: 0 0.25rem;
  }

  .completed-list {
    margin-top: 0.4rem;
    opacity: 0.75;
  }

  .on-calendar-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border);
  }

  .on-calendar-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .on-calendar-grid {
    margin-top: 0.4rem;
    opacity: 0.75;
  }

  .btn-completed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.4rem 0.3rem;
    margin-top: 0.6rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: color 150ms;
  }

  .btn-completed-toggle:hover {
    color: var(--text);
  }

  .chevron-sm {
    color: var(--text-muted);
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .chevron-sm.open {
    transform: rotate(0);
  }

  /* ---- Reference grid (masonry — same as InboxGrid) ---- */
  .grid {
    column-count: 3;
    column-gap: 1rem;
  }

  .grid-card-wrapper {
    break-inside: avoid;
    margin-bottom: 1rem;
    position: relative;
  }

  .card-actions {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    display: flex;
    gap: 0.2rem;
    opacity: 0;
    transition: opacity 150ms;
  }

  .grid-card-wrapper:hover .card-actions {
    opacity: 1;
  }

  @media (hover: none) {
    .card-actions {
      opacity: 1;
    }
  }

  .btn-card-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 150ms, background 150ms;
    box-shadow: 0 1px 4px var(--shadow);
  }

  .btn-card-action:hover {
    color: var(--accent-text);
    background: var(--bg);
  }

  /* ================================================================
     RESPONSIVE — mobile-first breakpoints
     ================================================================ */

  /* Stacked layout on mobile + tablet */
  @media (max-width: 900px) {
    .grid {
      column-count: 2;
    }
  }

  @media (max-width: 768px) {
    .collection-body {
      padding: 1rem;
    }

    .col-description {
      display: none;
    }
  }

  @media (max-width: 600px) {
    .collection-header {
      display: grid;
      grid-template-columns: 24px 4px 16px minmax(0, 1fr) auto 44px;
      gap: 0.35rem;
    }
    .color-indicator { grid-column: 2; grid-row: 1 / 3; }
    .chevron { grid-column: 3; grid-row: 1 / 3; }
    .header-info { grid-column: 4 / 6; grid-row: 1; }
    .header-info h3 { white-space: normal; overflow-wrap: anywhere; }
    .actions-toggle {
      grid-column: 6;
      grid-row: 1 / 3;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: var(--radius-sm);
      background: var(--surface-tint);
      color: var(--text-muted);
    }
    .header-actions { display: none; grid-column: 2 / -1; grid-row: 3; justify-content: flex-end; opacity: 1; }
    .header-actions.actions-open { display: flex; }
    .btn-header { width: 44px; height: 44px; }
    .header-badges { grid-column: 4 / 6; grid-row: 2; }
    .collection-header :global(.reorder-grip) { grid-column: 1; grid-row: 1 / 3; min-height: 44px; }
  }

  @media (max-width: 550px) {
    .grid {
      column-count: 1;
    }

    .collection-header {
      padding: 0.65rem 0.75rem;
    }

    .collection-body {
      padding: 0.75rem;
    }
  }
</style>
