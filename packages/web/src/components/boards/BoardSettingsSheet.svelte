<script lang="ts">
  /**
   * One collection's board settings: which column set it uses (or picking
   * one), switching sets, a private copy, turning the board off, and — for
   * lists — which column comes back to the Todos plan as Someday.
   */
  import {
    collectionViews,
    columnSets,
    findSet,
    makePrivateCopy,
    setCollectionsBoard,
    setCollectionView,
    setOffPlan,
  } from '../../lib/board-actions';
  import { columnOf, doneColumn } from '../../lib/boards';
  import { openColumnSet } from '../../lib/settings-request';
  import { collections, items } from '../../lib/stores';
  import { showToast } from '../../lib/toast';
  import MoveSetDialog from './MoveSetDialog.svelte';
  import NewSetDialog from './NewSetDialog.svelte';
  import Sheet from './Sheet.svelte';
  import './boards.css';

  let { collectionId, onclose }: { collectionId: string; onclose: () => void } = $props();

  const collection = $derived($collections[collectionId]);
  const set = $derived(findSet(collection?.boardSetId));
  const sharedWith = $derived(
    set
      ? Object.values($collections).filter(
          (c) => c.boardSetId === set.id && c.id !== collectionId && !c.archived,
        )
      : [],
  );
  const counts = $derived.by(() => {
    const out = new Map<string, number>();
    if (!set) return out;
    for (const i of Object.values($items)) {
      if (i.collectionId !== collectionId) continue;
      const c = columnOf(i, set);
      out.set(c, (out.get(c) ?? 0) + 1);
    }
    return out;
  });
  const opensAsBoard = $derived(
    !!set && ($collectionViews[collectionId] ?? 'board') === 'board',
  );

  let switching = $state(false);
  let creating = $state(false);

  async function run(action: () => Promise<unknown>, fail: string) {
    try {
      await action();
    } catch (error) {
      console.error(fail, error);
      showToast(fail);
    }
  }

  const choose = (setId: string) =>
    run(async () => {
      await setCollectionsBoard([collectionId], setId);
      await setCollectionView(collectionId, 'board');
    }, 'Couldn’t set up the board');

  const turnOff = () =>
    run(async () => {
      await setCollectionsBoard([collectionId], undefined);
      await setCollectionView(collectionId, 'grid');
      onclose();
    }, 'Couldn’t turn the board off');

  const privateCopy = () =>
    run(async () => {
      const copy = await makePrivateCopy(collectionId);
      if (copy) showToast(`${collection?.name} now has its own set: ${copy.name}`);
    }, 'Couldn’t copy the set');

  function editSet() {
    if (!set) return;
    onclose();
    openColumnSet(set.id);
  }

  const planColumn = $derived(collection?.planColumnId ?? '');
</script>

