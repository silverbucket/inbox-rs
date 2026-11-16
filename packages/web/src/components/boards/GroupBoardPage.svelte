<script lang="ts">
  /**
   * One group's items as a single board, laid out by a column set the
   * group's collections share. Each card is tagged with its collection;
   * "Add" asks which collection the new item goes in, and dragging only
   * changes the column — never the collection.
   */
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import { fade } from 'svelte/transition';
  import { columnSets } from '../../lib/board-actions';
  import { trapFocus } from '../../lib/actions';
  import { openColumnSet } from '../../lib/settings-request';
  import { collectionItems, collections, groupCollections, groups } from '../../lib/stores';
  import BoardColumns from './BoardColumns.svelte';
  import './boards.css';

  let {
    groupId,
    onselect,
    onexit,
    onfocuscollection,
  }: {
    groupId: string;
    onselect: (item: InboxItem) => void;
    onexit: () => void;
    onfocuscollection: (collectionId: string) => void;
  } = $props();

  let panelEl = $state<HTMLElement>();
  const group = $derived($groups[groupId]);
  // Same membership rule as the rest of the app: ordered ids first, then
  // any collection whose groupId points here but is missing from them.
  const members = $derived<Collection[]>($groupCollections[groupId] ?? []);

  // Sets the group's collections use, most used first.
  const setsUsed = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const c of members) {
      if (c.boardSetId) counts.set(c.boardSetId, (counts.get(c.boardSetId) ?? 0) + 1);
    }
    return $columnSets
      .filter((s) => counts.has(s.id))
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  });
  let chosenId = $state<string | null>(null);
  const set = $derived(setsUsed.find((s) => s.id === chosenId) ?? setsUsed[0]);

  let hidden = $state<Set<string>>(new Set());
  const onBoard = $derived(set ? members.filter((c) => c.boardSetId === set.id) : []);
  const shown = $derived(onBoard.filter((c) => !hidden.has(c.id)));
  const offBoard = $derived(set ? members.filter((c) => c.boardSetId !== set.id) : []);
  const boardItems = $derived(shown.flatMap((c) => $collectionItems[c.id] ?? []));
  const itemTotal = $derived(members.reduce((n, c) => n + ($collectionItems[c.id]?.length ?? 0), 0));
  const lookupCollection = (id: string | undefined) => (id ? ($collections[id] ?? null) : null);

  function toggle(id: string) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    hidden = next;
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    for (const el of document.querySelectorAll('[aria-modal="true"]')) {
      if (el !== panelEl) return;
    }
    onexit();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" transition:fade|global={{ duration: 140 }} onclick={onexit}>
  <div
    class="panel"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={group ? `${group.name} board` : 'Group board'}
    bind:this={panelEl}
    use:trapFocus
    onclick={(e) => e.stopPropagation()}
  >
    <div class="toolbar">
      <button type="button" class="bx-btn bx-small back" onclick={onexit} aria-label="Back" title="Back (Esc)">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        <span class="back-label">Back</span>
      </button>
      <span class="crumb">Collections › {group?.name ?? 'Group'}</span>
    </div>

    {#if !group}
      <p class="bx-note">This group doesn't exist — it may have been deleted.</p>
    {:else}
      <div class="head">
        <h2>{group.name} <span class="bx-muted">{members.length} {members.length === 1 ? 'collection' : 'collections'} · {itemTotal} {itemTotal === 1 ? 'item' : 'items'}{setsUsed.length === 1 && set ? ` · ${set.name} board` : ''}</span></h2>
        {#if setsUsed.length > 1}
          <label class="by">
            Board
            <select class="bx-select" value={set?.id} onchange={(e) => (chosenId = (e.currentTarget as HTMLSelectElement).value)}>
              {#each setsUsed as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
            </select>
          </label>
        {/if}
      </div>

      {#if !set}
        <div class="empty">
          <p>None of {group.name}'s collections has a board yet.</p>
          <p class="bx-note">Open a collection and choose the Board view to set one up. Collections that use the same board show together here.</p>
          <button type="button" class="bx-btn bx-primary" onclick={() => openColumnSet()}>Manage boards</button>
        </div>
      {:else}
        <div class="scope">
          <span class="bx-label inline">Showing collections</span>
          <div class="bx-chips">
            {#each onBoard as c (c.id)}
              {@const n = $collectionItems[c.id]?.length ?? 0}
              <button type="button" class="bx-chip" aria-pressed={!hidden.has(c.id)} onclick={() => toggle(c.id)}>
                <span class="bx-dot" style="background: {c.color || 'var(--text-muted)'}"></span>{c.name}<span class="bx-muted">{n}</span>
              </button>
            {/each}
          </div>
          <span class="open-one">
            <span class="bx-muted">Go to collection</span>
            {#each shown as c (c.id)}
              <button type="button" class="bx-link" aria-label="Open {c.name}" onclick={() => onfocuscollection(c.id)}>{c.name}</button>
            {/each}
          </span>
        </div>
        {#if offBoard.length}
          <p class="bx-note">
            {offBoard.length === 1 ? 'Collection' : 'Collections'} not shown: {offBoard.map((c) => c.name).join(', ')} ({offBoard.every((c) => !c.boardSetId) ? 'no board yet' : offBoard.length === 1 ? 'it uses a different board' : 'not on this board'}).
            <button type="button" class="bx-link" onclick={() => openColumnSet(set.id)}>Add a collection to this board…</button>
          </p>
        {/if}

        {#if shown.length}
          <BoardColumns {set} items={boardItems} {lookupCollection} addTargets={shown} showCollection {onselect} />
        {:else}
          <p class="bx-note">Pick at least one collection above to fill the board.</p>
        {/if}
        <p class="bx-note">
          New cards ask which collection they belong to. Moving a card changes its column, never its collection.
        </p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 140;
    display: flex;
    padding: 1.25rem;
    background: var(--overlay);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
  }

  .panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0.85rem 1rem 1rem;
    overflow-y: auto;
    border-radius: var(--radius);
    background: var(--bg);
    box-shadow: 0 18px 50px var(--shadow);
  }

  .panel:focus {
    outline: none;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .crumb {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }

  .head h2 {
    flex: 1 1 14rem;
    margin: 0;
    font-size: 1.3rem;
    letter-spacing: -0.015em;
  }

  .head h2 .bx-muted {
    margin-left: 0.35rem;
    font-weight: 500;
    letter-spacing: 0;
    white-space: nowrap;
  }

  .by {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .by .bx-select {
    width: auto;
  }

  .scope {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .inline {
    margin: 0;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1.5rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }

  .empty p {
    margin: 0;
  }

  .open-one {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 0.7rem;
    margin-left: auto;
  }

  @media (max-width: 600px) {
    .open-one {
      flex-basis: 100%;
      margin-left: 0;
    }

    /* Same arrow-only Back as a collection's board has on phones. */
    .back-label {
      display: none;
    }

    .back {
      position: relative;
      min-height: 2.1rem;
      padding: 0 0.65rem;
    }

    .back::after {
      content: '';
      position: absolute;
      inset: -6px;
    }

    /* A long board name wraps instead of pushing the page sideways. */
    .head h2 .bx-muted {
      white-space: normal;
    }

    .overlay {
      padding: 0;
    }

    .panel {
      border-radius: 0;
    }
  }
</style>
