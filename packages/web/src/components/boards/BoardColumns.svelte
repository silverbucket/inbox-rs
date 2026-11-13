<script lang="ts">
  /**
   * The columns of one column set, filled with items: a collection's board,
   * or a group's board across several collections.
   *
   * Cards move by dragging (pointer) or with their "Move to" menu (touch and
   * keyboard). A todo's checkbox completes it; on a set with a done column
   * the todo then shows there instead of disappearing. Notes and links have
   * no checkbox: moving them is the whole action.
   */
  import type { Collection, ColumnSet, InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import { addToColumn, moveItemToColumn, updateColumns } from '../../lib/board-actions';
  import { BOARD_UNSORTED, groupByColumn, nextColumnColor, newId } from '../../lib/boards';
  import { kindOf } from '../../lib/kinds';
  import { now } from '../../lib/now';
  import { planLabel } from '../../lib/plan';
  import { setItemCompleted } from '../../lib/schedule-sync';
  import { showToast } from '../../lib/toast';
  import { relativeAge } from '../../lib/triage';

  let {
    set,
    items,
    lookupCollection,
    addTargets,
    showCollection = false,
    canAddColumns = false,
    onselect,
  }: {
    set: ColumnSet;
    /** Items on this board, in display order. */
    items: InboxItem[];
    lookupCollection: (id: string | undefined) => Collection | null;
    /** Collections a new card can go into; the first is the default. */
    addTargets: Collection[];
    /** Tag each card with its collection (group boards). */
    showCollection?: boolean;
    /** Offer "Add column" (it edits the shared set). */
    canAddColumns?: boolean;
    onselect: (item: InboxItem) => void;
  } = $props();

  const LIMIT = 30;
  const DRAG_TYPE = 'application/x-inbox-rs-board-item';

  const byColumn = $derived(groupByColumn(items, set));
  let expanded = $state<Set<string>>(new Set());
  let dragId = $state<string | null>(null);
  let overColumn = $state<string | null>(null);

  // Add-a-card form, one column at a time.
  let addingTo = $state<string | null>(null);
  let addTitle = $state('');
  let addAsTodo = $state(false);
  let addCollectionId = $state('');
  let addingColumn = $state(false);
  let newColumnName = $state('');

  function hintFor(columnId: string): string {
    const col = set.columns.find((c) => c.id === columnId);
    if (columnId === BOARD_UNSORTED) return 'New items land here';
    if (col?.done) return 'Checked todos land here';
    return '';
  }

  const isTodo = (i: InboxItem) => !!i.isTodo || i.type === 'todo';

  function domainOf(item: InboxItem): string {
    const url = (item as { url?: string }).url;
    if (!url) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function subline(item: InboxItem): string {
    if (isTodo(item)) {
      const plan = planLabel(item, $now);
      if (item.completed) return 'done';
      return plan ? `todo · ${plan}` : 'todo';
    }
    return domainOf(item) || relativeAge(item.createdAt, $now);
  }

  async function move(item: InboxItem, columnId: string) {
    try {
      await moveItemToColumn(item, set, columnId);
    } catch (error) {
      console.error('Failed to move card', error);
      showToast('Couldn’t move that card');
    }
  }

  async function toggle(item: InboxItem) {
    try {
      await setItemCompleted(item, !item.completed);
    } catch (error) {
      console.error('Failed to update todo', error);
      showToast('Couldn’t update that todo');
    }
  }

  function onDragStart(e: DragEvent, item: InboxItem) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(DRAG_TYPE, item.id);
    e.dataTransfer.effectAllowed = 'move';
    dragId = item.id;
  }

  function onDragOver(e: DragEvent, columnId: string) {
    if (!dragId || !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    overColumn = columnId;
  }

  function onDrop(e: DragEvent, columnId: string) {
    e.preventDefault();
    const id = e.dataTransfer?.getData(DRAG_TYPE) || dragId;
    overColumn = null;
    dragId = null;
    const item = items.find((i) => i.id === id);
    if (item) void move(item, columnId);
  }

  function startAdd(columnId: string) {
    addingTo = columnId;
    addTitle = '';
    addAsTodo = false;
    addCollectionId = addTargets[0]?.id ?? '';
  }

  async function submitAdd() {
    const title = addTitle.trim();
    const columnId = addingTo;
    if (!title || !columnId || !addCollectionId) return;
    try {
      await addToColumn(addCollectionId, set, columnId, title, addAsTodo);
      addTitle = '';
    } catch (error) {
      console.error('Failed to add card', error);
      showToast('Couldn’t add that card');
    }
  }

  async function submitColumn() {
    const name = newColumnName.trim();
    if (!name) return;
    try {
      await updateColumns(set.id, [
        ...set.columns,
        { id: newId(), name, color: nextColumnColor(set.columns) },
      ]);
      newColumnName = '';
      addingColumn = false;
    } catch (error) {
      console.error('Failed to add column', error);
      showToast('Couldn’t add that column');
    }
  }
</script>

<div class="board" role="list" aria-label="{set.name} board">
  {#each set.columns as column (column.id)}
    {@const cards = byColumn.get(column.id) ?? []}
    {@const isOpen = expanded.has(column.id)}
    {@const shown = isOpen ? cards : cards.slice(0, LIMIT)}
    <section
      class="column"
      class:unsorted={column.id === BOARD_UNSORTED}
      class:over={overColumn === column.id}
      role="listitem"
      aria-labelledby="col-{set.id}-{column.id}"
      style="--col: {column.color}"
      ondragover={(e) => onDragOver(e, column.id)}
      ondragleave={() => {
        if (overColumn === column.id) overColumn = null;
      }}
      ondrop={(e) => onDrop(e, column.id)}
    >
      <header class="col-head">
        <span class="dot" aria-hidden="true"></span>
        <h3 id="col-{set.id}-{column.id}">{column.name}</h3>
        {#if column.done}<span class="tag">done</span>{/if}
        <span class="count">{cards.length}</span>
      </header>
      {#if hintFor(column.id)}
        <p class="hint">{hintFor(column.id)}</p>
      {/if}

      <ul class="cards">
        {#each shown as item (item.id)}
          {@const kind = kindOf(item.type)}
          {@const col = showCollection ? lookupCollection(item.collectionId) : null}
          <!-- On a calendar (archived): the calendar owns it now, so it's
               read-only here, as in the collection's "On calendar" list. -->
          {@const locked = !!item.archived}
          <li
            class="card"
            class:dragging={dragId === item.id}
            class:completed={isTodo(item) && item.completed}
            class:locked
            draggable={!locked}
            ondragstart={(e) => (locked ? e.preventDefault() : onDragStart(e, item))}
            ondragend={() => {
              dragId = null;
              overColumn = null;
            }}
          >
            {#if locked}
              <span class="glyph cal" title="On calendar" role="img" aria-label="On calendar">
                <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              </span>
            {:else if isTodo(item)}
              <button
                type="button"
                class="check"
                class:on={item.completed}
                aria-label="{item.completed ? 'Reopen' : 'Complete'} {item.title}"
                aria-pressed={!!item.completed}
                onclick={() => toggle(item)}
              >
                {#if item.completed}
                  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                {/if}
              </button>
            {:else}
              <span class="glyph" style="--kc: {kind.color}" aria-hidden="true">{kind.label[0]}</span>
            {/if}
            <button type="button" class="open" onclick={() => onselect(item)}>
              <span class="title">{item.title || 'Untitled'}</span>
              <span class="sub">
                {#if col}<span class="coll"><span class="cdot" style="background: {col.color || 'var(--text-muted)'}"></span>{col.name}</span>{/if}
                {subline(item)}
              </span>
            </button>
{#if !locked}
            <label class="move" title="Move to another column">
              <span class="sr-only">Move {item.title} to</span>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20"></path></svg>
              <select
                value={column.id}
                onchange={(e) => void move(item, (e.currentTarget as HTMLSelectElement).value)}
              >
                {#each set.columns as target (target.id)}
                  <option value={target.id}>{target.name}</option>
                {/each}
              </select>
            </label>
            {/if}
          </li>
        {/each}
      </ul>

      {#if cards.length > LIMIT}
        <button
          type="button"
          class="more"
          onclick={() => {
            const next = new Set(expanded);
            if (isOpen) next.delete(column.id);
            else next.add(column.id);
            expanded = next;
          }}
        >
          {isOpen ? 'Show fewer' : `+${cards.length - LIMIT} more`}
        </button>
      {/if}

      {#if addTargets.length > 0}
        {#if addingTo === column.id}
          <form
            class="add-form"
            onsubmit={(e) => {
              e.preventDefault();
              void submitAdd();
            }}
          >
            <input
              use:autofocus
              class="add-input"
              bind:value={addTitle}
              placeholder="Title"
              aria-label="New card in {column.name}"
              onkeydown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  addingTo = null;
                }
              }}
            />
            {#if addTargets.length > 1}
              <select class="add-select" bind:value={addCollectionId} aria-label="Collection for the new card">
                {#each addTargets as t (t.id)}
                  <option value={t.id}>{t.name}</option>
                {/each}
              </select>
            {/if}
            <label class="add-todo"><input type="checkbox" bind:checked={addAsTodo} /> Todo</label>
            <div class="add-actions">
              <button type="button" class="ghost" onclick={() => (addingTo = null)}>Cancel</button>
              <button type="submit" class="primary" disabled={!addTitle.trim()}>Add</button>
            </div>
          </form>
        {:else}
          <button
            type="button"
            class="add"
            onclick={() => startAdd(column.id)}
          >
            + {addTargets.length > 1 ? `Add to ${column.name}` : 'Add'}
          </button>
        {/if}
      {/if}
    </section>
  {/each}

  {#if canAddColumns}
    <div class="column add-column" role="listitem">
      {#if addingColumn}
        <form
          class="add-form"
          onsubmit={(e) => {
            e.preventDefault();
            void submitColumn();
          }}
        >
          <input
            use:autofocus
            class="add-input"
            bind:value={newColumnName}
            placeholder="Column name"
            aria-label="New column name"
            onkeydown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                addingColumn = false;
              }
            }}
          />
          <p class="hint">Added to {set.name}, so every collection on it gets the column.</p>
          <div class="add-actions">
            <button type="button" class="ghost" onclick={() => (addingColumn = false)}>Cancel</button>
            <button type="submit" class="primary" disabled={!newColumnName.trim()}>Add column</button>
          </div>
        </form>
      {:else}
        <button type="button" class="add" onclick={() => (addingColumn = true)}>+ Add column</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .board {
    display: flex;
    gap: 0.85rem;
    /* Every column runs as tall as the longest one, so a card dragged from
       the bottom of a long column can drop into a short one right beside it
       instead of being carried back up to that column's last card. */
    align-items: stretch;
    overflow-x: auto;
    padding-bottom: 0.75rem;
    scroll-snap-type: x proximity;
  }

  .column {
    flex: 0 0 16.5rem;
    max-width: 85vw;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-tint);
    scroll-snap-align: start;
  }

  .column.unsorted {
    background: transparent;
    border-style: dashed;
  }

  .column.over {
    border-color: var(--col);
    box-shadow: inset 0 0 0 1px var(--col);
  }

  .add-column {
    background: transparent;
    border-style: dashed;
  }

  .col-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .col-head h3 {
    margin: 0;
    flex: 1;
    min-width: 0;
    font-size: 0.9rem;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 3px;
    background: var(--col);
    flex-shrink: 0;
  }

  .tag {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 0.35rem;
  }

  .count {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .hint {
    margin: -0.2rem 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .card {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.55rem 0.4rem 0.55rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    cursor: grab;
  }

  .card:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .card.dragging {
    opacity: 0.45;
  }

  .glyph {
    flex-shrink: 0;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-size: 0.68rem;
    font-weight: 800;
    color: var(--kc);
    background: color-mix(in srgb, var(--kc) 15%, var(--surface));
  }

  .glyph.cal {
    --kc: var(--text-muted);
  }

  .card.locked {
    cursor: default;
    opacity: 0.75;
  }

  .check {
    flex-shrink: 0;
    width: 1.2rem;
    height: 1.2rem;
    margin-top: 0.08rem;
    border: 2px solid var(--text-muted);
    border-radius: 999px;
    background: transparent;
    color: #fff;
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
  }

  .check.on {
    border-color: var(--success, #0f766e);
    background: var(--success, #0f766e);
  }

  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .open:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .title {
    font-size: 0.86rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .card.completed .title {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .coll {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-weight: 600;
  }

  .cdot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
  }

  /* A native select under a small icon: touch gets the system picker,
     keyboard users get arrow keys, and it costs no menu code. */
  .move {
    position: relative;
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--text-muted);
    opacity: 0.5;
  }

  .card:hover .move,
  .move:focus-within {
    opacity: 1;
    background: var(--surface-tint);
  }

  .move select {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    font-size: 1rem;
  }

  .move:focus-within {
    outline: 2px solid var(--accent-text);
  }

  @media (hover: none) {
    .move {
      opacity: 1;
      width: 2.25rem;
      height: 2.25rem;
    }
  }

  .more,
  .add {
    align-self: stretch;
    min-height: 2rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .more {
    border-style: solid;
  }

  .more:hover,
  .add:hover {
    color: var(--text);
    background: var(--surface);
  }

  .add-form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .add-input,
  .add-select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }

  .add-todo {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .add-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .ghost,
  .primary {
    min-height: 2rem;
    padding: 0 0.7rem;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .ghost {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }

  .primary {
    border: 0;
    background: var(--accent);
    color: #fff;
  }

  .primary:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
