<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { tick } from 'svelte';
  import { dndzone } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { slide, fade } from 'svelte/transition';
  import {
    visibleTodos, reorderTodosGlobal, storeItem, moveItemToCollection,
    collections, sortedGroups, groupCollections, appConfig, updateConfig,
  } from '../lib/stores';
  import { canCaptureTodo, makeUnfiledTodo } from '../lib/add-entry-modal';
  import { autofocusIf } from '../lib/actions';
  import { modLabel } from '../lib/platform';
  import TodoRow from './TodoRow.svelte';
  import Fab from './Fab.svelte';

  let { onselect, onaddtodo, onaddtodoincollection }: {
    onselect: (item: InboxItem) => void;
    /** Opens the add-todo modal for richer details and optional filing.
        Optionally pre-fills the todo title (⌘/Ctrl-Enter from the quick-add). */
    onaddtodo: (prefillTitle?: string) => void;
    /** Opens the add-todo modal with a specific collection pre-selected.
        Used by the per-row quick-add affordance. Pass `undefined` to target
        an unfiled todo. */
    onaddtodoincollection: (collectionId: string | undefined) => void;
  } = $props();

  const todos = $derived($visibleTodos);
  const openTodos = $derived(todos.filter(t => !t.completed));
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

  let isTouchDevice = $state(false);
  let quickTitle = $state('');
  let quickSaving = $state(false);
  let quickError = $state('');
  let quickFocused = $state(false);
  // Platform-aware modifier label for the focus hint (⌘ on macOS, Ctrl else).
  const mod = modLabel();
  // Bound from the quick-add input so we can restore focus after a submit
  // — `disabled` toggling during the save blurs the input, and the first
  // todo also remounts the input as the page transitions hero → compact.
  let quickInputEl = $state<HTMLInputElement | undefined>(undefined);

  // Quick-add collection target. Stored in localStorage rather than the
  // synced appConfig: it's a per-device preference, and a `config/app`
  // remote-change event can otherwise deliver the server's pre-write copy
  // and clobber a just-set local value before the push completes.
  const QUICK_ADD_KEY = 'inbox-rs:quickAddCollectionId';
  function readStoredQuickAddId(): string | undefined {
    try {
      return localStorage.getItem(QUICK_ADD_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }
  let storedQuickAddId = $state<string | undefined>(readStoredQuickAddId());

  // Trailing "Other" optgroup — without this, a user with only ungrouped
  // collections would see no options beyond "Unfiled".
  const ungroupedCollections = $derived(
    Object.values(collectionMap).filter(c => !c.groupId || !groupMap()[c.groupId])
  );

  // Stale ids (collection deleted in another session/tab) silently fall
  // back to Unfiled. We don't scrub localStorage here because a transient
  // empty `collectionMap` during cold load would otherwise wipe a valid id.
  const quickAddCollectionId = $derived.by(() => {
    const id = storedQuickAddId;
    return id && collectionMap[id] ? id : undefined;
  });

  function setQuickAddCollection(id: string | undefined) {
    storedQuickAddId = id;
    try {
      if (id) {
        localStorage.setItem(QUICK_ADD_KEY, id);
      } else {
        localStorage.removeItem(QUICK_ADD_KEY);
      }
    } catch (error) {
      console.error('Failed to persist quick-add collection', error);
    }
  }

  async function addQuickTodo() {
    if (!canCaptureTodo(quickTitle) || quickSaving) return;
    quickSaving = true;
    quickError = '';
    try {
      const todo = makeUnfiledTodo(quickTitle);
      await storeItem(todo);
      // Separate step keeps collection.itemIds in sync, matching AddEntryModal.
      if (quickAddCollectionId) {
        await moveItemToCollection(todo.id, quickAddCollectionId);
      }
      quickTitle = '';
    } catch (error) {
      console.error('Failed to add todo', error);
      quickError = error instanceof Error ? error.message : 'Failed to add todo';
    } finally {
      quickSaving = false;
      // Return focus to the input so the user can keep capturing todos in
      // succession from the keyboard. tick() lets the post-state DOM settle
      // — the very first todo transitions the page from empty (hero input)
      // to populated (compact input), remounting the element bind:this
      // points at. Refocusing before that flip would target a detached node.
      await tick();
      quickInputEl?.focus();
    }
  }

  // Clear any stale error as soon as the user edits the input — they've
  // acknowledged it and are taking another swing.
  $effect(() => {
    quickTitle;
    if (quickError) quickError = '';
  });

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
    dndOpen = openTodos.map(t => ({ ...t }));
  });

  function handleDndConsider(e: CustomEvent<{ items: Array<InboxItem & { id: string }> }>) {
    dndOpen = e.detail.items;
  }

  async function handleDndFinalize(e: CustomEvent<{ items: Array<InboxItem & { id: string }> }>) {
    const previous = openTodos.map(t => ({ ...t }));
    dndOpen = e.detail.items;
    try {
      // Persist just the open ids — completed todos fall back to completedAt
      // ordering on re-render, so we don't need to thread them through config.
      await reorderTodosGlobal(dndOpen.map(t => t.id));
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

  <!-- Rendered in both empty and populated states. The Fab still handles
       richer flows; this is the keep-it-moving capture path. -->
  {#snippet quickAddComposer(compact: boolean)}
    <form
      class="quick-add"
      class:quick-add--compact={compact}
      onsubmit={(e) => {
        e.preventDefault();
        addQuickTodo();
      }}
    >
      <!--
        Autofocus only the hero (empty-state) variant. The compact variant
        renders above an existing list; stealing focus there would interrupt
        a user trying to scroll or click rows. Mobile is hidden via CSS so
        the gate is mainly load-bearing for desktop with existing todos.
      -->
      <input
        bind:this={quickInputEl}
        type="text"
        bind:value={quickTitle}
        placeholder={compact ? 'Add a todo…' : 'What needs doing?'}
        aria-label="Todo title"
        disabled={quickSaving}
        use:autofocusIf={!compact}
        onfocus={() => (quickFocused = true)}
        onblur={() => (quickFocused = false)}
        onkeydown={(e) => {
          // ⌘/Ctrl-Enter opens the full todo modal pre-filled with the typed
          // title (mirrors the inbox capture bar); plain Enter quick-adds via
          // the form submit.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCaptureTodo(quickTitle)) {
            e.preventDefault();
            onaddtodo(quickTitle);
            quickTitle = '';
          }
        }}
      />
      <!-- Empty-string sentinel maps to undefined (Unfiled) on save. -->
      <select
        class="quick-add__collection"
        aria-label="File into collection"
        value={quickAddCollectionId ?? ''}
        disabled={quickSaving}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          setQuickAddCollection(v === '' ? undefined : v);
        }}
      >
        <option value="">Unfiled</option>
        {#each $sortedGroups as group (group.id)}
          {@const cols = $groupCollections[group.id] ?? []}
          {#if cols.length > 0}
            <optgroup label={group.name}>
              {#each cols as col (col.id)}
                <option value={col.id}>{col.name}</option>
              {/each}
            </optgroup>
          {/if}
        {/each}
        {#if ungroupedCollections.length > 0}
          <optgroup label="Other">
            {#each ungroupedCollections as col (col.id)}
              <option value={col.id}>{col.name}</option>
            {/each}
          </optgroup>
        {/if}
      </select>
      <button type="submit" disabled={!canCaptureTodo(quickTitle) || quickSaving}>
        {quickSaving ? 'Adding...' : 'Add'}
      </button>
    </form>
    {#if quickFocused && quickTitle.trim()}
      <div class="quick-hint">
        <span>↵ Add todo</span>
        <span class="sep">·</span>
        <span>{mod}↵ Open editor</span>
      </div>
    {/if}
  {/snippet}

  {#if openTodos.length === 0 && completedTodos.length === 0}
    <!-- Lead with the composer so its input lines up with the inbox capture
         bar. The toolbar's Fab is hidden on desktop (the input + ⌘↵ handle
         capture) and a floating + circle on mobile. -->
    {@render quickAddComposer(false)}
    {@render todoToolbar()}
    <!-- Persistent aria-live region — kept in the DOM so screen readers
         reliably announce errors as they appear. Collapses when empty. -->
    <p class="quick-error" role="status" aria-live="polite">{quickError}</p>
    <div class="empty-state" in:fade={{ duration: 180 }}>
      <p class="empty-title">Jot a todo</p>
      <p class="empty-hint empty-hint--desktop">Capture it now. Organize it later.</p>
      <!-- Mobile: the inline composer is hidden in favour of the floating
           FAB, so the hint needs to point at it. CSS swaps which line shows. -->
      <p class="empty-hint empty-hint--mobile">Tap + to capture one. Organize it later.</p>
    </div>
  {:else}
    {@render quickAddComposer(true)}
    {@render todoToolbar()}
    <p class="quick-error quick-error--inline" role="status" aria-live="polite">{quickError}</p>
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

  /* Focus hint under the quick-add input, mirroring the inbox capture bar. */
  .quick-hint {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.35rem;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .quick-hint .sep {
    opacity: 0.4;
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
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

  .quick-add {
    width: min(100%, 41rem);
    /* Centered (like the inbox capture bar) now that it leads the empty view
       rather than living inside the centered hero. The compact variant below
       overrides to full width. */
    margin-inline: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.5rem;
    align-items: center;
  }

  /* Slim variant used above the list when todos already exist. Stays the same
     centered width as the empty-state composer (inherits the base width) so
     the input doesn't jump to full width once a todo is added. */
  .quick-add--compact {
    gap: 0.4rem;
  }

  .quick-add--compact input {
    min-height: 2.25rem;
  }

  .quick-add--compact button {
    min-height: 2.25rem;
    padding: 0 0.85rem;
    font-size: 0.88rem;
  }

  .quick-add input {
    min-height: 2.75rem;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    padding: 0 0.9rem;
    font: inherit;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    transition: border-color 150ms, box-shadow 150ms;
  }

  .quick-add input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .quick-add button {
    min-height: 2.75rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: white;
    padding: 0 1rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 150ms, transform 150ms, box-shadow 150ms;
  }

  .quick-add button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .quick-add button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .quick-add button:disabled,
  .quick-add input:disabled,
  .quick-add__collection:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* Capped width so long names truncate via the native control instead of
     pushing the Add button off-screen. */
  .quick-add__collection {
    min-height: 2.75rem;
    max-width: 12rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    padding: 0 0.6rem;
    font: inherit;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    transition: border-color 150ms, box-shadow 150ms;
  }

  .quick-add__collection:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .quick-add--compact .quick-add__collection {
    min-height: 2.25rem;
    font-size: 0.88rem;
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

  .quick-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.82rem;
  }

  /* Collapse the live region visually when there's no message — the element
     stays mounted so screen readers keep tracking it. */
  .quick-error:empty {
    display: none;
  }

  .quick-error--inline {
    margin-top: -0.25rem;
    text-align: left;
  }

  /*
   * Mobile: the floating FAB is the canonical capture surface, and the inline
   * quick-add composer was eating vertical space that's better spent on the
   * todo list itself. Hide it (both hero and compact variants) along with its
   * inline error region, and swap the empty-state hint to one that points at
   * the FAB. The composer's submit path stays mounted but unreachable, which
   * is fine — `quickError` only fills when the form is submitted.
   *
   * Desktop renders the add button inline in the toolbar, so no
   * bottom-padding reservation is needed there.
   */
  @media (max-width: 768px) {
    .todos-page {
      padding-bottom: 5rem;
    }

    .quick-add,
    .quick-error--inline {
      display: none;
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
