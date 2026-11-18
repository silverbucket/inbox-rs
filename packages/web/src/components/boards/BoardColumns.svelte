<script lang="ts">
  /**
   * The columns of one column set, filled with items: a collection's board,
   * or a group's board across several collections.
   *
   * Cards move by dragging (pointer) or with their "Move to" menu (touch and
   * keyboard). A todo's checkbox completes it; on a set with a done column
   * the todo then shows there; without one it stays where it is. Notes and links have
   * no checkbox: moving them is the whole action.
   *
   * Where columns can be edited (`canAddColumns`), each one's header menu
   * renames, recolours, reorders, marks Finished or deletes it in place, so
   * nobody has to go looking in Settings to change the board they're on.
   */
  import type { Collection, ColumnSet, InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import { addToColumn, moveItemToColumn, setDoneColumn, updateColumns } from '../../lib/board-actions';
  import { BOARD_UNSORTED, COLUMN_COLORS, groupByColumn, nextColumnColor, newId } from '../../lib/boards';
  import { collections } from '../../lib/stores';
  import DeleteColumnDialog from './DeleteColumnDialog.svelte';
  import { kindOf } from '../../lib/kinds';
  import { linkNote } from '../../lib/link-note';
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

  /** What an empty column is for, said once, where the cards would be. */
  function emptyHint(columnId: string): string {
    if (set.columns.find((c) => c.id === columnId)?.done) return 'Ticked todos land here.';
    return 'Nothing here yet.';
  }

  // ── Column menu: edit the board where you are ──
  let menuFor = $state<string | null>(null);
  let menuPos = $state({ top: 0, left: 0 });
  let renaming = $state<{ id: string; value: string } | null>(null);
  let deleting = $state<string | null>(null);
  const sharedBy = $derived(
    Object.values($collections).filter((c) => c.boardSetId === set.id && !c.archived).length,
  );

  /** The button that opened the menu, so Escape can hand focus back to it. */
  let menuTrigger: HTMLElement | null = null;

  /** Escape closes the menu and returns focus; arrows, Home and End move
   *  between its actions, as a menu's keyboard pattern promises. */
  function onMenuKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      menuFor = null;
      menuTrigger?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [
      ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled)'),
    ];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }

  function openMenu(e: MouseEvent, columnId: string) {
    if (menuFor === columnId) {
      menuFor = null;
      return;
    }
    menuTrigger = e.currentTarget as HTMLElement;
    // Fixed to the button: the board scrolls sideways and would clip a
    // menu positioned inside it.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 232;
    // Tall enough for every action; near the bottom of a short screen the
    // menu moves up to stay on it (and scrolls if even that isn't enough).
    const height = 360;
    menuPos = {
      top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
    };
    menuFor = columnId;
  }

  async function editColumns(next: typeof set.columns, fail: string) {
    try {
      await updateColumns(set.id, next);
    } catch (error) {
      console.error(fail, error);
      showToast(fail);
    }
  }

  function commitRename() {
    const r = renaming;
    renaming = null;
    const value = r?.value.trim();
    if (!r || !value || value === set.columns.find((c) => c.id === r.id)?.name) return;
    void editColumns(
      set.columns.map((c) => (c.id === r.id ? { ...c, name: value } : c)),
      'Couldn’t rename that column',
    );
  }

  function shiftColumn(id: string, by: -1 | 1) {
    const cols = [...set.columns];
    const at = cols.findIndex((c) => c.id === id);
    const to = at + by;
    // Unsorted stays first.
    if (at < 1 || to < 1 || to >= cols.length) return;
    [cols[at], cols[to]] = [cols[to], cols[at]];
    void editColumns(cols, 'Couldn’t move that column');
  }

  function recolor(id: string, color: string) {
    void editColumns(
      set.columns.map((c) => (c.id === id ? { ...c, color } : c)),
      'Couldn’t recolour that column',
    );
  }

  /** What making (or having) this the Finished column means, said truthfully
   *  for the board as it is: with no Finished column a ticked todo stays in
   *  its column, so there is nothing it moves "instead of". */
  function finishedHint(column: (typeof set.columns)[number]): string {
    if (column.done) return 'When you tick a todo, it moves here';
    const current = set.columns.find((c) => c.done);
    return current
      ? `Ticked todos will move here, not to ${current.name}`
      : 'Ticked todos will move here. Now they stay where they are';
  }

  async function toggleFinished(id: string) {
    menuFor = null;
    const current = set.columns.find((c) => c.done)?.id;
    try {
      await setDoneColumn(set.id, current === id ? undefined : id);
    } catch (error) {
      console.error('Failed to change the Finished column', error);
      showToast('Couldn’t change the Finished column');
    }
  }

  // Close on a click anywhere else. Capture phase: the focus panel this
  // board sits in stops clicks from bubbling up to the window.
  $effect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest('.col-menu, .menu-btn')) menuFor = null;
    };
    window.addEventListener('click', close, true);
    return () => window.removeEventListener('click', close, true);
  });

  // ── Phones: one column at a time, with a strip to jump between them ──
  let boardEl = $state<HTMLElement>();
  let activeColumn = $state<string>(BOARD_UNSORTED);

  function jumpTo(columnId: string) {
    const el = boardEl?.querySelector<HTMLElement>(`[data-column="${CSS.escape(columnId)}"]`);
    if (!boardEl || !el) return;
    boardEl.scrollTo({ left: el.offsetLeft - boardEl.offsetLeft, behavior: 'smooth' });
    activeColumn = columnId;
  }

  function onBoardScroll() {
    if (!boardEl) return;
    menuFor = null;
    const left = boardEl.getBoundingClientRect().left;
    let best = activeColumn;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const el of boardEl.querySelectorAll<HTMLElement>('[data-column]')) {
      const d = Math.abs(el.getBoundingClientRect().left - left);
      if (d < bestDistance) {
        bestDistance = d;
        best = el.dataset.column ?? best;
      }
    }
    activeColumn = best;
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
    // Clear now, not after the write: by then the next title may already be
    // typed, and clearing late wiped it so its Enter added nothing (#364).
    addTitle = '';
    try {
      await addToColumn(addCollectionId, set, columnId, title, addAsTodo);
    } catch (error) {
      console.error('Failed to add card', error);
      showToast('Couldn’t add that card');
      // Give the title back to its own column's form, unless something new
      // was typed meanwhile.
      if (!addTitle && addingTo === columnId) addTitle = title;
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

<svelte:window onresize={() => (menuFor = null)} />

<div class="board-wrap">
<nav class="jump" aria-label="Jump to a column">
  {#each set.columns as column (column.id)}
    <button type="button" class:on={activeColumn === column.id} aria-current={activeColumn === column.id ? 'true' : undefined} onclick={() => jumpTo(column.id)}>
      <span class="dot" style="--col: {column.color}" aria-hidden="true"></span>
      {column.name}
      <span class="jump-n">{(byColumn.get(column.id) ?? []).length}</span>
    </button>
  {/each}
</nav>
<div class="board" role="list" aria-label="{set.name} board" bind:this={boardEl} onscroll={onBoardScroll}>
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
      data-column={column.id}
      style="--col: {column.color}"
      ondragover={(e) => onDragOver(e, column.id)}
      ondragleave={() => {
        if (overColumn === column.id) overColumn = null;
      }}
      ondrop={(e) => onDrop(e, column.id)}
    >
      <header class="col-head">
        <span class="dot" aria-hidden="true"></span>
        {#if renaming?.id === column.id}
          <input
            use:autofocus
            class="rename"
            aria-label="Column name"
            bind:value={renaming.value}
            onblur={commitRename}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') {
                e.stopPropagation();
                renaming = null;
              }
            }}
          />
        {:else}
          <h3 id="col-{set.id}-{column.id}">{column.name}</h3>
        {/if}
        <span class="count" aria-label="{cards.length} {cards.length === 1 ? 'item' : 'items'}">{cards.length}</span>
        {#if canAddColumns && column.id !== BOARD_UNSORTED}
          <button
            type="button"
            class="menu-btn"
            aria-label="Column options for {column.name}"
            aria-haspopup="menu"
            aria-expanded={menuFor === column.id}
            onclick={(e) => openMenu(e, column.id)}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>
          </button>
        {/if}
      </header>
      <!-- One line under every heading, so cards and "+ Add" line up
           across columns whether or not a column has something to say. -->
      <p class="col-sub" class:finished={column.done}>{#if column.done}<svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Finished column{:else if column.id === BOARD_UNSORTED}New items land here first{/if}</p>
      {#if menuFor === column.id}
        {@const at = set.columns.findIndex((c) => c.id === column.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="col-menu"
          role="menu"
          aria-label="{column.name} column"
          tabindex="-1"
          style="top: {menuPos.top}px; left: {menuPos.left}px"
          onkeydown={onMenuKeydown}
        >
          <button
            type="button"
            role="menuitem"
            use:autofocus
            onclick={() => {
              menuFor = null;
              renaming = { id: column.id, value: column.name };
            }}
          >Rename</button>
          <span class="menu-label">Colour</span>
          <div class="swatches" role="group" aria-label="Colour">
            {#each COLUMN_COLORS as color (color)}
              <button type="button" class="sw" aria-label="Use colour {color}" aria-pressed={column.color === color} style="background: {color}" onclick={() => recolor(column.id, color)}></button>
            {/each}
          </div>
          <button type="button" role="menuitem" disabled={at < 2} onclick={() => shiftColumn(column.id, -1)}>Move left</button>
          <button type="button" role="menuitem" disabled={at === set.columns.length - 1} onclick={() => shiftColumn(column.id, 1)}>Move right</button>
          <button type="button" role="menuitemcheckbox" aria-checked={!!column.done} class="two-line" onclick={() => toggleFinished(column.id)}>
            <span class="mi-title">
              {column.done ? 'Finished column' : 'Make this the Finished column'}
              {#if column.done}<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>{/if}
            </span>
            <span class="mi-hint">{finishedHint(column)}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            class="danger"
            onclick={() => {
              menuFor = null;
              deleting = column.id;
            }}
          >Delete column…</button>
          {#if sharedBy > 1}
            <p class="menu-note">Changes apply to all {sharedBy} collections on {set.name}.</p>
          {/if}
        </div>
      {/if}

      <ul class="cards">
        {#each shown as item (item.id)}
          {@const kind = kindOf(item.type)}
          {@const col = showCollection ? lookupCollection(item.collectionId) : null}
          <!-- On a calendar (archived): the calendar owns it now, so it's
               read-only here, as in the collection's "On calendar" list. -->
          {@const locked = !!item.archived}
          {@const note = linkNote(item)}
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
              {#if note}<span class="note">{note}</span>{/if}
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

      {#if cards.length === 0}
        <p class="empty">{emptyHint(column.id)}</p>
      {/if}

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
            <label class="add-todo"><input type="checkbox" bind:checked={addAsTodo} /> Todo <span class="add-todo-hint">· gets a checkbox</span></label>
            <div class="add-actions">
              <button type="button" class="ghost" onclick={() => (addingTo = null)}>Cancel</button>
              <button type="submit" class="primary" disabled={!addTitle.trim()}>Add</button>
            </div>
          </form>
        {:else}
          <button
            type="button"
            class="add"
            aria-label="Add to {column.name}"
            onclick={() => startAdd(column.id)}
          >
            + Add
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
          {#if sharedBy > 1}<p class="hint">Every collection on {set.name} gets this column.</p>{/if}
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
</div>

{#if deleting}
  <DeleteColumnDialog {set} columnId={deleting} onclose={() => (deleting = null)} />
{/if}

<style>
  .board-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }

  /* Phones show one column at a time; this strip says which, how many
     there are, and takes you to any of them in one tap. */
  .jump {
    display: none;
    gap: 0.4rem;
    overflow-x: auto;
    scrollbar-width: none;
    margin: 0 -1rem;
    padding: 0 1rem 0.1rem;
  }

  .jump::-webkit-scrollbar {
    display: none;
  }

  .jump button {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.25rem;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .jump button.on {
    border-color: var(--text);
    color: var(--text);
  }

  .jump-n {
    font-weight: 500;
    color: var(--text-muted);
  }

  @media (max-width: 768px) {
    .jump {
      display: flex;
    }
  }

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

  @media (max-width: 768px) {
    .board {
      /* Bleed to the screen edge so the next column peeks in. */
      margin: 0 -1rem;
      padding: 0 1rem 0.75rem;
      scroll-padding-left: 1rem;
      scroll-snap-type: x mandatory;
      /* One column in view at a time: let each be as tall as its cards. */
      align-items: flex-start;
    }
  }

  .column {
    /* Share the width when the columns fit, so a five-column board fills a
       laptop screen instead of running off its edge; scroll once they
       can't get any narrower. */
    flex: 1 0 13.5rem;
    max-width: min(20rem, 85vw);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem;
    border: 1px solid var(--border);
    border-top: 3px solid var(--col);
    border-radius: var(--radius);
    background: var(--surface-tint);
    scroll-snap-align: start;
  }

  @media (max-width: 768px) {
    .column {
      flex-basis: min(19rem, 84vw);
    }
  }

  .column.unsorted {
    background: transparent;
    border-style: dashed;
    border-top-style: solid;
  }

  .column.over {
    border-color: var(--col);
    box-shadow: inset 0 0 0 1px var(--col);
  }

  .add-column {
    flex: 0 0 9.5rem;
    background: transparent;
    border: 1px dashed var(--border);
    align-self: flex-start;
  }

  .col-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 1.75rem;
  }

  .rename {
    flex: 1;
    min-width: 0;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    font-weight: 700;
  }

  .menu-btn {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    margin-right: -0.25rem;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .menu-btn:hover,
  .menu-btn[aria-expanded='true'] {
    background: var(--surface);
    color: var(--text);
  }

  @media (hover: none) {
    .menu-btn {
      width: 2.25rem;
      height: 2.25rem;
    }
  }

  .col-menu {
    position: fixed;
    z-index: 160;
    width: 232px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 0.3rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: 0 12px 32px -8px var(--shadow);
  }

  .col-menu:focus {
    outline: none;
  }

  .col-menu > button {
    display: flex;
    align-items: center;
    min-height: 2.1rem;
    padding: 0.35rem 0.6rem;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.86rem;
    text-align: left;
    cursor: pointer;
  }

  .col-menu > button:hover:not(:disabled),
  .col-menu > button:focus-visible {
    background: var(--surface-tint);
    outline: none;
  }

  .col-menu > button:disabled {
    color: var(--text-muted);
    opacity: 0.55;
    cursor: default;
  }

  .col-menu > button.two-line {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
  }

  .mi-title {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .mi-title svg {
    color: var(--success, #0f766e);
  }

  .mi-hint {
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .col-menu > button.danger {
    margin-top: 0.25rem;
    border-top: 1px solid var(--border);
    border-radius: 0 0 6px 6px;
    color: var(--danger-text);
  }

  .menu-label {
    padding: 0.4rem 0.6rem 0;
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(5, 1.5rem);
    gap: 0.4rem;
    padding: 0.35rem 0.6rem 0.55rem;
  }

  .sw {
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 5px;
    cursor: pointer;
  }

  .sw[aria-pressed='true'] {
    border-color: var(--text);
  }

  .menu-note {
    margin: 0.3rem 0 0;
    padding: 0.45rem 0.6rem 0.3rem;
    border-top: 1px solid var(--border);
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .empty {
    margin: 0;
    padding: 0.9rem 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    text-align: center;
    color: var(--text-muted);
  }

  .col-head h3 {
    margin: 0;
    flex: 1;
    min-width: 0;
    font-size: 0.9rem;
    font-weight: 700;
    /* Wrap between words; only a single word too long for the column breaks. */
    overflow-wrap: break-word;
  }

  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 3px;
    background: var(--col);
    flex-shrink: 0;
  }

  .col-sub {
    margin: -0.25rem 0 0;
    min-height: 1.05rem;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .col-sub.finished {
    font-weight: 600;
    color: var(--success, #0f766e);
  }

  /* Phones show one column at a time: nothing to line up with. */
  @media (max-width: 768px) {
    .col-sub:empty {
      display: none;
    }
  }


  .count {
    min-width: 1.35rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--surface);
    font-size: 0.74rem;
    font-weight: 600;
    text-align: center;
    color: var(--text-muted);
  }

  .add-todo-hint {
    opacity: 0.8;
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

  /* A link's own note: one quiet line (two when it wraps) under its title. */
  .note {
    font-size: 0.78rem;
    line-height: 1.35;
    color: var(--text-muted);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
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

  .add-input:focus,
  .add-select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .add-todo {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    cursor: pointer;
  }

  .add-todo input {
    accent-color: var(--accent);
  }

  @media (hover: none) {
    .add-todo {
      min-height: 2.75rem;
    }

    .add-todo input {
      width: 1.2rem;
      height: 1.2rem;
    }
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
