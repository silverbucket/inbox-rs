<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { dndzone } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { slide, fade } from 'svelte/transition';
  import {
    visibleTodos, visibleOnCalendarTodos, reorderTodosGlobal,
    collections, sortedGroups, appConfig, updateConfig,
  } from '../lib/stores';
  import { isDueTodayOrOverdue } from '../lib/schedule';
  import { todayStart } from '../lib/now';
  import AlertsPermissionBanner from './AlertsPermissionBanner.svelte';
  import TodoRow from './TodoRow.svelte';
  import TodoQuickAdd from './TodoQuickAdd.svelte';
  import Fab from './Fab.svelte';

  let { onselect, onaddtodo, onaddtodoincollection }: {
    onselect: (item: InboxItem) => void;
    /** Opens the add-todo modal for richer details and optional filing.
        Optionally pre-fills the todo title (⌘/Ctrl-Enter from the quick-add)
        and the target collection (mirrors the quick-add's collection select). */
    onaddtodo: (prefillTitle?: string, collectionId?: string) => void;
    /** Opens the add-todo modal with a specific collection pre-selected.
        Used by the per-row quick-add affordance. Pass `undefined` to target
        an unfiled todo. */
    onaddtodoincollection: (collectionId: string | undefined) => void;
  } = $props();

  const todos = $derived($visibleTodos);
  const openTodos = $derived(todos.filter(t => !t.completed));
  // The store pins due todos first (earliest due leading); the page renders
  // them as a separate non-draggable band so manual ordering stays meaningful
  // for everything below.
  const dueTodos = $derived(
    openTodos.filter(t => isDueTodayOrOverdue(t, $todayStart)),
  );
  const restOpenTodos = $derived(
    openTodos.filter(t => !isDueTodayOrOverdue(t, $todayStart)),
  );
  // Completed todos are sorted newest-first by completedAt for the collapsed
  // section — the global order only governs open todos.
  const completedTodos = $derived(
    todos.filter(t => t.completed)
      .slice()
      .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime()
                     - new Date(a.completedAt ?? a.createdAt).getTime())
  );

  // Group map by collection id, so each TodoRow can show its collection's color
  // and the parent group color without re-deriving per row.
  const collectionMap = $derived($collections);
  const groupMap = $derived(() => {
    const out: Record<string, typeof $sortedGroups[number]> = {};
    for (const g of $sortedGroups) out[g.id] = g;
    return out;
  });

  const completedExpanded = $derived($appConfig.completedTodosExpanded === true);

  // Todos moved to a calendar — the calendar owns them now. Collapsed by
  // default; local state only (unlike completed, no cross-device flag yet).
  const onCalendarTodos = $derived($visibleOnCalendarTodos);
  let onCalendarExpanded = $state(false);

  let isTouchDevice = $state(false);

  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // Local mutable copy for the dnd zone. Kept in sync with the derived list
  // whenever the upstream order changes — except while the user is mid-drag,
  // where `handleDndConsider` is authoritative.
  let dndOpen = $state<Array<InboxItem & { id: string }>>([]);
  $effect(() => {
    dndOpen = restOpenTodos.map(t => ({ ...t }));
  });

  function handleDndConsider(e: CustomEvent<{ items: Array<InboxItem & { id: string }> }>) {
    dndOpen = e.detail.items;
  }

  async function handleDndFinalize(e: CustomEvent<{ items: Array<InboxItem & { id: string }> }>) {
    const previous = restOpenTodos.map(t => ({ ...t }));
    dndOpen = e.detail.items;
    try {
      // Persist just the open ids — completed todos fall back to completedAt
      // ordering on re-render, so we don't need to thread them through config.
      // Due-band todos lead the persisted order so they resume a sane manual
      // slot once their due date passes out of the band.
      await reorderTodosGlobal([
        ...dueTodos.map(t => t.id),
        ...dndOpen.map(t => t.id),
      ]);
    } catch (error) {
      console.error('Failed to reorder todos', error);
      dndOpen = previous;
    }
  }

  async function toggleCompletedSection() {
    try {
      await updateConfig({ completedTodosExpanded: !completedExpanded });
    } catch (error) {
      console.error('Failed to toggle completed todos section', error);
    }
  }

  function lookupCollection(id: string | undefined) {
    if (!id) return null;
    return collectionMap[id] ?? null;
  }

  function lookupGroup(collectionId: string | undefined) {
    const col = lookupCollection(collectionId);
    if (!col?.groupId) return null;
    return groupMap()[col.groupId] ?? null;
  }
</script>

