<script lang="ts">
  /**
   * Delete a column from a (possibly shared) set. Its items, in every
   * collection on the set, move to a column of the user's choosing first —
   * nothing is deleted but the column.
   */
  import { BOARD_UNSORTED, type ColumnSet } from '@inbox-rs/rs-module';
  import { columnOf, doneColumn } from '../../lib/boards';
  import { deleteColumn } from '../../lib/board-actions';
  import { collections, items } from '../../lib/stores';
  import { showToast } from '../../lib/toast';
  import Sheet from './Sheet.svelte';
  import './boards.css';

  let {
    set,
    columnId,
    layer = 340,
    onclose,
  }: {
    set: ColumnSet;
    columnId: string;
    layer?: number;
    onclose: () => void;
  } = $props();

  const column = $derived(set.columns.find((c) => c.id === columnId));
  const users = $derived(
    // Archived collections too: deleteColumn moves their items as well.
    Object.values($collections).filter((c) => c.boardSetId === set.id),
  );
  const affected = $derived(
    Object.values($items).filter(
      (i) =>
        i.collectionId &&
        users.some((u) => u.id === i.collectionId) &&
        columnOf(i, set) === columnId,
    ),
  );
  const holders = $derived([
    ...new Set(affected.map((i) => $collections[i.collectionId as string]?.name).filter(Boolean)),
  ]);

  const options = $derived.by(() => {
    const at = set.columns.findIndex((c) => c.id === columnId);
    const out: Array<{ id: string; hint: string }> = [];
    const add = (id: string | undefined, hint: string) => {
      if (id && id !== columnId && !out.some((o) => o.id === id)) out.push({ id, hint });
    };
    add(set.columns[at - 1]?.id, 'the column before');
    add(set.columns[at + 1]?.id, 'the column after');
    add(BOARD_UNSORTED, 'sort them later');
    add(doneColumn(set)?.id, 'done column');
    return out;
  });

  const isOpenTodo = (i: (typeof affected)[number]) => (i.isTodo || i.type === 'todo') && !i.completed;
  // svelte-ignore state_referenced_locally
  let target = $state(options.find((o) => o.hint === 'the column after')?.id ?? options[0]?.id ?? BOARD_UNSORTED);
  let busy = $state(false);
  /** Lists showing this column on the plan; their plan column moves with the items. */
  const planLists = $derived(
    Object.values($collections).filter(
      (c) => c.boardSetId === set.id && c.offPlan && c.planColumnId === columnId,
    ),
  );
  const openTodosToDone = $derived(
    target === doneColumn(set)?.id ? affected.filter(isOpenTodo).length : 0,
  );

  async function confirm() {
    if (busy) return;
    busy = true;
    try {
      await deleteColumn(set.id, columnId, target);
      showToast(`Deleted ${column?.name ?? 'column'}`);
      onclose();
    } catch (error) {
      console.error('Failed to delete column', error);
      showToast('Couldn’t delete that column');
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Delete “{column?.name ?? 'column'}”?" {onclose} {layer} width="28rem">
  <p class="bx-note">
    {#if users.length > 1}{set.name} is shared, so the column goes from all {users.length} collections.{/if}
    {#if affected.length === 0}
      It's empty, so nothing else changes.
    {:else}
      Its {affected.length} {affected.length === 1 ? 'item' : 'items'}{holders.length ? ` — in ${holders.join(', ')} —` : ''} need a new home. Nothing is deleted except the column, and no todo is checked or unchecked.
    {/if}
  </p>
  {#if planLists.length > 0}
    <p class="bx-note">
      {#if target === BOARD_UNSORTED}
        <strong>{planLists.map((c) => c.name).join(', ')}</strong> {planLists.length === 1 ? 'shows' : 'show'} this column on the Todos plan. Unsorted can't take its place, so {planLists.length === 1 ? 'that list has' : 'those lists have'} no todos on the plan until you pick a plan column again under Columns.
      {:else}
        {planLists.map((c) => c.name).join(', ')} {planLists.length === 1 ? 'shows' : 'show'} this column on the Todos plan; {set.columns.find((c) => c.id === target)?.name} takes its place.
      {/if}
    </p>
  {/if}
  {#if openTodosToDone > 0}
    <p class="bx-note">
      {openTodosToDone} open {openTodosToDone === 1 ? 'todo stays' : 'todos stay'} open, so {openTodosToDone === 1 ? 'it shows' : 'they show'} in Unsorted rather than {set.columns.find((c) => c.id === target)?.name}.
    </p>
  {/if}
  {#if affected.length > 0 || planLists.length > 0}
    <div>
      <span class="bx-label">{affected.length ? 'Move its items to' : 'Replace it on the plan with'}</span>
      <div class="opts" role="radiogroup" aria-label={affected.length ? 'Move its items to' : 'Replace it on the plan with'}>
        {#each options as o (o.id)}
          {@const c = set.columns.find((x) => x.id === o.id)}
          <button
            type="button"
            role="radio"
            aria-checked={target === o.id}
            class="opt"
            class:on={target === o.id}
            onclick={() => (target = o.id)}
          >
            <span class="bx-swatch" style="background: {c?.color}"></span>
            <strong>{c?.name}</strong>
            <span class="bx-muted">{o.hint}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#snippet footer()}
    <button type="button" class="bx-btn" onclick={onclose}>Cancel</button>
    <button type="button" class="bx-btn bx-primary" disabled={busy} onclick={confirm}>
      {affected.length ? `Move ${affected.length} & delete column` : 'Delete column'}
    </button>
  {/snippet}
</Sheet>

<style>
  .opts {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .opt {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .opt.on {
    border: 2px solid var(--accent);
    background: var(--accent-subtler);
  }

  .opt strong {
    flex: 1;
    font-size: 0.88rem;
  }
</style>
