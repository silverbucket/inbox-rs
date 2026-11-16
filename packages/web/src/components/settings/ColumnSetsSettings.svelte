<script lang="ts">
  /**
   * Settings › Column sets: every set with its columns and the collections
   * using it. Edits apply to every collection on the set.
   */
  import { BOARD_UNSORTED, type BoardColumn, type ColumnSet } from '@inbox-rs/rs-module';
  import {
    columnCounts,
    columnSets,
    deleteSet,
    saveSet,
    setCollectionsBoard,
    setDoneColumn,
    updateColumns,
  } from '../../lib/board-actions';
  import { COLUMN_COLORS, copySet, liveSetId, newId, nextColumnColor } from '../../lib/boards';
  import { focusedColumnSetId } from '../../lib/settings-request';
  import { collections, groups, items } from '../../lib/stores';
  import { showToast } from '../../lib/toast';
  import DeleteColumnDialog from '../boards/DeleteColumnDialog.svelte';
  import MoveSetDialog from '../boards/MoveSetDialog.svelte';
  import NewSetDialog from '../boards/NewSetDialog.svelte';
  import '../boards/boards.css';

  // svelte-ignore state_referenced_locally
  let selectedId = $state<string | null>($focusedColumnSetId);
  $effect(() => {
    if (!selectedId || !$columnSets.some((s) => s.id === selectedId)) {
      selectedId = $columnSets[0]?.id ?? null;
    }
  });
  $effect(() => () => focusedColumnSetId.set(null));

  const set = $derived<ColumnSet | undefined>($columnSets.find((s) => s.id === selectedId));
  const users = (s: ColumnSet) =>
    Object.values($collections).filter((c) => c.boardSetId === s.id && !c.archived);
  const counts = $derived.by(() => {
    // Recount when items or collections change.
    void $items;
    void $collections;
    return set ? columnCounts(set) : new Map<string, number>();
  });
  const itemCount = (collectionId: string) =>
    Object.values($items).filter((i) => i.collectionId === collectionId).length;

  let creating = $state(false);
  let deletingColumn = $state<string | null>(null);
  let movingCollection = $state<{ id: string; to?: string } | null>(null);
  let confirmDelete = $state(false);
  let addingCollections = $state(false);
  let paletteFor = $state<string | null>(null);

  async function run(action: () => Promise<unknown>, fail: string) {
    try {
      await action();
    } catch (error) {
      console.error(fail, error);
      showToast(fail);
    }
  }

  function rename(value: string) {
    if (!set || !value.trim() || value.trim() === set.name) return;
    void run(() => saveSet({ ...set, name: value.trim() }), 'Couldn’t rename the board');
  }

  function duplicate() {
    if (!set) return;
    const copy = copySet(set, `${set.name} copy`);
    void run(async () => {
      await saveSet(copy);
      selectedId = copy.id;
    }, 'Couldn’t duplicate the board');
  }

  function removeSet() {
    if (!set) return;
    const id = set.id;
    confirmDelete = false;
    void run(() => deleteSet(id), 'Couldn’t delete the board');
  }

  function editColumns(next: BoardColumn[]) {
    if (!set) return;
    void run(() => updateColumns(set.id, next), 'Couldn’t update the columns');
  }

  function renameColumn(id: string, value: string) {
    if (!set || !value.trim()) return;
    editColumns(set.columns.map((c) => (c.id === id ? { ...c, name: value.trim() } : c)));
  }

  function recolor(id: string, color: string) {
    if (!set) return;
    paletteFor = null;
    editColumns(set.columns.map((c) => (c.id === id ? { ...c, color } : c)));
  }

  function shift(id: string, by: -1 | 1) {
    if (!set) return;
    const cols = [...set.columns];
    const at = cols.findIndex((c) => c.id === id);
    const to = at + by;
    // Unsorted stays first.
    if (at < 1 || to < 1 || to >= cols.length) return;
    [cols[at], cols[to]] = [cols[to], cols[at]];
    editColumns(cols);
  }

  function addColumn() {
    if (!set) return;
    editColumns([...set.columns, { id: newId(), name: 'New column', color: nextColumnColor(set.columns) }]);
  }

  function chooseDone(id: string) {
    if (!set) return;
    void run(() => setDoneColumn(set.id, id || undefined), 'Couldn’t change the Finished column');
  }

  function removeCollection(id: string) {
    void run(() => setCollectionsBoard([id], undefined), 'Couldn’t remove that collection');
  }

  const candidates = $derived(
    set
      ? Object.values($collections)
          .filter((c) => !c.archived && c.boardSetId !== set.id)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
  );

  function addCollection(id: string) {
    if (!set) return;
    const col = $collections[id];
    if (!col) return;
    // Pointing at a deleted set is no board: join directly, nothing to match.
    if (liveSetId(col, $columnSets)) {
      movingCollection = { id, to: set.id };
    } else {
      void run(() => setCollectionsBoard([id], set.id), 'Couldn’t add that collection');
    }
  }

  const setName = (id: string | undefined) => $columnSets.find((s) => s.id === id)?.name;
