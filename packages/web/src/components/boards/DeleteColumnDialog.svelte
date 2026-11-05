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
    Object.values($collections).filter((c) => c.boardSetId === set.id && !c.archived),
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

  // svelte-ignore state_referenced_locally
  let target = $state(options.find((o) => o.hint === 'the column after')?.id ?? options[0]?.id ?? BOARD_UNSORTED);
  let busy = $state(false);

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
      Its {affected.length} {affected.length === 1 ? 'item' : 'items'}{holders.length ? ` — in ${holders.join(', ')} —` : ''} need a new home. Nothing is deleted except the column.
    {/if}
  </p>
  {#if affected.length > 0}
    <div>
      <span class="bx-label">Move its items to</span>
      <div class="opts" role="radiogroup" aria-label="Move its items to">
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
