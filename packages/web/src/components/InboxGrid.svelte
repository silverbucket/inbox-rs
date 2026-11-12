<script lang="ts">
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import { tick, untrack } from 'svelte';
  import { inview } from '../lib/actions';
  import { now } from '../lib/now';
  import { archivedItems, collections, connected, items, restoring, sortedItems } from '../lib/stores';
  import {
    ageBucket,
    buildSiteIndex,
    type CardHints,
    findDuplicates,
    groupInbox,
    lacksTitle,
    quickSuggestion,
  } from '../lib/triage';
  import { fileFromInbox } from '../lib/triage-actions';
  import { enrichBookmark, LINK_PREVIEW_ERROR, linkPreviewsEnabled } from '../lib/enrich';
  import { showToast } from '../lib/toast';
  import InboxCard from './InboxCard.svelte';
  import TriagePanel from './TriagePanel.svelte';

  let {
    onselect,
    onconnect,
  }: {
    onselect: (item: InboxItem) => void;
    onconnect: () => void;
  } = $props();
  const inboxItems = $derived($sortedItems);

  // Age groups: what just arrived, the rest, and what has sat for months.
  const groups = $derived(groupInbox(inboxItems, $now));
  /** Display order across groups — the order Process inbox walks. */
  const ordered = $derived(groups.flatMap((g) => g.items));

  // Cards archived by adding them to a calendar. Collapsed by default,
  // mirroring the Todos page's "N completed" pattern — same mental model:
  // handled, out of the way, still reachable.
  const archived = $derived($archivedItems);
  let archivedExpanded = $state(false);

  // Incremental rendering: mount cards in pages of PAGE as the user scrolls,
  // instead of all at once. At a few thousand items, mounting every card up
  // front means thousands of components (and, for media cards, thousands of
  // queued fetches) before first paint. The sentinel below grows the window
  // when it approaches the viewport. The count is monotonic within a mount —
  // shrinking it on filter changes would yank the scroll position out from
  // under the user; a filtered list simply shows up to the already-earned
  // window. The status bar always reflects the true total.
  const PAGE = 60;
  let visibleCount = $state(PAGE);
  /** Each group's share of the rendering window, in display order. */
  const visibleGroups = $derived.by(() => {
    let budget = visibleCount;
    const out: Array<(typeof groups)[number] & { shown: InboxItem[] }> = [];
    for (const g of groups) {
      if (budget <= 0) break;
      out.push({ ...g, shown: g.items.slice(0, budget) });
      budget -= g.items.length;
    }
    return out;
  });

  // Same incremental-rendering safeguard for the archived section:
  // expanding it must not mount every archived card (and queue every media
  // fetch) in one update.
  let archivedVisibleCount = $state(PAGE);
  const visibleArchived = $derived(archived.slice(0, archivedVisibleCount));

  // ── Card hints ──────────────────────────────────────────────────────
  const liveCollections = $derived(
    Object.values($collections).filter((c) => !c.archived),
  );
  const siteIndex = $derived(buildSiteIndex(liveCollections, $items));
  const duplicates = $derived(findDuplicates(inboxItems));

  /** Shorten a title for a one-line hint. */
  function clip(text: string, n = 40): string {
    return text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;
  }

  /** The flag, filing suggestion and emphasis a card shows in the Inbox. */
  function hintsFor(item: InboxItem): CardHints {
    const dup = duplicates.get(item.id);
    const flag = dup
      ? `Same as “${clip(dup.title || 'another card')}” — archive one?`
      : lacksTitle(item)
        ? 'Preview title looks incomplete'
        : undefined;
    return {
      flag,
      // The card turns this flag into a button that fetches the title.
      untitled: !dup && lacksTitle(item),
      suggest: quickSuggestion(item, siteIndex, liveCollections),
      duplicate: !!dup,
      stale: ageBucket(item, $now) === 'stale',
      active: item.id === triageCurrent,
    };
  }

  /** A card's "fetch the title" button: ask the page, say so if it has none. */
  async function fetchTitle(item: InboxItem) {
    if (item.type !== 'bookmark') return;
    if (!linkPreviewsEnabled()) {
      showToast('Link previews are turned off in Settings');
      return;
    }
    if (!navigator.onLine) {
      showToast('You’re offline — try again when connected');
      return;
    }
    try {
      await enrichBookmark(item);
    } catch {
      showToast(LINK_PREVIEW_ERROR);
      return;
    }
    const live = $items[item.id];
    if (live && lacksTitle(live)) {
      showToast('No better title found — open the card to name it');
    }
  }

  /** A card's "File to …?" button. */
  function fileCard(item: InboxItem, collection: Collection) {
    void fileFromInbox(item, collection);
  }

  // ── Process inbox ───────────────────────────────────────────────────
  let triageQueue = $state<string[] | null>(null);
  let triageCurrent = $state<string | null>(null);
  let layoutEl = $state<HTMLElement | null>(null);

  /** Start Process inbox on the inbox as it stands, in display order. */
  function openTriage() {
    triageQueue = ordered.map((i) => i.id);
  }

  /** Close Process inbox and clear the highlight. */
  function closeTriage() {
    triageQueue = null;
    triageCurrent = null;
  }

  // Keep the card being processed rendered and in view beside the panel.
  // Only a change of card should scroll: `ordered` rebuilds on every clock
  // tick and item change, and tracking it would yank the grid back to the
  // card whenever the user scrolls away.
  $effect(() => {
    const id = triageCurrent;
    if (!id) return;
    untrack(() => {
      const at = ordered.findIndex((i) => i.id === id);
      if (at >= visibleCount) visibleCount = Math.min(inboxItems.length, at + PAGE);
    });
    void tick().then(() => {
      layoutEl
        ?.querySelector(`[data-item-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
</script>

<!-- While Process inbox is open it stays mounted even once the last card
     is handled, so its summary and Close button still show. -->
{#if inboxItems.length === 0 && !triageQueue && $restoring}
  <!-- Local data or a stored session is still loading: show neither empty
       state yet, so a returning user doesn't flash first-run. -->
  <div class="inbox-zero" aria-busy="true"></div>
{:else if inboxItems.length === 0 && !triageQueue && !$connected}
  <!-- First run (or signed out): nothing has been "caught up" yet, so explain
       where the inbox lives instead of celebrating an empty one. -->
  <div class="inbox-zero first-run">
    <div class="zero-glow"></div>
    <h2 class="zero-heading">Your inbox, on your own storage</h2>
    <p class="zero-sub">
      Capture links, notes and files here. Connect a remoteStorage account to
      keep them in sync across your devices — Inbox RS never holds a copy.
    </p>
    <button class="connect-cta" type="button" onclick={onconnect}>Connect storage</button>
    <p class="zero-hint">Or start capturing now — it stays in this browser until you connect.</p>
  </div>
{:else if inboxItems.length === 0 && !triageQueue}
  <div class="inbox-zero">
    <div class="zero-glow"></div>
    <div class="zero-icon">
      <svg aria-hidden="true" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h2 class="zero-heading">Inbox zero</h2>
    <p class="zero-sub">
      {archived.length > 0
        ? "You're all caught up. Archived cards are tucked away below."
        : "You're all caught up. Nothing to process."}
    </p>
  </div>
{:else}
  {#if inboxItems.length > 0}
  <div class="status-bar">
    <span><span class="status-count">{inboxItems.length}</span> {inboxItems.length === 1 ? 'item' : 'items'} to sort</span>
    {#if !triageQueue}
      <button type="button" class="process" onclick={openTriage}>Process inbox</button>
    {/if}
  </div>
  {/if}
  <div class="inbox-layout" class:triaging={!!triageQueue} bind:this={layoutEl}>
    {#if triageQueue}
      <div class="triage-slot">
        <TriagePanel
          queue={triageQueue}
          {hintsFor}
          onopen={onselect}
          onclose={closeTriage}
          oncurrent={(id) => (triageCurrent = id)}
        />
      </div>
    {/if}
    <div class="groups">
      {#each visibleGroups as g (g.key)}
        <section class="group" aria-labelledby="inbox-group-{g.key}">
          <div class="group-head">
            <h2 id="inbox-group-{g.key}">{g.label}</h2>
            {#if groups.length > 1}<span class="group-hint">{g.hint}{g.key === 'new' || g.key === 'earlier' ? ` ${g.items.length === 1 ? 'item' : 'items'}` : ''}</span>{/if}
          </div>
          <div class="grid-wrap">
            <div class="grid">
              {#each g.shown as item (item.id)}
                <InboxCard {item} {onselect} hints={hintsFor(item)} onfile={(c) => fileCard(item, c)} onfetchtitle={() => fetchTitle(item)} />
              {/each}
            </div>
          </div>
        </section>
      {/each}
      {#if visibleCount < inboxItems.length}
        <!-- Keyed so a fresh sentinel (and a fresh IntersectionObserver) mounts
             for each window size; the action fires once and disconnects. -->
        {#key visibleCount}
          <div
            class="load-sentinel"
            aria-hidden="true"
            use:inview={() => {
              visibleCount = Math.min(visibleCount + PAGE, inboxItems.length);
            }}
          ></div>
        {/key}
      {/if}
    </div>
  </div>
{/if}

{#if archived.length > 0}
  <div class="archived-section">
    <button
      type="button"
      class="archived-toggle"
      aria-expanded={archivedExpanded}
      onclick={() => (archivedExpanded = !archivedExpanded)}
    >
      <svg
        aria-hidden="true"
        class="archived-chevron"
        class:open={archivedExpanded}
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
      {archived.length} archived
    </button>
    {#if archivedExpanded}
      <div class="grid-wrap">
        <div class="grid archived-grid">
          {#each visibleArchived as item (item.id)}
            <InboxCard {item} {onselect} />
          {/each}
        </div>
        {#if archivedVisibleCount < archived.length}
          {#key archivedVisibleCount}
            <div
              class="load-sentinel"
              aria-hidden="true"
              use:inview={() => {
                archivedVisibleCount = Math.min(
                  archivedVisibleCount + PAGE,
                  archived.length,
                );
              }}
            ></div>
          {/key}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .status-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem 0.9rem;
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }

  .process {
    min-height: 2.75rem;
    padding: 0 0.85rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: white;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
  }

  .process:hover {
    background: color-mix(in srgb, var(--accent) 85%, black);
  }

  .process:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }

  /* With the panel open it sits beside the cards and stays in view while
     they scroll; on narrow screens it becomes a bottom sheet instead. */
  .inbox-layout.triaging {
    display: grid;
    grid-template-columns: minmax(18rem, 23rem) minmax(0, 1fr);
    gap: 1.25rem;
    align-items: start;
  }

  .triage-slot {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    border-radius: var(--radius);
  }

  @media (max-width: 760px) {
    .inbox-layout.triaging {
      display: block;
      padding-bottom: 55vh;
    }

    .triage-slot {
      position: fixed;
      left: 0.5rem;
      right: 0.5rem;
      bottom: 0.5rem;
      top: auto;
      max-height: 60vh;
      z-index: 150;
    }
  }

  .groups {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }

  .group-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }

  .group-head h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
  }

  .group-hint {
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .status-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 700;
    color: white;
    background: var(--accent);
    min-width: 26px;
    height: 26px;
    border-radius: 999px;
    padding: 0 8px;
    line-height: 1;
  }

  /* Container (not viewport) queries: the masonry column count must track the
     width actually available to the cards, which changes as the sidebar
     expands/collapses — otherwise cards overflow (and get clipped by the
     page's overflow-x:hidden, landing off-screen). */
  .grid-wrap {
    container-type: inline-size;
  }

  .grid {
    column-count: 3;
    column-gap: 1rem;
  }

  .grid > :global(*) {
    break-inside: avoid;
    margin-bottom: 1rem;
  }

  /* Tall enough that the 400px inview rootMargin triggers the next page well
     before the user reaches the end of the rendered cards. */
  .load-sentinel {
    height: 1px;
  }

  /* ── Archived (on calendar) ──────────────────────────────────────────
     Collapsed row mirroring the Todos page's "N completed" section. */
  .archived-section {
    margin-top: 1.5rem;
  }

  .archived-toggle {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 auto 0.75rem;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 0.82rem;
    font-family: inherit;
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .archived-toggle:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .archived-chevron {
    transition: transform 0.15s;
  }

  .archived-chevron.open {
    transform: rotate(90deg);
  }

  .archived-grid > :global(.card) {
    opacity: 0.7;
  }

  .archived-grid > :global(.card:hover) {
    opacity: 1;
  }

  @container (max-width: 760px) {
    .grid { column-count: 2; }
  }

  @container (max-width: 480px) {
    .grid { column-count: 1; }
  }

  .inbox-zero {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: min(50vh, 24rem);
    text-align: center;
    gap: 0.5rem;
    position: relative;
  }

  .zero-glow {
    position: absolute;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--accent-subtler) 0%, transparent 70%);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -60%);
    pointer-events: none;
  }

  .zero-icon {
    color: var(--accent-text);
    opacity: 0.7;
    margin-bottom: 0.5rem;
    animation: fade-in 0.6s ease-out;
  }

  .zero-heading {
    font-size: 1.4rem;
    font-weight: 600;
    color: var(--text);
    animation: fade-in 0.6s ease-out 0.1s both;
  }

  .zero-sub {
    font-size: 0.95rem;
    color: var(--text-muted);
    animation: fade-in 0.6s ease-out 0.2s both;
  }

  .first-run .zero-sub {
    max-width: 28rem;
  }

  .connect-cta {
    margin-top: 0.75rem;
    min-height: 2.5rem;
    padding: 0 1.25rem;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: white;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    animation: fade-in 0.6s ease-out 0.3s both;
  }

  .connect-cta:hover {
    opacity: 0.9;
  }

  .connect-cta:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 3px;
  }

  .zero-hint {
    font-size: 0.82rem;
    color: var(--text-muted);
    animation: fade-in 0.6s ease-out 0.35s both;
  }

  @keyframes fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* On mobile the shell stacks the sidebar above the content, so a 50vh
     vertically-centred empty state floats far below the sidebar with a big
     void above it. Sit it near the top of the content area instead. */
  @media (max-width: 768px) {
    .inbox-zero {
      min-height: 0;
      justify-content: flex-start;
      padding-top: 2.5rem;
    }

    .zero-glow {
      top: 2.5rem;
      transform: translate(-50%, 0);
    }
  }
</style>
