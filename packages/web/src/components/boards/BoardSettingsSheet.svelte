<script lang="ts">
  /**
   * One collection's board settings: which column set it uses (or picking
   * one), switching sets, a private copy, turning the board off, and — for
   * lists — which column comes back to the Todos plan as Someday.
   */
  import {
    collectionViews,
    columnSets,
    makePrivateCopy,
    setCollectionsBoard,
    setCollectionView,
    setOffPlan,
  } from '../../lib/board-actions';
  import { BOARD_UNSORTED, columnOf, doneColumn } from '../../lib/boards';
  import { openColumnSet } from '../../lib/settings-request';
  import { collections, items } from '../../lib/stores';
  import { showToast } from '../../lib/toast';
  import { SET_TEMPLATES } from '../../lib/boards';
  import MoveSetDialog from './MoveSetDialog.svelte';
  import NewSetDialog, { type SetStart } from './NewSetDialog.svelte';
  import Sheet from './Sheet.svelte';
  import './boards.css';

  let { collectionId, onclose }: { collectionId: string; onclose: () => void } = $props();

  const collection = $derived($collections[collectionId]);
  const set = $derived($columnSets.find((s) => s.id === collection?.boardSetId));
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
  /** The starting point the new-board dialog opens on, when it's open. */
  let creating = $state<SetStart | null>(null);

  /** "used by Guitar, Piano" for a set on offer, so sharing has a face. */
  function usedBy(setId: string): string {
    const names = Object.values($collections)
      .filter((c) => c.boardSetId === setId && !c.archived)
      .map((c) => c.name);
    return names.length ? `used by ${names.join(', ')}` : 'not used yet';
  }

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
      // Still a list without its board: say so, since its todos stay hidden.
      if (collection?.offPlan) {
        showToast(`Board off. ${collection.name} is still a list, so its todos stay off the plan; untick “It's a list” under Edit collection to bring them back.`);
      }
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
  const planOptions = $derived(set ? set.columns.filter((c) => c.id !== BOARD_UNSORTED) : []);
</script>

{#if switching && collection}
  <MoveSetDialog {collectionId} onclose={() => (switching = false)} />
{:else if creating}
  <NewSetDialog
    title="New board"
    start={creating}
    preselect={[collectionId]}
    layer={230}
    onclose={() => (creating = null)}
    oncreated={() => {
      void run(() => setCollectionView(collectionId, 'board'), 'Couldn’t open the board');
      onclose();
    }}
  />
{:else}
  <!-- Only offered once there's a board, beside the plan column it gates.
       Without one it lives in the collection's edit form alone. -->
  {#snippet listToggle(col: NonNullable<typeof collection>)}
    <label class="toggle">
      <input
        type="checkbox"
        checked={!!col.offPlan}
        onchange={(e) => void run(() => setOffPlan(collectionId, (e.currentTarget as HTMLInputElement).checked, col.planColumnId), 'Couldn’t save that')}
      />
      It's a list — keep its todos off the Todos plan
    </label>
  {/snippet}
  <Sheet title="Board · {collection?.name ?? ''}" {onclose} width="32rem">
    {#if !collection}
      <p class="bx-note">This collection no longer exists.</p>
    {:else if !set}
      {#if $columnSets.length}
        <div>
          <span class="bx-label">Your boards</span>
          <ul class="bx-rows">
            {#each $columnSets as s (s.id)}
              <li>
                <span class="bx-grow">
                  <strong>{s.name}</strong> <span class="bx-muted">· {usedBy(s.id)}</span>
                  <span class="strip" aria-hidden="true">{#each s.columns as c (c.id)}<i style="background: {c.color}"></i>{/each}</span>
                </span>
                <button type="button" class="bx-btn bx-small" aria-label="Share {s.name}" onclick={() => choose(s.id)}>Share</button>
                <button type="button" class="bx-btn bx-small" aria-label="Copy {s.name}" onclick={() => (creating = { kind: 'copy', id: s.id })}>Copy</button>
              </li>
            {/each}
          </ul>
        </div>
        <p class="bx-note">
          <strong>Share</strong>: {collection.name} keeps the same columns as the others — editing them changes every collection on that board.<br />
          <strong>Copy</strong>: {collection.name} gets its own columns to change freely.
        </p>
      {/if}
      <div>
        <span class="bx-label">{$columnSets.length ? 'Or start fresh' : 'Start from'}</span>
        <div class="bx-chips" role="group" aria-label="Start fresh">
          <button type="button" class="bx-chip" onclick={() => (creating = { kind: 'blank' })}>Blank</button>
          {#each SET_TEMPLATES as t (t.name)}
            <button type="button" class="bx-chip" onclick={() => (creating = { kind: 'template', name: t.name })}>{t.name}</button>
          {/each}
        </div>
      </div>
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

      {@render listToggle(collection)}
      <!-- Unsorted can't be the plan column (it would put every unsorted
           todo on the plan), so this needs another column to offer. -->
      {#if collection.offPlan && planOptions.length}
        <label class="toggle sub">
          <input
            type="checkbox"
            checked={!!planColumn}
            onchange={(e) => void run(() => setOffPlan(collectionId, true, (e.currentTarget as HTMLInputElement).checked ? planOptions[0].id : undefined), 'Couldn’t save that')}
          />
          Show
          <select
            class="bx-select inline"
            aria-label="Column shown on the Todos plan"
            value={planColumn || planOptions[0].id}
            onchange={(e) => void run(() => setOffPlan(collectionId, true, (e.currentTarget as HTMLSelectElement).value), 'Couldn’t save that')}
          >
            {#each planOptions as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
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
      {#if set}
        <button type="button" class="bx-btn bx-danger" onclick={turnOff}>Turn off board</button>
        <button type="button" class="bx-btn bx-primary" onclick={onclose}>Done</button>
      {:else}
        <button type="button" class="bx-btn" onclick={onclose}>Cancel</button>
      {/if}
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
