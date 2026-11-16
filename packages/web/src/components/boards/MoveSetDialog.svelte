<script lang="ts">
  /**
   * Move one collection to another column set, matching its columns.
   * Same names match on their own; the rest default to Unsorted (or done to
   * done) and can be changed. Items remember their old-set columns, so
   * moving back restores them.
   */
  import { BOARD_UNSORTED, type ColumnSet } from '@inbox-rs/rs-module';
  import { columnSets, moveCollectionToSet } from '../../lib/board-actions';
  import { collectionsPhrase, columnOf, isAutoMatch, mapPlanColumn, matchColumns, moveTarget, withColumn } from '../../lib/boards';
  import { collections, items } from '../../lib/stores';
  import { showToast } from '../../lib/toast';
  import ColumnsPreview from './ColumnsPreview.svelte';
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
  /** The other collections on the board being left, by name. */
  const others = $derived(
    from
      ? Object.values($collections)
          .filter((c) => c.boardSetId === from.id && c.id !== collectionId && !c.archived)
          .map((c) => c.name)
      : [],
  );
  const result = $derived.by(() => {
    if (!to) return '';
    const totals = new Map<string, number>();
    for (const item of own) {
      // Where the board will actually show it: completion doesn't change,
      // so an open todo sent to the done column shows in Unsorted.
      const shown = columnOf(withColumn(item, to, moveTarget(item, from, to, mapping, explicit)), to);
      totals.set(shown, (totals.get(shown) ?? 0) + 1);
    }
    const parts = [...totals].map(([id, n]) => {
      const name = to.columns.find((c) => c.id === id)?.name ?? 'Unsorted';
      return `${n} ${n === 1 ? 'item' : 'items'} to ${name}`;
    });
    return parts.length ? `${parts.join(', ')}.` : 'No items to move.';
  });

  const othersPhrase = $derived(collectionsPhrase(others));
  const fromDone = $derived(from?.columns.find((c) => c.done));
  const toDone = $derived(to?.columns.find((c) => c.done));

  let busy = $state(false);
  const planColumnName = $derived(
    collection?.planColumnId ? from?.columns.find((c) => c.id === collection.planColumnId)?.name : undefined,
  );
  const planTarget = $derived(to ? mapPlanColumn(collection?.planColumnId, to, mapping) : undefined);

  async function move() {
    // Once the move lands, this set is the collection's own and no longer a
    // destination, so `to` goes undefined: keep hold of it for the message.
    const dest = to;
    if (!dest || busy) return;
    busy = true;
    try {
      const { planColumnDropped } = await moveCollectionToSet(collectionId, dest.id, from ? mapping : {}, explicit);
      showToast(
        planColumnDropped
          ? `This collection now uses the ${dest.name} board. None of its todos show on the Todos page until you pick a column again in Board settings.`
          : `This collection now uses the ${dest.name} board.`,
      );
      onclose();
    } catch (error) {
      console.error('Failed to move collection to set', error);
      showToast('Couldn’t switch the board');
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Switch to a different board" subtitle={collection ? `Collection: ${collection.name}` : undefined} {onclose} {layer} width="34rem">
  {#if !collection}
    <p class="bx-note">This collection no longer exists.</p>
  {:else if targets.length === 0}
    <p class="bx-note">This is your only board, so there's nothing to switch to yet. Set up a board on another collection, or add one in Settings › Boards, and it will be offered here.</p>
  {:else}
    <div class="fromto">
      <div>
        <span class="bx-label">Current board</span>
        <strong>{from?.name ?? 'No board'}</strong>
      </div>
      <div class="grow">
        <label class="bx-label" for="move-to">Switch to</label>
        <select id="move-to" class="bx-select" bind:value={toId}>
          {#each targets as s (s.id)}
            <option value={s.id}>{s.name}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if to}
      <ColumnsPreview columns={to.columns} />
    {/if}

    {#if from && to}
      <div>
        <span class="bx-label">Where should the items go?</span>
        <p class="bx-note above">Choose where the items from each column should go. Matching names are selected for you.{#if fromDone && toDone && fromDone.name.trim().toLowerCase() !== toDone.name.trim().toLowerCase()}{' '}Items in {fromDone.name} go to {toDone.name}: each is where its board puts ticked todos.{/if}</p>
        <ul class="bx-rows">
          {#each from.columns as c (c.id)}
            {@const n = counts.get(c.id) ?? 0}
            <li class:empty={!n}>
              <span class="bx-swatch" style="background: {c.color}"></span>
              <span class="bx-grow">{c.name} <span class="bx-muted">{n ? `${n} item${n > 1 ? 's' : ''}` : 'empty'}</span></span>
              <span aria-hidden="true">→</span>
              <select
                class="bx-select map"
                aria-label="Items in {c.name} go to"
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
              <span class="auto">{#if c.id !== BOARD_UNSORTED && isAutoMatch(c, to, mapping[c.id] ?? BOARD_UNSORTED)}same name{/if}</span>
            </li>
          {/each}
        </ul>
      </div>
      <p class="bx-note">
        <strong>After switching:</strong> {result}
        {#if others.length}{othersPhrase.charAt(0).toUpperCase() + othersPhrase.slice(1)} {others.length === 1 ? 'stays' : 'stay'} on the {from.name} board.{/if}
      </p>
      {#if collection.offPlan && planColumnName}
        <p class="bx-note">
          {#if planTarget}
            {collection.name}'s todos in {planColumnName} show on the Todos page; after switching, its {to.columns.find((c) => c.id === planTarget)?.name} todos will.
          {:else}
            <strong>{planColumnName}</strong> goes to Unsorted, so none of {collection.name}'s todos will show on the Todos page until you pick a column again in Board settings.
          {/if}
        </p>
      {/if}
      <p class="bx-note">Nothing is deleted. Items remember their columns on the {from.name} board, in case you switch this collection back later.</p>
    {/if}
  {/if}

  {#snippet footer()}
    <button type="button" class="bx-btn" onclick={onclose}>Cancel</button>
    <button type="button" class="bx-btn bx-primary" disabled={!to || busy} onclick={move}>Switch board</button>
  {/snippet}
</Sheet>

<style>
  .above {
    margin-bottom: 0.5rem;
  }

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
    width: 9.5rem;
    max-width: 42vw;
    padding: 0.3rem 0.45rem;
  }

  /* Phones: source on one line, destination under it, so long column
     names never collapse into a stack of single words. */
  @media (max-width: 520px) {
    .bx-rows > li {
      flex-wrap: wrap;
    }

    .bx-rows > li .bx-grow {
      flex-basis: calc(100% - 1.5rem);
    }

    .map {
      flex: 1;
      width: auto;
      max-width: none;
    }

    .auto:empty {
      display: none;
    }

    .fromto {
      flex-direction: column;
      align-items: stretch;
      gap: 0.6rem;
    }
  }

  .bx-rows > li.empty {
    opacity: 0.8;
    background: var(--bg);
  }

  .auto {
    width: 4.6rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