{#if switching && collection}
  <MoveSetDialog {collectionId} onclose={() => (switching = false)} />
{:else if creating}
  <NewSetDialog
    preselect={[collectionId]}
    layer={230}
    onclose={() => (creating = false)}
    oncreated={() => {
      void run(() => setCollectionView(collectionId, 'board'), 'Couldn’t open the board');
      onclose();
    }}
  />
{:else}
  <Sheet title="Board · {collection?.name ?? ''}" {onclose} width="32rem">
    {#if !collection}
      <p class="bx-note">This collection no longer exists.</p>
    {:else if !set}
      <p class="bx-note">Pick a column set to lay {collection.name} out as a board. Sets are shared: collections on the same set can share a board.</p>
      {#if $columnSets.length}
        <ul class="bx-rows">
          {#each $columnSets as s (s.id)}
            <li>
              <span class="bx-grow">
                <strong>{s.name}</strong>
                <span class="strip" aria-hidden="true">{#each s.columns as c (c.id)}<i style="background: {c.color}"></i>{/each}</span>
              </span>
              <button type="button" class="bx-btn bx-small" onclick={() => choose(s.id)}>Use</button>
            </li>
          {/each}
        </ul>
      {/if}
      <button type="button" class="bx-btn" onclick={() => (creating = true)}>New column set…</button>
    {:else}
      <div>
        <span class="bx-label">Column set</span>
        <p class="set-line">
          <strong>{set.name}</strong>
          <span class="bx-muted">{sharedWith.length ? `shared with ${sharedWith.map((c) => c.name).join(', ')}` : 'only this collection'}</span>
        </p>
        <div class="bx-chips cols">
          {#each set.columns as c (c.id)}
            <span class="bx-chip static"><span class="bx-swatch" style="background: {c.color}"></span>{c.name}<span class="bx-muted">{counts.get(c.id) ?? 0}</span></span>
          {/each}
        </div>
      </div>
      <div class="actions">
        <button type="button" class="bx-link" onclick={editSet}>Edit {set.name}…</button>
        <span class="bx-muted">changes apply to all {sharedWith.length + 1} {sharedWith.length ? 'collections' : 'collection'}</span>
        <button type="button" class="bx-link" onclick={() => (switching = true)}>Switch to another set…</button>
        {#if sharedWith.length}
          <button type="button" class="bx-link" onclick={privateCopy}>Make a private copy <span class="bx-muted">· just for {collection.name}</span></button>
        {/if}
      </div>

      <label class="toggle">
        <input
          type="checkbox"
          checked={opensAsBoard}
          onchange={(e) => void run(() => setCollectionView(collectionId, (e.currentTarget as HTMLInputElement).checked ? 'board' : 'grid'), 'Couldn’t save that')}
        />
        Open this collection as a board
      </label>

      <label class="toggle">
        <input
          type="checkbox"
          checked={!!collection.offPlan}
          onchange={(e) => void run(() => setOffPlan(collectionId, (e.currentTarget as HTMLInputElement).checked, collection.planColumnId), 'Couldn’t save that')}
        />
        It's a list — keep its todos off the Todos plan
      </label>
      {#if collection.offPlan}
        <label class="toggle sub">
          <input
            type="checkbox"
            checked={!!planColumn}
            onchange={(e) => void run(() => setOffPlan(collectionId, true, (e.currentTarget as HTMLInputElement).checked ? (set.columns[1]?.id ?? '') : undefined), 'Couldn’t save that')}
          />
          Show
          <select
            class="bx-select inline"
            aria-label="Column shown on the Todos plan"
            value={planColumn || set.columns[1]?.id}
            onchange={(e) => void run(() => setOffPlan(collectionId, true, (e.currentTarget as HTMLSelectElement).value), 'Couldn’t save that')}
          >
            {#each set.columns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
          todos on the Todos plan, as Someday
        </label>
      {/if}

      <p class="bx-note">
        New items land in Unsorted.
        {#if doneColumn(set)}Checked todos move to {doneColumn(set)?.name} — the set's <strong>done</strong> column.{:else}Tag a column <strong>done</strong> in the set to keep checked todos on the board.{/if}
      </p>
    {/if}

    {#snippet footer()}
      {#if set}<button type="button" class="bx-btn bx-danger" onclick={turnOff}>Turn off board</button>{/if}
      <button type="button" class="bx-btn bx-primary" onclick={onclose}>Done</button>
    {/snippet}
  </Sheet>
{/if}

<style>
  .set-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0 0 0.5rem;
  }

  .cols .static {
    cursor: default;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .toggle {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.88rem;
    cursor: pointer;
  }

  .toggle input[type='checkbox'] {
    accent-color: var(--accent);
  }

  .toggle.sub {
    margin-left: 1.5rem;
  }

  .inline {
    width: auto;
    padding: 0.2rem 0.4rem;
  }

  .strip {
    display: flex;
    gap: 3px;
    margin-top: 0.3rem;
    max-width: 10rem;
  }

  .strip i {
    flex: 1;
    height: 5px;
    border-radius: 3px;
  }
</style>
