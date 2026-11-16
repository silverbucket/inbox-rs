<script lang="ts" module>
  /** Where a new set's columns come from. */
  export type SetStart =
    | { kind: 'template'; name: string }
    | { kind: 'copy'; id: string }
    | { kind: 'blank' };
</script>

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
    liveSetId,
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
    title = 'New board',
    start: initial = undefined,
    preselect = [],
    layer = 340,
    onclose,
    oncreated,
  }: {
    title?: string;
    /** The starting point to open on (default: the first template). */
    start?: SetStart;
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

  /** One column at most is Finished; '' clears it. */
  function chooseDone(id: string) {
    columns = columns.map((c) => {
      const next = { ...c };
      if (id && c.id === id) next.done = true;
      else delete next.done;
      return next;
    });
  }

  function recolor(id: string, color: string) {
    columns = columns.map((c) => (c.id === id ? { ...c, color } : c));
    paletteFor = null;
  }

  /** Move a column one place; Unsorted stays first. */
  function shift(id: string, by: -1 | 1) {
    const at = columns.findIndex((c) => c.id === id);
    const to = at + by;
    if (at < 1 || to < 1 || to >= columns.length) return;
    const next = [...columns];
    [next[at], next[to]] = [next[to], next[at]];
    columns = next;
  }

  let paletteFor = $state<string | null>(null);
  // Arriving with a starting point already picked (from a collection's
  // setup sheet), don't ask the same question again; just say what it is.
  // svelte-ignore state_referenced_locally
  let showStart = $state(!initial);
  const startName = $derived(
    start === 'blank'
      ? 'Blank'
      : start === 'copy'
        ? `A copy of ${$columnSets.find((s) => s.id === copyFrom)?.name ?? 'your board'}`
        : `The ${template} template`,
  );
  // Picking who else uses the board is optional: opened from a collection,
  // it's already for that one, and the rest stays folded away.
  // svelte-ignore state_referenced_locally
  let showPick = $state(preselect.length === 0);

  function addColumn() {
    columns = [...columns, { id: newId(), name: 'New column', color: nextColumnColor(columns) }];
  }

  // svelte-ignore state_referenced_locally
  if (initial?.kind === 'template') useTemplate(initial.name);
  else if (initial?.kind === 'copy') useCopy(initial.id);
  else if (initial?.kind === 'blank') useBlank();

  // svelte-ignore state_referenced_locally
  const forNames = preselect
    .map((id) => $collections[id]?.name)
    .filter(Boolean)
    .join(', ');

  const copied = $derived(start === 'copy' ? $columnSets.find((s) => s.id === copyFrom) : undefined);
  const copiedUsers = $derived(
    copied
      ? Object.values($collections)
          .filter((c) => c.boardSetId === copied.id && !c.archived)
          .map((c) => c.name)
      : [],
  );

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
  // A collection still pointing at a deleted set has no board to switch from.
  const onSet = (c: (typeof live)[number]) => liveSetId(c, $columnSets);
  // A failed create may have saved the set already; collections it reached
  // are on it, not switching from another set.
  const switching = $derived(
    live.filter((c) => picked.has(c.id) && onSet(c) && onSet(c) !== createdSetId),
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
      .filter((c) => picked.has(c.id) && (!onSet(c) || onSet(c) === createdSetId))
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
      showToast(`Saved ${set.name}. Other collections can use this board too.`);
      if (queue.length) switchQueue = queue;
      else finish();
    } catch (error) {
      console.error('Failed to create column set', error);
      showToast('Couldn’t create that board');
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
  <Sheet {title} subtitle={forNames ? `for ${forNames}` : undefined} {onclose} {layer} width="36rem">
    <div>
      <label class="bx-label" for="set-name">Board name</label>
      <input id="set-name" class="bx-input" bind:value={name} placeholder="e.g. Practice" />
    </div>

    <div>
      <!-- Your own boards sit beside the built-in templates: both are just
           starting points, and a board you made is as reusable as Watch list. -->
      <span class="bx-label">Start from</span>
      {#if !showStart}
        <p class="started">
          <strong>{startName}</strong>
          <button type="button" class="bx-link" onclick={() => (showStart = true)}>Change</button>
        </p>
      {:else}
      {#if $columnSets.length}
        <div class="bx-chips" role="group" aria-label="Your boards">
          <span class="group-name">Yours</span>
          {#each $columnSets as s (s.id)}
            <button type="button" class="bx-chip" aria-pressed={start === 'copy' && copyFrom === s.id} onclick={() => useCopy(s.id)}>{s.name}</button>
          {/each}
        </div>
      {/if}
      <div class="bx-chips" class:sub={$columnSets.length > 0} role="group" aria-label="Templates">
        {#if $columnSets.length}<span class="group-name">Templates</span>{/if}
        {#each SET_TEMPLATES as t (t.name)}
          <button type="button" class="bx-chip" aria-pressed={start === 'template' && template === t.name} onclick={() => useTemplate(t.name)}>{t.name}</button>
        {/each}
        <button type="button" class="bx-chip" aria-pressed={start === 'blank'} onclick={useBlank}>Blank</button>
      </div>
      {/if}
      {#if copied}
        <p class="bx-note sub">A separate copy of {copied.name}. Changes here don't affect {copiedUsers.length ? copiedUsers.join(', ') : 'it'}.</p>
      {/if}
    </div>

    <div>
      <span class="bx-label">Columns <span class="bx-muted plain">· left to right</span></span>
      <ul class="bx-rows">
        {#each columns as c, i (c.id)}
          <li>
            {#if c.id === BOARD_UNSORTED}
              <span class="swatch-slot"><span class="bx-swatch big" style="background: {c.color}"></span></span>
              <span class="bx-grow unsorted-row">Unsorted <span class="bx-muted">new items land here first</span></span>
            {:else}
              <button type="button" class="swatch-btn" title="Change colour" aria-label="Colour of {c.name}" aria-expanded={paletteFor === c.id} onclick={() => (paletteFor = paletteFor === c.id ? null : c.id)}>
                <span class="bx-swatch big" style="background: {c.color}"></span>
              </button>
              <input
                class="bx-input col-name"
                value={c.name}
                aria-label="Column name"
                oninput={(e) => renameColumn(c.id, (e.currentTarget as HTMLInputElement).value)}
              />
              {#if c.done}
                <span class="finished-tag" title="Finished column">
                  <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  <span class="finished-word">Finished</span>
                </span>
              {/if}
              <span class="order">
                <button type="button" class="icon" aria-label="Move {c.name} earlier" disabled={i < 2} onclick={() => shift(c.id, -1)}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
                <button type="button" class="icon" aria-label="Move {c.name} later" disabled={i === columns.length - 1} onclick={() => shift(c.id, 1)}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
              </span>
              <button type="button" class="icon" aria-label="Remove column {c.name}" onclick={() => removeColumn(c.id)}>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
              </button>
            {/if}
          </li>
          {#if paletteFor === c.id}
            <li class="palette">
              {#each COLUMN_COLORS as color (color)}
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
          value={columns.find((c) => c.done)?.id ?? ''}
          onchange={(e) => chooseDone((e.currentTarget as HTMLSelectElement).value)}
        >
          {#each columns.filter((c) => c.id !== BOARD_UNSORTED) as c (c.id)}
            <option value={c.id}>{c.name || 'Untitled'}</option>
          {/each}
          <option value="">Nowhere (hide it)</option>
        </select>
      </label>
    </div>

    <div>
      {#if !showPick}
        <button type="button" class="bx-link" aria-expanded="false" onclick={() => (showPick = true)}>Use this board for other collections too…</button>
      {:else}
        <span class="bx-label">{preselect.length ? 'Collections using this board' : 'Which collections use it?'} <span class="bx-muted plain">· {picked.size} selected{preselect.length ? '' : ' · optional'}</span></span>
        <div class="pick-tools">
          <input class="bx-input" placeholder="Search collections" aria-label="Search collections" bind:value={query} />
          {#if groupOptions.length}
            <select class="bx-select" aria-label="Select all in a group" value="" onchange={(e) => { selectGroup((e.currentTarget as HTMLSelectElement).value); (e.currentTarget as HTMLSelectElement).value = ''; }}>
              <option value="">Select a whole group…</option>
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
                {#if onSet(c)}
                  <span class="uses">on {setName(c.boardSetId) ?? 'another board'}</span>
                {:else}
                  <span class="bx-muted">no board yet</span>
                {/if}
              </label>
            </li>
          {:else}
            <li class="bx-muted">No collections match.</li>
          {/each}
        </ul>
        {#if switching.length}
          <p class="bx-warn sub">
            {switching.map((c) => c.name).join(', ')} {switching.length === 1 ? 'is on another board' : 'are on other boards'}. Next you'll choose where {switching.length === 1 ? 'its' : 'their'} items go on this one.
          </p>
        {/if}
      {/if}
    </div>

    {#snippet footer()}
      <button type="button" class="bx-btn" onclick={onclose}>Cancel</button>
      <button type="button" class="bx-btn bx-primary" disabled={!valid || busy} onclick={create}>
        {switching.length ? 'Create & continue' : 'Create board'}
      </button>
    {/snippet}
  </Sheet>
{/if}

<style>
  .sub {
    margin-top: 0.5rem;
  }

  .plain {
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  .group-name {
    align-self: center;
    min-width: 4.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .started {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0;
    font-size: 0.9rem;
  }

  .col-name {
    flex: 1;
    min-width: 0;
    padding: 0.3rem 0.5rem;
  }

  .swatch-slot {
    display: grid;
    place-items: center;
    width: 1.8rem;
    flex-shrink: 0;
  }

  .unsorted-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 0.5rem;
  }

  .swatch-btn {
    display: grid;
    place-items: center;
    width: 1.8rem;
    height: 1.8rem;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: none;
    cursor: pointer;
  }

  .swatch-btn:hover {
    border-color: var(--text-muted);
  }

  :global(.bx-swatch.big) {
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 4px;
  }

  .finished-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--success, #0f766e) 12%, transparent);
    color: var(--success, #0f766e);
    font-size: 0.7rem;
    font-weight: 600;
    white-space: nowrap;
  }

  /* One plain sentence instead of a toggle on every row: only one column
     can be the Finished one, so it's a single choice. */
  .finish-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
    font-size: 0.86rem;
  }

  .finish-row .bx-select {
    width: auto;
    min-width: 9rem;
    padding: 0.3rem 0.5rem;
  }

  .order {
    display: inline-flex;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 1.7rem;
    height: 1.8rem;
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
    opacity: 0.3;
    cursor: default;
  }

  .bx-rows > li.palette {
    flex-wrap: wrap;
    gap: 0.45rem;
    background: var(--bg);
  }

  .pal {
    width: 1.5rem;
    height: 1.5rem;
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

  .pick-tools {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .picks {
    max-height: 13rem;
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

  /* Phones: each column stays one row, and the Finished tag gives way to
     the sentence below the list that says the same thing. */
  @media (max-width: 520px) {
    /* Just the tick: the name needs the room, and the sentence under the
       list spells it out. */
    .finished-word {
      display: none;
    }

    .finished-tag {
      padding: 0.25rem;
    }

    .bx-rows > li {
      gap: 0.35rem;
      padding-left: 0.5rem;
      padding-right: 0.3rem;
    }

    .pick-tools {
      flex-direction: column;
    }

    .group-name {
      min-width: 100%;
    }
  }
</style>
