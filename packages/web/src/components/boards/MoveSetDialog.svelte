<script lang="ts">
  /**
   * Move one collection to another column set, matching its columns.
   * Same names match on their own; the rest default to Unsorted (or done to
   * done) and can be changed. Items remember their old-set columns, so
   * moving back restores them.
   */
  import { BOARD_UNSORTED, type ColumnSet } from '@inbox-rs/rs-module';
  import {
    columnSets,
    makePrivateCopy,
    moveCollectionToSet,
  } from '../../lib/board-actions';
  import { columnOf, isAutoMatch, matchColumns, moveTarget } from '../../lib/boards';
  import { collections, items } from '../../lib/stores';
  import { showToast } from '../../lib/toast';
  import Sheet from './Sheet.svelte';
  import './boards.css';

  let {
    collectionId,
    toSetId = undefined,
    layer = 220,
    onclose,
  }: {
    collectionId: string;
    /** Preselected destination (e.g. a new set it's joining). */
    toSetId?: string;
    layer?: number;
    onclose: () => void;
  } = $props();

  const collection = $derived($collections[collectionId]);
  const from = $derived($columnSets.find((s) => s.id === collection?.boardSetId));
  const targets = $derived($columnSets.filter((s) => s.id !== from?.id));
  // svelte-ignore state_referenced_locally
  let toId = $state(toSetId ?? '');
  $effect(() => {
    if (!toId && targets[0]) toId = targets[0].id;
  });
  const to = $derived<ColumnSet | undefined>(targets.find((s) => s.id === toId));

  let mapping = $state<Record<string, string>>({});
  /** Source columns the user set by hand (an explicit Unsorted beats memory). */
  let explicit = $state<Set<string>>(new Set());
  $effect(() => {
    // Recompute defaults whenever the destination changes.
    mapping = from && to ? matchColumns(from, to) : {};
    explicit = new Set();
  });

  const own = $derived(
    Object.values($items).filter((i) => i.collectionId === collectionId),
  );
  const counts = $derived.by(() => {
    const out = new Map<string, number>();
    if (!from) return out;
    for (const item of own) {
      const c = columnOf(item, from);
      out.set(c, (out.get(c) ?? 0) + 1);
    }
    return out;
  });
  const others = $derived(
    from
      ? Object.values($collections).filter(
          (c) => c.boardSetId === from.id && c.id !== collectionId && !c.archived,
        ).length
      : 0,
  );
  const result = $derived.by(() => {
    if (!to) return '';
    const totals = new Map<string, number>();
    for (const item of own) {
      const target = moveTarget(item, from, to, mapping, explicit);
      totals.set(target, (totals.get(target) ?? 0) + 1);
    }
    const parts = [...totals].map(([id, n]) => {
      const name = to.columns.find((c) => c.id === id)?.name ?? 'Unsorted';
      return `${n} ${n === 1 ? 'item' : 'items'} to ${name}`;
    });
    return parts.length ? parts.join(' · ') : 'No items to move.';
  });

  let busy = $state(false);

  async function move() {
    if (!to || busy) return;
    busy = true;
    try {
      await moveCollectionToSet(collectionId, to.id, from ? mapping : {}, explicit);
      showToast(`${collection?.name ?? 'Collection'} now uses ${to.name}`);
      onclose();
    } catch (error) {
      console.error('Failed to move collection to set', error);
      showToast('Couldn’t move that collection');
    } finally {
      busy = false;
    }
  }

  async function copyInstead() {
    if (busy) return;
    busy = true;
    try {
      const copy = await makePrivateCopy(collectionId);
      if (copy) showToast(`${collection?.name} now has its own copy: ${copy.name}`);
      onclose();
    } catch (error) {
      console.error('Failed to copy set', error);
      showToast('Couldn’t copy that set');
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Move {collection?.name ?? 'collection'} to another set" {onclose} {layer} width="34rem">
  {#if !collection}
    <p class="bx-note">This collection no longer exists.</p>
  {:else if targets.length === 0}
    <p class="bx-note">There's no other column set yet. Create one in Settings › Column sets first.</p>
  {:else}
    <div class="fromto">
      <div>
        <span class="bx-label">From</span>
        <strong>{from?.name ?? 'No set'}</strong>
      </div>
      <div class="grow">
        <label class="bx-label" for="move-to">To</label>
        <select id="move-to" class="bx-select" bind:value={toId}>
          {#each targets as s (s.id)}
            <option value={s.id}>{s.name}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if from && to}
      <div>
        <span class="bx-label">Match the columns <span class="bx-muted">· same names match on their own</span></span>
        <ul class="bx-rows">
          {#each from.columns as c (c.id)}
            {@const n = counts.get(c.id) ?? 0}
            <li class:empty={!n}>
              <span class="bx-swatch" style="background: {c.color}"></span>
              <span class="bx-grow">{c.name} <span class="bx-muted">{n ? `${n} item${n > 1 ? 's' : ''}` : 'empty'}</span></span>
              <span aria-hidden="true">→</span>
              <select
                class="bx-select map"
                aria-label="Move {c.name} to"
                value={mapping[c.id] ?? BOARD_UNSORTED}
                onchange={(e) => {
                  mapping = { ...mapping, [c.id]: (e.currentTarget as HTMLSelectElement).value };
                  explicit = new Set(explicit).add(c.id);
                }}
              >
                {#each to.columns as t (t.id)}
                  <option value={t.id}>{t.name}</option>
                {/each}
              </select>
              {#if isAutoMatch(c, to, mapping[c.id] ?? BOARD_UNSORTED)}<span class="auto">auto</span>{/if}
            </li>
          {/each}
        </ul>
      </div>
      <p class="bx-note">
        <strong>Result:</strong> {result}
        {#if others > 0}The {others} other {from.name} {others === 1 ? 'collection isn’t' : 'collections aren’t'} affected.{/if}
      </p>
      <p class="bx-note">Items remember their {from.name} column — move {collection.name} back and they return to where they were.</p>
      {#if others > 0}
        <button type="button" class="bx-link" disabled={busy} onclick={copyInstead}>Make a private copy of {from.name} instead</button>
      {/if}
    {/if}
  {/if}

  {#snippet footer()}
    <button type="button" class="bx-btn" onclick={onclose}>Cancel</button>
    <button type="button" class="bx-btn bx-primary" disabled={!to || busy} onclick={move}>Move</button>
  {/snippet}
</Sheet>

<style>
  .fromto {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
  }

  .fromto strong {
    display: block;
    padding: 0.45rem 0;
  }

  .grow {
    flex: 1;
  }

  .map {
    width: auto;
    max-width: 11rem;
    padding: 0.3rem 0.45rem;
  }

  .bx-rows > li.empty {
    opacity: 0.8;
    background: var(--bg);
  }

  .auto {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
