<script lang="ts">
  /**
   * One collection's board, in two states. Without a board: pick one of
   * your boards (use it as is, or copy it) or start from a template. With
   * a board: see its columns, edit or switch them, and decide whether the
   * collection's todos show on the Todos page.
   */
  import {
    collectionViews,
    columnSets,
    makePrivateCopy,
    setCollectionsBoard,
    setCollectionView,
    setOffPlan,
  } from '../../lib/board-actions';
  import { BOARD_UNSORTED, collectionsPhrase, columnOf, doneColumn, SET_TEMPLATES } from '../../lib/boards';
  import { openColumnSet } from '../../lib/settings-request';
  import { collections, items } from '../../lib/stores';
  import { showToast } from '../../lib/toast';
  import ByScreen from './ByScreen.svelte';
  import ColumnsPreview from './ColumnsPreview.svelte';
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
  const sharedNames = $derived(collectionsPhrase(sharedWith.map((c) => c.name)));
  const otherBoards = $derived($columnSets.filter((s) => s.id !== set?.id));
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

  let switching = $state(false);
  /** The starting point the new-board dialog opens on, when it's open. */
  let creating = $state<SetStart | null>(null);

  /** Who already uses a board on offer, so "use it too" has a face. */
  function usersOf(setId: string): string[] {
    return Object.values($collections)
      .filter((c) => c.boardSetId === setId && !c.archived)
      .map((c) => c.name);
  }

  // A starter you already have a board of (same name) would only show up
  // twice, once above as yours and once here: offer it once.
  const templates = $derived(
    SET_TEMPLATES.filter((t) => !$columnSets.some((s) => s.name === t.name)).map((t) => ({
      name: t.name,
      columns: t.columns.map(([name, color, done]) => ({ id: name, name, color, done })),
    })),
  );

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
      onclose();
    }, 'Couldn’t set up the board');

  const turnOff = () =>
    run(async () => {
      await setCollectionsBoard([collectionId], undefined);
      // Only leave the board view if that's where they were; a saved List
      // or Grid choice stays as it is.
      if (($collectionViews[collectionId] ?? 'board') === 'board') {
        await setCollectionView(collectionId, 'grid');
      }
      showToast(
        collection?.offPlan
          ? 'Board removed. This collection’s todos are still kept off the Todos page; change that under Edit collection.'
          : 'Board removed. Items remember their columns if you set it up again.',
      );
      onclose();
    }, 'Couldn’t remove the board');

  const privateCopy = () =>
    run(async () => {
      const copy = await makePrivateCopy(collectionId);
      if (copy) showToast(`This collection now has its own board, “${copy.name}”.`);
    }, 'Couldn’t copy the board');

  function editBoard() {
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
    start={creating}
    preselect={[collectionId]}
    layer={230}
    onclose={() => (creating = null)}
    oncreated={() => {
      void run(() => setCollectionView(collectionId, 'board'), 'Couldn’t open the board');
      onclose();
    }}
  />
{:else if !collection}
  <Sheet title="Board" {onclose} width="32rem">
    <p class="bx-note">This collection no longer exists.</p>
  </Sheet>
{:else if !set}
  <Sheet title="Set up a board" subtitle="Collection: {collection.name}" {onclose} width="34rem">
    <p class="bx-lead">
      A board lays a collection out in columns, so you can move things along as they progress.
      In the previews below, a ✓ marks the column where ticked todos end up.
    </p>

    {#if $columnSets.length}
      <section aria-labelledby="pick-yours">
        <h3 class="bx-label" id="pick-yours">Use a board you already have</h3>
        <ul class="bx-options plain">
          {#each $columnSets as s (s.id)}
            {@const users = usersOf(s.id)}
            <li class="bx-option">
              <div class="opt-head">
                <span class="bx-grow">
                  <span class="bx-option-title">{s.name}</span>
                  <span class="bx-muted">{users.length ? `used by ${collectionsPhrase(users)}` : 'not used by any collection yet'}</span>
                </span>
              </div>
              <ColumnsPreview columns={s.columns} />
              <!-- Each choice says what it does, in a sentence of its own,
                   beside the button that does it. -->
              <div class="choices">
                <button type="button" class="bx-btn bx-small bx-primary" aria-label="Use {s.name}" onclick={() => choose(s.id)}>Use this board</button>
                <span class="bx-muted">
                  {#if users.length}
                    This collection and {collectionsPhrase(users)} will share these columns. Change a column and it changes in {users.length === 1 ? 'both' : 'all of them'}.
                  {:else}
                    This collection will be the first to use this board.
                  {/if}
                </span>
                <button type="button" class="bx-btn bx-small" aria-label="Copy {s.name}" onclick={() => (creating = { kind: 'copy', id: s.id })}>Make a copy</button>
                <span class="bx-muted">
                  This collection gets its own copy of these columns.{#if users.length}{' '}Changing it won't affect {collectionsPhrase(users)}.{/if}
                </span>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-labelledby="pick-new">
      <h3 class="bx-label" id="pick-new">{$columnSets.length ? 'Or start fresh from a template' : 'Pick a template to start from'}</h3>
      <div class="bx-options">
        {#each templates as t (t.name)}
          <button type="button" class="bx-option" aria-label={t.name} onclick={() => (creating = { kind: 'template', name: t.name })}>
            <span class="bx-option-title">{t.name}</span>
            <ColumnsPreview columns={t.columns} />
          </button>
        {/each}
        <button type="button" class="bx-option" aria-label="Blank" onclick={() => (creating = { kind: 'blank' })}>
          <span class="bx-option-title">Blank</span>
          <span class="bx-muted">Name your own columns.</span>
        </button>
      </div>
      <p class="bx-note explain">You can rename, add or remove columns at any time.</p>
    </section>

    {#snippet footer()}
      <button type="button" class="bx-btn" onclick={onclose}>Cancel</button>
    {/snippet}
  </Sheet>
{:else}
  <Sheet title="Board settings" subtitle="Collection: {collection.name}" {onclose} width="34rem">
    <section class="bx-panel" aria-labelledby="this-board">
      <div class="opt-head">
        <span class="bx-grow">
          <span class="bx-label tight" id="this-board">Board</span>
          <span class="bx-option-title">{set.name}</span>
        </span>
        <button type="button" class="bx-btn bx-small" onclick={editBoard}>Edit columns</button>
      </div>
      <ColumnsPreview columns={set.columns} {counts} withUnsorted />
      {#if sharedWith.length}
        <p class="bx-callout">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"></path><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"></path></svg>
          <span>
            {sharedNames.charAt(0).toUpperCase() + sharedNames.slice(1)} {sharedWith.length === 1 ? 'uses' : 'use'} this board too, so changing a column changes it in {sharedWith.length === 1 ? 'both' : 'all of them'}.
            <button type="button" class="bx-link inline" onclick={privateCopy}>Give this collection its own copy</button>
          </span>
        </p>
      {/if}
      {#if otherBoards.length}
        <button type="button" class="bx-link" onclick={() => (switching = true)}>Switch to a different board…</button>
      {/if}
    </section>

    <section class="bx-panel" aria-labelledby="todos-page">
      <span class="bx-label tight" id="todos-page"><ByScreen wide="Todos page" phone="Today and Plan" /></span>
      <label class="bx-setting">
        <span class="bx-setting-text">
          <span class="bx-setting-title">Keep this collection's todos off <ByScreen wide="the Todos page" phone="Today and Plan" /></span>
          <span class="bx-muted">For collections where todos aren't tasks to schedule.</span>
        </span>
        <input
          type="checkbox"
          class="bx-switch"
          checked={!!collection.offPlan}
          onchange={(e) => void run(() => setOffPlan(collectionId, (e.currentTarget as HTMLInputElement).checked, collection.planColumnId), 'Couldn’t save that')}
        />
      </label>
      <!-- Unsorted can't be the exception (it would bring back every
           unsorted todo), so this needs another column to offer. -->
      {#if collection.offPlan && planOptions.length}
        <label class="except">
          <input
            type="checkbox"
            checked={!!planColumn}
            onchange={(e) => void run(() => setOffPlan(collectionId, true, (e.currentTarget as HTMLInputElement).checked ? planOptions[0].id : undefined), 'Couldn’t save that')}
          />
          <span class="except-text">
            <span>Still show the todos from one column</span>
            <span class="bx-muted">{planColumn ? 'They show' : 'Tick this to pick a column. Its todos will show'} <ByScreen wide="on the Todos page under Someday." phone="in Plan, under Someday." /></span>
          </span>
        </label>
        {#if planColumn}
          <select
            class="bx-select except-pick"
            aria-label="Column whose todos still show on the Todos page"
            value={planColumn}
            onchange={(e) => void run(() => setOffPlan(collectionId, true, (e.currentTarget as HTMLSelectElement).value), 'Couldn’t save that')}
          >
            {#each planOptions as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
        {/if}
      {/if}
    </section>

    <p class="bx-note">
      New items land in Unsorted.
      {#if doneColumn(set)}Ticking a todo moves it to {doneColumn(set)?.name}.{:else}Ticked todos stay in their column. Mark a column as Finished (under Edit columns) and they move there.{/if}
    </p>

    <p class="bx-note">
      Removing the board deletes nothing. This collection keeps all its items, and other collections can still use the {set.name} board.
    </p>

    {#snippet footer()}
      <button type="button" class="bx-btn bx-quiet bx-danger remove" onclick={turnOff}>Remove board from this collection</button>
      <button type="button" class="bx-btn bx-primary" onclick={onclose}>Done</button>
    {/snippet}
  </Sheet>
{/if}

<style>
  section {
    min-width: 0;
  }

  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .opt-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .opt-head .bx-grow {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .explain {
    margin-top: 0.55rem;
  }

  .choices {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
  }

  .choices .bx-btn {
    justify-self: stretch;
    white-space: nowrap;
  }

  /* Phones: each button with its sentence under it. */
  @media (max-width: 520px) {
    .choices {
      grid-template-columns: 1fr;
      gap: 0.3rem;
    }

    .choices .bx-btn {
      justify-self: start;
    }

    .choices .bx-muted + .bx-btn {
      margin-top: 0.45rem;
    }
  }

  .tight {
    margin: 0;
  }

  .inline {
    display: inline;
    width: auto;
  }


  .except-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .except-pick {
    width: auto;
    max-width: 100%;
    margin-left: 1.55rem;
    align-self: flex-start;
    padding: 0.3rem 0.5rem;
  }

  .except {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
    font-size: 0.86rem;
    cursor: pointer;
  }

  .except input[type='checkbox'] {
    margin-top: 0.2rem;
    accent-color: var(--accent);
  }

  .remove {
    margin-right: auto;
  }
</style>
