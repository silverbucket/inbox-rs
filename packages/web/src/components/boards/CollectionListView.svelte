<script lang="ts">
  /**
   * A collection as a compact list: one row per item, in the collection's
   * order, with its board column when the collection has a board.
   */
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import { columnSets } from '../../lib/board-actions';
  import { columnOf } from '../../lib/boards';
  import { kindOf } from '../../lib/kinds';
  import { now } from '../../lib/now';
  import { setItemCompleted } from '../../lib/schedule-sync';
  import { showToast } from '../../lib/toast';
  import { relativeAge } from '../../lib/triage';

  let {
    collection,
    items,
    onselect,
  }: { collection: Collection; items: InboxItem[]; onselect: (item: InboxItem) => void } = $props();

  const set = $derived($columnSets.find((s) => s.id === collection.boardSetId));
  const isTodo = (i: InboxItem) => !!i.isTodo || i.type === 'todo';

  async function toggle(item: InboxItem) {
    // On a calendar: the calendar owns it now (read-only, as in CollectionView).
    if (item.archived) return;
    try {
      await setItemCompleted(item, !item.completed);
    } catch (error) {
      console.error('Failed to update todo', error);
      showToast('Couldn’t update that todo');
    }
  }
</script>

{#if items.length === 0}
  <p class="empty">Nothing in {collection.name} yet.</p>
{:else}
  <ul class="list">
    {#each items as item (item.id)}
      {@const kind = kindOf(item.type)}
      {@const column = set ? set.columns.find((c) => c.id === columnOf(item, set)) : undefined}
      <li class="row" class:completed={isTodo(item) && item.completed}>
        {#if isTodo(item) && !item.archived}
          <button
            type="button"
            class="check"
            class:on={item.completed}
            aria-label="{item.completed ? 'Reopen' : 'Complete'} {item.title}"
            aria-pressed={!!item.completed}
            onclick={() => toggle(item)}
          ></button>
        {:else}
          <span class="glyph" style="--kc: {kind.color}" aria-hidden="true">{kind.label[0]}</span>
        {/if}
        <button type="button" class="open" onclick={() => onselect(item)}>
          <span class="title">{item.title || 'Untitled'}</span>
          <span class="kind">{isTodo(item) ? 'Todo' : kind.label}</span>
        </button>
        {#if column}
          <span class="col"><span class="sw" style="background: {column.color}"></span>{column.name}</span>
        {/if}
        <span class="age">{relativeAge(item.createdAt, $now)}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    color: var(--text-muted);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.8rem;
  }

  .row + .row {
    border-top: 1px solid var(--border);
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

  .check {
    flex-shrink: 0;
    width: 1.2rem;
    height: 1.2rem;
    border: 2px solid var(--text-muted);
    border-radius: 999px;
    background: transparent;
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
    align-items: baseline;
    gap: 0.6rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .title {
    font-weight: 600;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .kind,
  .age {
    flex-shrink: 0;
    font-size: 0.76rem;
    color: var(--text-muted);
  }

  .col {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .sw {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 2px;
  }

  .row.completed .title {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  @media (max-width: 600px) {
    .kind {
      display: none;
    }
  }
</style>
