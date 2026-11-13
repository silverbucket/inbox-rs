<script lang="ts">
  /**
   * Create a column set: from a template, a copy of another set, or blank;
   * edit its columns; pick the collections that use it. Collections already
   * on another set get the column-matching step next, one at a time.
   */
  import { BOARD_UNSORTED, type BoardColumn } from '@inbox-rs/rs-module';
  import { columnSets, saveSet, setCollectionsBoard } from '../../lib/board-actions';
  import {
    COLUMN_COLORS,
    columnsFromSpecs,
    makeSet,
    newId,
    nextColumnColor,
    normalizeColumns,
    SET_TEMPLATES,
  } from '../../lib/boards';
  import { collections, groups } from '../../lib/stores';
  import { showToast } from '../../lib/toast';
  import MoveSetDialog from './MoveSetDialog.svelte';
  import Sheet from './Sheet.svelte';
  import './boards.css';

  let {
    preselect = [],
    layer = 340,
    onclose,
    oncreated,
  }: {
    /** Collections to tick from the start. */
    preselect?: string[];
    layer?: number;
    onclose: () => void;
    /** Runs once the set exists and every picked collection is on it. */
    oncreated?: (setId: string) => void;
  } = $props();

  function finish() {
    if (createdSetId) oncreated?.(createdSetId);
    onclose();
  }

  type Start = 'template' | 'copy' | 'blank';
  let start = $state<Start>('template');
  let template = $state(SET_TEMPLATES[0].name);
  // svelte-ignore state_referenced_locally
  let copyFrom = $state($columnSets[0]?.id ?? '');
  let name = $state(SET_TEMPLATES[0].name);
  /** The name the dialog last filled in; anything else is the user's own. */
  let suggested = SET_TEMPLATES[0].name;
  /** Offer a name for the chosen start, unless the user has typed their own. */
  function suggestName(next: string) {
    if (name.trim() && name !== suggested) return;
    name = next;
    suggested = next;
  }
  let columns = $state<BoardColumn[]>(columnsFromSpecs(SET_TEMPLATES[0].columns));
  // svelte-ignore state_referenced_locally
  let picked = $state<Set<string>>(new Set(preselect));
  let query = $state('');
  let busy = $state(false);
  let switchQueue = $state<string[]>([]);
  let createdSetId = $state<string | null>(null);

  function useTemplate(t: string) {
    start = 'template';
    template = t;
    const spec = SET_TEMPLATES.find((x) => x.name === t);
    if (!spec) return;
    suggestName(spec.name);
    columns = columnsFromSpecs(spec.columns);
  }

  function useCopy(id: string) {
    start = 'copy';
    copyFrom = id;
    const src = $columnSets.find((s) => s.id === id);
    if (!src) return;
    suggestName(`${src.name} copy`);
    columns = src.columns.map((c) => ({ ...c, id: c.id === BOARD_UNSORTED ? c.id : newId() }));
  }

  function useBlank() {
    start = 'blank';
    suggestName('');
    columns = normalizeColumns([
      { id: newId(), name: 'To do', color: COLUMN_COLORS[0] },
      { id: newId(), name: 'Done', color: '#0f766e', done: true },
    ]);
  }

  function renameColumn(id: string, value: string) {
    columns = columns.map((c) => (c.id === id ? { ...c, name: value } : c));
  }

  function removeColumn(id: string) {
    columns = columns.filter((c) => c.id !== id);
  }

  function setDone(id: string) {
    columns = columns.map((c) => {
      const next = { ...c };
      if (c.id === id && !c.done) next.done = true;
      else delete next.done;
      return next;
    });
  }

  function addColumn() {
    columns = [...columns, { id: newId(), name: 'New column', color: nextColumnColor(columns) }];
  }

  const live = $derived(
    Object.values($collections)
      .filter((c) => !c.archived)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const shown = $derived(
    query.trim()
      ? live.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
      : live,
  );
  const setName = (id: string | undefined) => $columnSets.find((s) => s.id === id)?.name;
  // A failed create may have saved the set already; collections it reached
  // are on it, not switching from another set.
  const switching = $derived(
    live.filter((c) => picked.has(c.id) && c.boardSetId && c.boardSetId !== createdSetId),
  );
  const groupOptions = $derived(
    Object.values($groups)
      .filter((g) => !g.archived && live.some((c) => c.groupId === g.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked = next;
  }

  function selectGroup(groupId: string) {
    if (!groupId) return;
    const next = new Set(picked);
    for (const c of live) if (c.groupId === groupId) next.add(c.id);
    picked = next;
  }

  const valid = $derived(name.trim().length > 0 && columns.every((c) => c.name.trim()));

  async function create() {
    if (!valid || busy) return;
    busy = true;
    // Decide who joins directly and who switches sets before any write:
    // once a collection is on the new set it no longer looks "unset".
    const fresh = live
      .filter((c) => picked.has(c.id) && (!c.boardSetId || c.boardSetId === createdSetId))
      .map((c) => c.id);
    const queue = switching.map((c) => c.id);
    try {
      const made = makeSet(
        name,
        columns.map((c) => ({ ...c, name: c.name.trim() })),
      );
      // Retrying after a failed assignment: update the set already saved
      // rather than saving a second one.
      const set = createdSetId ? { ...made, id: createdSetId } : made;
      await saveSet(set);
      createdSetId = set.id;
      await setCollectionsBoard(fresh, set.id);
      showToast(`Created ${set.name}`);
      if (queue.length) switchQueue = queue;
      else finish();
    } catch (error) {
      console.error('Failed to create column set', error);
      showToast('Couldn’t create that set');
    } finally {
      busy = false;
    }
  }
</script>

{#if switchQueue.length && createdSetId}
  <MoveSetDialog
    collectionId={switchQueue[0]}
    toSetId={createdSetId}
    {layer}
    onclose={() => {
      switchQueue = switchQueue.slice(1);
      if (!switchQueue.length) finish();
    }}
  />
{:else}
  <Sheet title="New column set" {onclose} {layer} width="36rem">
    <div>
      <label class="bx-label" for="set-name">Name</label>
      <input id="set-name" class="bx-input" bind:value={name} placeholder="e.g. Release" />
    </div>

    <div>
      <span class="bx-label">Start from</span>
      <div class="bx-chips" role="group" aria-label="Start from">
        <button type="button" class="bx-chip" aria-pressed={start === 'template'} onclick={() => useTemplate(template)}>Template</button>
        <button type="button" class="bx-chip" aria-pressed={start === 'copy'} disabled={!$columnSets.length} onclick={() => useCopy(copyFrom || $columnSets[0]?.id)}>Copy a set</button>
        <button type="button" class="bx-chip" aria-pressed={start === 'blank'} onclick={useBlank}>Blank</button>
      </div>
      {#if start === 'template'}
        <div class="bx-chips sub" role="group" aria-label="Template">
          {#each SET_TEMPLATES as t (t.name)}
            <button type="button" class="bx-chip" aria-pressed={template === t.name} onclick={() => useTemplate(t.name)}>{t.name}</button>
          {/each}
        </div>
      {:else if start === 'copy'}
        <select class="bx-select sub" aria-label="Set to copy" value={copyFrom} onchange={(e) => useCopy((e.currentTarget as HTMLSelectElement).value)}>
          {#each $columnSets as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      {/if}
    </div>

    <div>
      <span class="bx-label">Columns</span>
      <ul class="bx-rows">
        {#each columns as c (c.id)}
          <li>
            <span class="bx-swatch" style="background: {c.color}"></span>
            {#if c.id === BOARD_UNSORTED}
              <span class="bx-grow">Unsorted <span class="bx-muted">· new items land here</span></span>
            {:else}
              <input
                class="bx-input col-name"
                value={c.name}
                aria-label="Column name"
                oninput={(e) => renameColumn(c.id, (e.currentTarget as HTMLInputElement).value)}
              />
              <button type="button" class="bx-chip done-chip" aria-pressed={!!c.done} title="Checked todos land in the done column" onclick={() => setDone(c.id)}>done</button>
              <button type="button" class="icon" aria-label="Remove column {c.name}" onclick={() => removeColumn(c.id)}>✕</button>
            {/if}
          </li>
        {/each}
      </ul>
      <button type="button" class="bx-link add" onclick={addColumn}>+ Add column</button>
      <p class="bx-note">You can rename, recolour, reorder and delete columns later in Settings › Column sets.</p>
    </div>

    <div>
      <span class="bx-label">Use for · {picked.size} selected</span>
      <div class="pick-tools">
        <input class="bx-input" placeholder="Search collections" aria-label="Search collections" bind:value={query} />
        {#if groupOptions.length}
          <select class="bx-select" aria-label="Select all in a group" value="" onchange={(e) => { selectGroup((e.currentTarget as HTMLSelectElement).value); (e.currentTarget as HTMLSelectElement).value = ''; }}>
            <option value="">Select all in…</option>
            {#each groupOptions as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
          </select>
        {/if}
      </div>
      <ul class="bx-rows picks">
        {#each shown as c (c.id)}
          <li>
            <label class="pick">
              <input type="checkbox" checked={picked.has(c.id)} onchange={() => toggle(c.id)} />
              <span class="bx-dot" style="background: {c.color || 'var(--text-muted)'}"></span>
              <span class="bx-grow">{c.name}</span>
              {#if c.boardSetId}
                <span class="uses">uses {setName(c.boardSetId) ?? 'a set'}</span>
              {:else}
                <span class="bx-muted">no set yet</span>
              {/if}
            </label>
          </li>
        {:else}
          <li class="bx-muted">No collections match.</li>
        {/each}
      </ul>
      {#if switching.length}
        <p class="bx-warn">
          {switching.length} {switching.length === 1 ? 'collection will switch sets' : 'collections will switch sets'}:
          {switching.map((c) => c.name).join(', ')}. You'll match {switching.length === 1 ? 'its' : 'their'} columns next.
        </p>
      {/if}
    </div>

    {#snippet footer()}
      <button type="button" class="bx-btn" onclick={onclose}>Cancel</button>
      <button type="button" class="bx-btn bx-primary" disabled={!valid || busy} onclick={create}>
        {switching.length ? 'Create & continue' : 'Create'}
      </button>
    {/snippet}
  </Sheet>
{/if}

<style>
  .sub {
    margin-top: 0.5rem;
  }

  .col-name {
    flex: 1;
    min-width: 0;
    padding: 0.25rem 0.45rem;
  }

  .done-chip {
    min-height: 1.7rem;
    padding: 0 0.5rem;
    font-size: 0.72rem;
  }

  .icon {
    width: 1.8rem;
    height: 1.8rem;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon:hover {
    background: var(--surface-tint);
  }

  .add {
    margin: 0.45rem 0 0.35rem;
  }

  .pick-tools {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .picks {
    max-height: 15rem;
    overflow-y: auto;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    cursor: pointer;
  }

  .uses {
    font-size: 0.78rem;
    color: var(--warn-text);
  }
</style>