</script>

<div class="column-sets">
  <aside class="sets">
    <div class="sets-head">
      <p class="bx-note">A board is a set of columns for laying out a collection. Collections on the same board share its columns.</p>
      <button type="button" class="bx-btn bx-small new-board" onclick={() => (creating = true)}>+ New board</button>
    </div>
    {#if $columnSets.length === 0}
      <p class="bx-note empty">No boards yet. Start one here, or open a collection and choose the Board view.</p>
    {/if}
    <ul class="set-list">
      {#each $columnSets as s (s.id)}
        {@const u = users(s)}
        <li>
          <button type="button" class="set" class:on={s.id === selectedId} aria-current={s.id === selectedId} onclick={() => (selectedId = s.id)}>
            <span class="set-name">{s.name}</span>
            <span class="bx-muted">{u.length ? u.map((c) => c.name).join(', ') : 'Not used yet'}</span>
            <span class="strip" aria-hidden="true">
              {#each s.columns as c (c.id)}<i style="background: {c.color}"></i>{/each}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </aside>

  {#if set}
    {@const u = users(set)}
    <section class="detail" aria-label="{set.name} board">
      <div class="row">
        <div class="bx-grow">
          <label class="bx-label" for="set-name-edit">Board name</label>
          <input
            id="set-name-edit"
            class="bx-input"
            value={set.name}
            onchange={(e) => rename((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <button type="button" class="bx-btn" onclick={duplicate}>Duplicate</button>
      </div>

      <div>
        <span class="bx-label">Columns <span class="bx-muted plain">· left to right{u.length > 1 ? ` · changes apply to all ${u.length} collections` : ''}</span></span>
        <ul class="bx-rows">
          {#each set.columns as c, i (c.id)}
            <li class="col-row">
              <button type="button" class="swatch-btn" aria-label="Colour of {c.name}" aria-expanded={paletteFor === c.id} onclick={() => (paletteFor = paletteFor === c.id ? null : c.id)}>
                <span class="bx-swatch big" style="background: {c.color}"></span>
              </button>
              {#if c.id === BOARD_UNSORTED}
                <span class="bx-grow">Unsorted <span class="bx-muted">· new items land here first</span></span>
              {:else}
                <input
                  class="bx-input col-name"
                  value={c.name}
                  aria-label="Column name"
                  onchange={(e) => renameColumn(c.id, (e.currentTarget as HTMLInputElement).value)}
                />
                {#if c.done}<span class="finished-tag">✓ Finished</span>{/if}
              {/if}
              <span class="bx-muted count">{counts.get(c.id) ?? 0} {counts.get(c.id) === 1 ? 'item' : 'items'}</span>
              <span class="order">
                <button type="button" class="icon" aria-label="Move {c.name} earlier" disabled={i < 2} onclick={() => shift(c.id, -1)}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
                <button type="button" class="icon" aria-label="Move {c.name} later" disabled={i === 0 || i === set.columns.length - 1} onclick={() => shift(c.id, 1)}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
              </span>
              <button
                type="button"
                class="icon"
                aria-label={c.id === BOARD_UNSORTED ? 'Unsorted can’t be deleted' : `Delete column ${c.name}`}
                disabled={c.id === BOARD_UNSORTED}
                onclick={() => (deletingColumn = c.id)}
              >✕</button>
            </li>
            {#if paletteFor === c.id}
              <li class="palette">
                {#each COLUMN_COLORS.concat('#8a8378') as color (color)}
                  <button type="button" class="pal" aria-label="Use colour {color}" aria-pressed={c.color === color} style="background: {color}" onclick={() => recolor(c.id, color)}></button>
                {/each}
              </li>
            {/if}
          {/each}
        </ul>
        <button type="button" class="bx-link add" onclick={addColumn}>+ Add column</button>
        <label class="finish-row">
          <span>When a todo is ticked, move it to</span>
          <select
            class="bx-select"
            aria-label="Finished column"
            value={set.columns.find((c) => c.done)?.id ?? ''}
            onchange={(e) => chooseDone((e.currentTarget as HTMLSelectElement).value)}
          >
            {#each set.columns.filter((c) => c.id !== BOARD_UNSORTED) as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
            <option value="">Nowhere (hide it)</option>
          </select>
        </label>
        <p class="bx-note">New items land in Unsorted, which can’t be deleted.</p>
      </div>

      <div>
        <div class="row tight">
          <span class="bx-label bx-grow">Used by {u.length} {u.length === 1 ? 'collection' : 'collections'}</span>
          <button type="button" class="bx-btn bx-small" aria-expanded={addingCollections} onclick={() => (addingCollections = !addingCollections)}>Add collections</button>
        </div>
        {#if addingCollections}
          <ul class="bx-rows picks">
            {#each candidates as c (c.id)}
              <li>
                <span class="bx-dot" style="background: {c.color || 'var(--text-muted)'}"></span>
                <span class="bx-grow">{c.name} <span class="bx-muted">{liveSetId(c, $columnSets) ? `on ${setName(c.boardSetId) ?? 'another board'}` : 'no board yet'}</span></span>
                <button type="button" class="bx-btn bx-small" onclick={() => addCollection(c.id)}>Add</button>
              </li>
            {:else}
              <li class="bx-muted">Every collection already uses this board.</li>
            {/each}
          </ul>
        {/if}
        {#if u.length}
          <ul class="bx-rows">
            {#each u as c (c.id)}
              <li>
                <span class="bx-dot" style="background: {c.color || 'var(--text-muted)'}"></span>
                <span class="bx-grow">{c.name} <span class="bx-muted">{c.groupId ? ($groups[c.groupId]?.name ?? '') : ''} · {itemCount(c.id)} items</span></span>
                <button type="button" class="bx-btn bx-small" onclick={() => (movingCollection = { id: c.id })}>Switch board…</button>
                <button type="button" class="bx-btn bx-small" onclick={() => removeCollection(c.id)}>Remove</button>
              </li>
            {/each}
          </ul>
          <p class="bx-note">Removing a collection takes its board away; items remember their column in case you add it back.</p>
        {:else}
          <p class="bx-note">No collection uses this board yet.</p>
        {/if}
      </div>
      <div class="danger-zone">
        {#if confirmDelete}
          {@const all = Object.values($collections).filter((c) => c.boardSetId === set.id)}
          {@const archived = all.length - u.length}
          {@const lists = all.filter((c) => c.offPlan && c.planColumnId)}
          <p class="bx-warn">
            {all.length
              ? `${all.length} ${all.length === 1 ? 'collection loses its board' : 'collections lose their boards'}${archived ? ` (${archived} archived)` : ''}; their items keep their columns in case you set it up again.`
              : 'No collection uses this board.'}
            {#if lists.length}
              {lists.map((c) => c.name).join(', ')} {lists.length === 1 ? 'keeps' : 'keep'} todos off the Todos page except one column's; without the board, none of {lists.length === 1 ? 'its' : 'their'} todos show there until you change that under Edit collection.
            {/if}
          </p>
        {/if}
        <div class="row">
          {#if confirmDelete}
            <button type="button" class="bx-btn bx-danger" onclick={removeSet}>Delete {set.name}</button>
            <button type="button" class="bx-btn" onclick={() => (confirmDelete = false)}>Keep</button>
          {:else}
            <button type="button" class="bx-btn bx-quiet bx-danger" onclick={() => (confirmDelete = true)}>Delete this board…</button>
          {/if}
        </div>
      </div>
    </section>
  {/if}
</div>

{#if creating}
  <NewSetDialog onclose={() => (creating = false)} />
{/if}
{#if deletingColumn && set}
  <DeleteColumnDialog {set} columnId={deletingColumn} onclose={() => (deletingColumn = null)} />
{/if}
{#if movingCollection}
  <MoveSetDialog
    collectionId={movingCollection.id}
    toSetId={movingCollection.to}
    layer={340}
    onclose={() => (movingCollection = null)}
  />
{/if}

<style>
  .danger-zone {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--border);
  }

  .finished-tag {
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--success, #0f766e) 12%, transparent);
    color: var(--success, #0f766e);
    font-size: 0.7rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .finish-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0.35rem 0 0.5rem;
    font-size: 0.86rem;
  }

  .finish-row .bx-select {
    width: auto;
    min-width: 9rem;
    padding: 0.3rem 0.5rem;
  }

  .column-sets {
    display: grid;
    grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
    gap: 1.25rem;
    align-items: start;
  }

  @media (max-width: 760px) {
    .column-sets {
      grid-template-columns: 1fr;
    }
  }

  .sets-head {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.6rem;
    margin-bottom: 0.7rem;
  }

  .new-board {
    white-space: nowrap;
  }

  .empty {
    margin-bottom: 0.6rem;
  }

  .set-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .set {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .set.on {
    border: 2px solid var(--accent);
    background: var(--accent-subtler);
  }

  .set-name {
    font-weight: 700;
    font-size: 0.9rem;
  }

  .strip {
    display: flex;
    gap: 3px;
    margin-top: 0.2rem;
  }

  .strip i {
    flex: 1;
    height: 5px;
    border-radius: 3px;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    min-width: 0;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .row.tight {
    align-items: center;
    margin-bottom: 0.4rem;
  }

  .row.tight .bx-label {
    margin: 0;
  }

  .plain {
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  .order {
    display: inline-flex;
  }

  .icon {
    width: 1.9rem;
    height: 1.9rem;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon:hover:not(:disabled) {
    background: var(--surface-tint);
    color: var(--text);
  }

  .icon:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .icon {
    display: grid;
    place-items: center;
  }

  .order .icon {
    width: 1.7rem;
  }

  /* Phones: name on its own row with its actions under it; column rows
     keep to one line by dropping the item count. */
  @media (max-width: 520px) {
    .row:not(.tight) > .bx-grow {
      flex-basis: 100%;
    }

    .count {
      display: none;
    }

    .col-name {
      min-width: 0;
    }

    .finished-tag {
      display: none;
    }

    .bx-rows > li {
      gap: 0.35rem;
      padding-left: 0.4rem;
      padding-right: 0.3rem;
    }
  }

  .swatch-btn {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border: 0;
    border-radius: 6px;
    background: none;
    cursor: pointer;
  }

  .bx-swatch.big {
    width: 0.95rem;
    height: 0.95rem;
  }

  .col-name {
    flex: 1;
    min-width: 0;
    padding: 0.3rem 0.5rem;
  }



  .count {
    min-width: 4.5rem;
    text-align: right;
  }

  .bx-rows > li.palette {
    flex-wrap: wrap;
    gap: 0.4rem;
    background: var(--bg);
  }

  .pal {
    width: 1.6rem;
    height: 1.6rem;
    border: 2px solid transparent;
    border-radius: 6px;
    cursor: pointer;
  }

  .pal[aria-pressed='true'] {
    border-color: var(--text);
  }

  .add {
    margin: 0.5rem 0 0.4rem;
  }

  .picks {
    max-height: 14rem;
    overflow-y: auto;
    margin-bottom: 0.6rem;
  }
</style>
