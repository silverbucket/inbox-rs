<script lang="ts">
  /**
   * Quick-add todo composer, shared by the Todos page and the collection
   * view's Todos section. Plain Enter files a todo instantly; ⌘/Ctrl-Enter
   * opens the full modal pre-filled (via `onopenmodal`), mirroring the inbox
   * capture bar.
   *
   * When `fixedCollectionId` is set (collection view), todos are filed there
   * and the collection select is hidden. Otherwise the select lets the user
   * pick a destination, persisted per-device.
   */
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { canCaptureTodo, makeUnfiledTodo } from '../lib/add-entry-modal';
  import { autofocusIf } from '../lib/actions';
  import { modLabel } from '../lib/platform';
  import { showToast } from '../lib/toast';
  import {
    activeGroupIds,
    collections,
    groupCollections,
    moveItemToCollection,
    sortedGroups,
    storeItem,
    toggleGroupFilter,
  } from '../lib/stores';

  let {
    fixedCollectionId = undefined,
    compact = false,
    hideOnMobile = false,
    focusOnMount = false,
    onopenmodal,
  }: {
    /** When set, todos are filed here and the collection select is hidden. */
    fixedCollectionId?: string;
    /** Slim variant used above an existing list. */
    compact?: boolean;
    /** Hide on mobile — the Todos page has a floating Fab there instead. */
    hideOnMobile?: boolean;
    /** Focus the input on mount (the Todos page does; the collection view
        doesn't, to avoid stealing focus when a collection is expanded). */
    focusOnMount?: boolean;
    /** ⌘/Ctrl-Enter — open the full todo modal pre-filled with the title and
        the resolved target collection. */
    onopenmodal: (
      prefillTitle: string,
      collectionId: string | undefined,
    ) => void;
  } = $props();

  let quickTitle = $state('');
  let quickSaving = $state(false);
  let quickError = $state('');
  let quickFocused = $state(false);
  let quickInputEl = $state<HTMLInputElement | undefined>(undefined);
  const mod = modLabel();

  const collectionMap = $derived($collections);
  const groupMap = $derived(() => {
    const out: Record<string, (typeof $sortedGroups)[number]> = {};
    for (const g of $sortedGroups) out[g.id] = g;
    return out;
  });
  const ungroupedCollections = $derived(
    Object.values(collectionMap).filter(
      (c) => !c.groupId || !groupMap()[c.groupId],
    ),
  );

  // Per-device quick-add destination (hidden when a fixed collection is given).
  // localStorage rather than synced config so a stale remote copy can't clobber
  // a just-set local value.
  const QUICK_ADD_KEY = 'inbox-rs:quickAddCollectionId';
  function readStoredQuickAddId(): string | undefined {
    try {
      return localStorage.getItem(QUICK_ADD_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }
  let storedQuickAddId = $state<string | undefined>(readStoredQuickAddId());
  // Whether the user has actively chosen a destination in this composer
  // instance. Distinguishes a deliberate in-session pick (honored verbatim,
  // even into a hidden group) from the passively-restored default (guarded
  // below). Resets on remount, so a stale hidden default never silently
  // reapplies across reloads.
  let userPicked = $state(false);

  /** True when the collection exists, belongs to a known group, and that group
   *  is currently filtered out of view — i.e. filing here makes the todo
   *  vanish from the list. Ungrouped/orphan collections are never hidden. */
  function isOutOfView(id: string | undefined): boolean {
    const gid = id ? collectionMap[id]?.groupId : undefined;
    return !!gid && !!groupMap()[gid] && !$activeGroupIds.has(gid);
  }

  // The remembered preference, if it still resolves to a real collection.
  const pickedId = $derived(
    storedQuickAddId && collectionMap[storedQuickAddId]
      ? storedQuickAddId
      : undefined,
  );
  // The passive default never targets a hidden group: a plain-Enter add would
  // file the todo where it can't be seen. Falls back to Unfiled instead.
  const defaultCollectionId = $derived(
    pickedId && isOutOfView(pickedId) ? undefined : pickedId,
  );
  // Live select value: an explicit in-session pick wins (you may deliberately
  // file into a hidden group — addQuickTodo surfaces a "Show" toast for that);
  // otherwise use the guarded default.
  const quickAddCollectionId = $derived(userPicked ? pickedId : defaultCollectionId);
  function setQuickAddCollection(id: string | undefined) {
    storedQuickAddId = id;
    userPicked = true;
    try {
      if (id) localStorage.setItem(QUICK_ADD_KEY, id);
      else localStorage.removeItem(QUICK_ADD_KEY);
    } catch (error) {
      console.error('Failed to persist quick-add collection', error);
    }
  }

  const targetCollectionId = $derived(fixedCollectionId ?? quickAddCollectionId);

  // Where plain Enter will file the todo, shown in the hint while composing so
  // the destination is predictable before submitting. Flags an out-of-view
  // target so an explicit hidden pick isn't a surprise.
  const destinationLabel = $derived.by(() => {
    const id = targetCollectionId;
    const col = id ? collectionMap[id] : undefined;
    if (!col) return 'Unfiled';
    const group = col.groupId ? groupMap()[col.groupId] : undefined;
    const base = group ? `${group.name} › ${col.name}` : col.name;
    return isOutOfView(id) ? `${base} (hidden)` : base;
  });

  async function addQuickTodo() {
    if (!canCaptureTodo(quickTitle) || quickSaving) return;
    quickSaving = true;
    quickError = '';
    // storeItem creates the todo; the move is a second step. Track the boundary
    // so a move failure doesn't leave the title around to be re-submitted — that
    // would store a duplicate unfiled todo on retry.
    let created = false;
    try {
      const todo = makeUnfiledTodo(quickTitle);
      await storeItem(todo);
      created = true;
      quickTitle = '';
      // Separate step keeps collection.itemIds in sync, matching AddEntryModal.
      if (targetCollectionId) {
        await moveItemToCollection(todo.id, targetCollectionId);
        notifyIfOutOfView(targetCollectionId);
      }
    } catch (error) {
      console.error('Failed to add todo', error);
      quickError = created
        ? 'Todo added, but filing it into the collection failed.'
        : error instanceof Error
          ? error.message
          : 'Failed to add todo';
    } finally {
      quickSaving = false;
      // Return focus so the user can keep capturing; tick() lets a hero→compact
      // remount settle before refocusing the (new) element.
      await tick();
      quickInputEl?.focus();
    }
  }

  // After filing into a collection whose group is filtered out of view, the
  // todo is intact but invisible here. Confirm where it went and offer a
  // one-tap reveal so it never feels like it vanished — no after-the-fact edit.
  function notifyIfOutOfView(collectionId: string) {
    if (!isOutOfView(collectionId)) return;
    const col = collectionMap[collectionId];
    const gid = col?.groupId;
    if (!gid) return;
    showToast(`Added to ${col.name} — hidden from this view`, {
      label: 'Show',
      // Guard against a double-toggle if the group was revealed meanwhile.
      run: () => {
        if (get(activeGroupIds).has(gid)) return;
        // A failed config write would otherwise be an unhandled rejection;
        // tell the user the reveal didn't take so they can retry.
        void toggleGroupFilter(gid).catch((error) => {
          console.error('Failed to reveal hidden group', error);
          showToast('Could not show the group. Please try again.');
        });
      },
    });
  }

  // Clear a stale error once the user edits the input. Driven by the input's
  // oninput (a real keystroke) rather than a reactive effect on quickTitle —
  // the effect also read quickError, so setting it re-ran the effect and wiped
  // the message before it could render. A programmatic clear after a successful
  // submit must NOT clear the error, so this only fires on genuine edits.
  function clearStaleError() {
    if (quickError) quickError = '';
  }
</script>

<form
  class="quick-add"
  class:quick-add--compact={compact}
  class:quick-add--no-select={!!fixedCollectionId}
  class:quick-add--hide-mobile={hideOnMobile}
  onsubmit={(e) => {
    e.preventDefault();
    addQuickTodo();
  }}
>
  <input
    bind:this={quickInputEl}
    type="text"
    bind:value={quickTitle}
    placeholder={compact ? 'Add a todo…' : 'What needs doing?'}
    aria-label="Todo title"
    disabled={quickSaving}
    use:autofocusIf={focusOnMount}
    oninput={clearStaleError}
    onfocus={() => (quickFocused = true)}
    onblur={() => (quickFocused = false)}
    onkeydown={(e) => {
      if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey) &&
        canCaptureTodo(quickTitle)
      ) {
        e.preventDefault();
        onopenmodal(quickTitle, targetCollectionId);
        quickTitle = '';
      }
    }}
  />
  {#if !fixedCollectionId}
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
  {/if}
  <button type="submit" disabled={!canCaptureTodo(quickTitle) || quickSaving}>
    {quickSaving ? 'Adding...' : 'Add'}
  </button>
</form>
<p class="quick-error" role="status" aria-live="polite">{quickError}</p>
<!-- Always rendered with a fixed height so the hint never shifts content. -->
<div class="quick-hint">
  {#if quickFocused && quickTitle.trim()}
    <span>↵ {fixedCollectionId ? 'Add todo' : `Add to ${destinationLabel}`}</span>
    <span class="sep">·</span>
    <span>{mod}↵ Open editor</span>
  {/if}
</div>

<style>
  .quick-add {
    /* Full width so the input matches the rows below it; no jump between the
       empty and populated states. */
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.5rem;
    align-items: center;
  }

  .quick-add--no-select {
    grid-template-columns: minmax(0, 1fr) auto;
  }

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
    /* Border-only on focus (no glow ring), matching the inbox capture bar. */
    border-color: var(--accent);
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
  }

  .quick-add--compact .quick-add__collection {
    min-height: 2.25rem;
    /* Keep >=1rem (inherited) so iOS Safari doesn't auto-zoom on focus — the
       guideline forbids sub-1rem font-size on form controls. */
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

  .quick-hint {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    /* Fixed height so the hint appearing on focus never shifts content. */
    min-height: 1.4rem;
    margin-top: 0.2rem;
    /* Left-align under the input's text (matches the input's horizontal
       padding) so the hint sits beneath what you're typing, not centered. */
    padding-left: 0.9rem;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .quick-hint .sep {
    opacity: 0.4;
  }

  /* The Todos page hides the inline composer on mobile (the floating Fab is the
     capture surface there). The collection view keeps it — it has no Fab. */
  @media (max-width: 768px) {
    .quick-add--hide-mobile {
      display: none;
    }
  }
</style>
