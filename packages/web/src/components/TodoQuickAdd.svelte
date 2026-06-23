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
  import { canCaptureTodo, makeUnfiledTodo } from '../lib/add-entry-modal';
  import { autofocusIf } from '../lib/actions';
  import { modLabel } from '../lib/platform';
  import {
    collections,
    groupCollections,
    moveItemToCollection,
    sortedGroups,
    storeItem,
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
  const quickAddCollectionId = $derived.by(() => {
    const id = storedQuickAddId;
    return id && collectionMap[id] ? id : undefined;
  });
  function setQuickAddCollection(id: string | undefined) {
    storedQuickAddId = id;
    try {
      if (id) localStorage.setItem(QUICK_ADD_KEY, id);
      else localStorage.removeItem(QUICK_ADD_KEY);
    } catch (error) {
      console.error('Failed to persist quick-add collection', error);
    }
  }

  const targetCollectionId = $derived(fixedCollectionId ?? quickAddCollectionId);

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

  // Clear a stale error once the user edits the input.
  $effect(() => {
    quickTitle;
    if (quickError) quickError = '';
  });
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
    <span>↵ Add todo</span>
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
    justify-content: center;
    gap: 0.5rem;
    align-items: center;
    /* Fixed height so the hint appearing on focus never shifts content. */
    min-height: 1.5rem;
    margin-top: 0.35rem;
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