<div class="todos-page">
  <AlertsPermissionBanner />
  <!--
    Toolbar: count + Fab (the Fab is an inline pill on desktop, position:fixed
    and out of flow on mobile). Rendered BELOW the quick-add in the populated
    state — and at the top of the empty hero — so the quick-add input lines up
    vertically with the inbox's capture bar when switching tabs.
  -->
  {#snippet todoToolbar()}
    <!-- Desktop: hidden — capture happens in the input (Enter quick-adds,
         ⌘/Ctrl-Enter opens the modal). Mobile: the Fab is position:fixed, a
         floating + circle in the thumb zone. -->
    <div class="page-toolbar">
      <Fab onclick={() => onaddtodo()} label="New todo" />
    </div>
  {/snippet}

  {#if openTodos.length === 0 && completedTodos.length === 0 && onCalendarTodos.length === 0}
    <!-- Lead with the composer so its input lines up with the inbox capture
         bar. The toolbar's Fab is hidden on desktop (the input + ⌘↵ handle
         capture) and a floating + circle on mobile. -->
    <TodoQuickAdd hideOnMobile focusOnMount onopenmodal={(t, c) => onaddtodo(t, c)} />
    {@render todoToolbar()}
    <div class="empty-state" in:fade={{ duration: 180 }}>
      <p class="empty-title">Jot a todo</p>
      <p class="empty-hint empty-hint--desktop">Capture it now. Organize it later.</p>
      <!-- Mobile: the inline composer is hidden in favour of the floating
           FAB, so the hint needs to point at it. CSS swaps which line shows. -->
      <p class="empty-hint empty-hint--mobile">Tap + to capture one. Organize it later.</p>
    </div>
  {:else}
    <TodoQuickAdd hideOnMobile compact focusOnMount onopenmodal={(t, c) => onaddtodo(t, c)} />
    {@render todoToolbar()}

    {#if dueTodos.length > 0}
      <div class="due-band">
        <div class="due-header">Due</div>
        <!-- TodoRow renders its own <li>, so rows sit directly in the list —
             no transition wrapper (a div between ul and li breaks list
             semantics for assistive tech). -->
        <ul class="todo-list" role="list">
          {#each dueTodos as todo (todo.id)}
            <TodoRow
              {todo}
              collection={lookupCollection(todo.collectionId)}
              group={lookupGroup(todo.collectionId)}
              {onselect}
              onaddincollection={onaddtodoincollection}
            />
          {/each}
        </ul>
      </div>
    {/if}

    <ul
      class="todo-list" role="list"
      use:dndzone={{
        items: dndOpen,
        flipDurationMs: 200,
        dropTargetStyle: {},
        dragDisabled: isTouchDevice,
        type: 'todos-global',
      }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
    >
      {#each dndOpen as todo (todo.id)}
        <div
          animate:flip={{ duration: 200 }}
          in:fade={{ duration: 180 }}
          out:fade={{ duration: 120 }}
        >
          <TodoRow
            {todo}
            collection={lookupCollection(todo.collectionId)}
            group={lookupGroup(todo.collectionId)}
            {onselect}
            onaddincollection={onaddtodoincollection}
          />
        </div>
      {/each}
    </ul>

    {#if completedTodos.length > 0}
      <div class="completed-section">
        <button type="button"
          class="btn-completed-toggle"
          onclick={toggleCompletedSection}
          aria-expanded={completedExpanded}
        >
          <svg aria-hidden="true" class="chevron" class:open={completedExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          {completedTodos.length} completed
        </button>

        {#if completedExpanded}
          <ul
            class="todo-list completed-list"
            role="list"
            transition:slide={{ duration: isTouchDevice ? 0 : 200 }}
          >
            {#each completedTodos as todo (todo.id)}
              <div in:fade={{ duration: 150 }}>
                <TodoRow
                  {todo}
                  collection={lookupCollection(todo.collectionId)}
                  group={lookupGroup(todo.collectionId)}
                  {onselect}
                  onaddincollection={onaddtodoincollection}
                />
              </div>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if onCalendarTodos.length > 0}
      <div class="completed-section">
        <button type="button"
          class="btn-completed-toggle"
          onclick={() => (onCalendarExpanded = !onCalendarExpanded)}
          aria-expanded={onCalendarExpanded}
        >
          <svg aria-hidden="true" class="chevron" class:open={onCalendarExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          {onCalendarTodos.length} on calendar
        </button>

        {#if onCalendarExpanded}
          <ul
            class="todo-list completed-list"
            role="list"
            transition:slide={{ duration: isTouchDevice ? 0 : 200 }}
          >
            {#each onCalendarTodos as todo (todo.id)}
              <TodoRow
                {todo}
                readonly
                collection={lookupCollection(todo.collectionId)}
                group={lookupGroup(todo.collectionId)}
                {onselect}
              />
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .todos-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .page-toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* Desktop: no inline New-todo pill — capture lives in the input (Enter to
     quick-add, ⌘/Ctrl-Enter to open the modal). On mobile the Fab is
     position:fixed (out of flow), so the floating + circle still shows. */
  @media (min-width: 769px) {
    .page-toolbar {
      display: none;
    }
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .due-band {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px dashed var(--border);
  }

  .due-header {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--danger);
    padding: 0 0.25rem;
  }

  .completed-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border);
  }

  .completed-list {
    margin-top: 0.4rem;
    opacity: 0.75;
  }

  .btn-completed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: color 150ms, background 150ms;
  }

  .btn-completed-toggle:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .chevron.open {
    transform: rotate(0);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    /* Sits below the composer now, so it needs only a little breathing room
       above rather than the full hero offset. */
    padding: 1.5rem 1rem 1rem;
    text-align: center;
    color: var(--text-muted);
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .empty-hint {
    font-size: 0.85rem;
    max-width: 32rem;
    margin: 0;
  }

  /* Mobile-only sibling — hidden by default, revealed in the mobile media
     query below. Keeps both lines in the DOM so screen readers see only the
     one that's currently visible. */
  .empty-hint--mobile {
    display: none;
  }

  /*
   * Mobile: the floating FAB is the canonical capture surface (TodoQuickAdd
   * hides itself there via hideOnMobile), so reserve a little bottom padding
   * and swap the empty-state hint to one that points at the FAB.
   */
  @media (max-width: 768px) {
    .todos-page {
      padding-bottom: 5rem;
    }

    .empty-hint--desktop {
      display: none;
    }

    .empty-hint--mobile {
      display: block;
    }
  }

  @media (max-width: 600px) {
    .todos-page {
      padding-bottom: 4.5rem;
    }
  }
</style>
