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
  import { COLUMN_COLORS, copySet, newId, nextColumnColor } from '../../lib/boards';
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
    void run(() => saveSet({ ...set, name: value.trim() }), 'Couldn’t rename the set');
  }

  function duplicate() {
    if (!set) return;
    const copy = copySet(set, `${set.name} copy`);
    void run(async () => {
      await saveSet(copy);
      selectedId = copy.id;
    }, 'Couldn’t duplicate the set');
  }

  function removeSet() {
    if (!set) return;
    const id = set.id;
    confirmDelete = false;
    void run(() => deleteSet(id), 'Couldn’t delete the set');
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

  function toggleDone(id: string) {
    if (!set) return;
    const current = set.columns.find((c) => c.done)?.id;
    void run(() => setDoneColumn(set.id, current === id ? undefined : id), 'Couldn’t change the done column');
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
    if (col.boardSetId) {
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
      <p class="bx-note">Shared columns for item boards. Collections using the same set can share one board.</p>
      <button type="button" class="bx-btn bx-small" onclick={() => (creating = true)}>+ New</button>
    </div>
    {#if $columnSets.length === 0}
      <p class="bx-note empty">No column sets yet. Start one from a template — Watch list, Reading list, Pipeline, Trip or Release.</p>
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
    <section class="detail" aria-label="{set.name} column set">
      <div class="row">
        <div class="bx-grow">
          <label class="bx-label" for="set-name-edit">Set name</label>
          <input
            id="set-name-edit"
            class="bx-input"
            value={set.name}
            onchange={(e) => rename((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <button type="button" class="bx-btn" onclick={duplicate}>Duplicate</button>
        {#if confirmDelete}
          <button type="button" class="bx-btn bx-danger" onclick={removeSet}>Delete {set.name}</button>
          <button type="button" class="bx-btn" onclick={() => (confirmDelete = false)}>Keep</button>
        {:else}
          <button type="button" class="bx-btn bx-danger" onclick={() => (confirmDelete = true)}>Delete set…</button>
        {/if}
      </div>
      {#if confirmDelete}
        {@const all = Object.values($collections).filter((c) => c.boardSetId === set.id)}
        {@const archived = all.length - u.length}
        <p class="bx-warn">
          {all.length
            ? `${all.length} ${all.length === 1 ? 'collection loses its board' : 'collections lose their boards'}${archived ? ` (${archived} archived)` : ''}; their items keep their columns in case you set it up again.`
            : 'Nothing uses this set.'}
        </p>
      {/if}

      <div>
        <span class="bx-label">Columns <span class="bx-muted">· edits apply to all {u.length} {u.length === 1 ? 'collection' : 'collections'}</span></span>
        <ul class="bx-rows">
          {#each set.columns as c, i (c.id)}
            <li class="col-row">
              <span class="order">
                <button type="button" class="icon" aria-label="Move {c.name} left" disabled={i < 2} onclick={() => shift(c.id, -1)}>↑</button>
                <button type="button" class="icon" aria-label="Move {c.name} right" disabled={i === 0 || i === set.columns.length - 1} onclick={() => shift(c.id, 1)}>↓</button>
              </span>
              <button type="button" class="swatch-btn" aria-label="Colour of {c.name}" aria-expanded={paletteFor === c.id} onclick={() => (paletteFor = paletteFor === c.id ? null : c.id)}>
                <span class="bx-swatch big" style="background: {c.color}"></span>
              </button>
              {#if c.id === BOARD_UNSORTED}
                <span class="bx-grow">Unsorted <span class="tag">new items</span></span>
              {:else}
                <input
                  class="bx-input col-name"
                  value={c.name}
                  aria-label="Column name"
                  onchange={(e) => renameColumn(c.id, (e.currentTarget as HTMLInputElement).value)}
                />
                <button type="button" class="bx-chip done-chip" aria-pressed={!!c.done} title="Checked todos land in the done column" onclick={() => toggleDone(c.id)}>done</button>
              {/if}
              <span class="bx-muted count">{counts.get(c.id) ?? 0} items</span>
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
        <p class="bx-note">“Unsorted” is where new items land and can’t be deleted. Tag one column <strong>done</strong> and checking a todo moves it there instead of hiding it.</p>
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
                <span class="bx-grow">{c.name} <span class="bx-muted">{c.boardSetId ? `uses ${setName(c.boardSetId) ?? 'a set'}` : 'no set yet'}</span></span>
                <button type="button" class="bx-btn bx-small" onclick={() => addCollection(c.id)}>Add</button>
              </li>
            {:else}
              <li class="bx-muted">Every collection already uses this set.</li>
            {/each}
          </ul>
        {/if}
        {#if u.length}
          <ul class="bx-rows">
            {#each u as c (c.id)}
              <li>
                <span class="bx-dot" style="background: {c.color || 'var(--text-muted)'}"></span>
                <span class="bx-grow">{c.name} <span class="bx-muted">{c.groupId ? ($groups[c.groupId]?.name ?? '') : ''} · {itemCount(c.id)} items</span></span>
                <button type="button" class="bx-btn bx-small" onclick={() => (movingCollection = { id: c.id })}>Move to set…</button>
                <button type="button" class="bx-btn bx-small" onclick={() => removeCollection(c.id)}>Remove</button>
              </li>
            {/each}
          </ul>
          <p class="bx-note">Removing a collection turns its board off; items keep their column in case you add it back.</p>
        {:else}
          <p class="bx-note">No collection uses this set yet.</p>
        {/if}
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
    align-items: flex-start;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
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

  .col-row {
    flex-wrap: wrap;
  }

  .order {
    display: flex;
    flex-direction: column;
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

  .order .icon {
    width: 1.4rem;
    height: 1rem;
    font-size: 0.7rem;
    line-height: 1;
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
    min-width: 7rem;
    padding: 0.3rem 0.5rem;
  }

  .done-chip {
    min-height: 1.7rem;
    padding: 0 0.5rem;
    font-size: 0.72rem;
  }

  .tag {
    margin-left: 0.35rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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
