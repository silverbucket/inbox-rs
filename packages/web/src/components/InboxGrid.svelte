<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { inview } from '../lib/actions';
  import { archivedItems, connected, sortedItems } from '../lib/stores';
  import InboxCard from './InboxCard.svelte';

  let {
    onselect,
    onconnect,
  }: {
    onselect: (item: InboxItem) => void;
    onconnect: () => void;
  } = $props();
  const items = $derived($sortedItems);

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
  const visibleItems = $derived(items.slice(0, visibleCount));

  // Same incremental-rendering safeguard for the archived section:
  // expanding it must not mount every archived card (and queue every media
  // fetch) in one update.
  let archivedVisibleCount = $state(PAGE);
  const visibleArchived = $derived(archived.slice(0, archivedVisibleCount));
</script>

{#if items.length === 0}
  <div class="inbox-zero">
    <div class="zero-glow"></div>
    <div class="zero-icon">
      <svg aria-hidden="true" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h2 class="zero-heading">Inbox zero</h2>
    {#if $connected}
      <p class="zero-sub">You're all caught up. Nothing to process.</p>
    {:else}
      <p class="zero-sub">
        <button class="connect-link" type="button" onclick={onconnect}>Connect to your remoteStorage</button>
        to sync your inbox across devices.
      </p>
    {/if}
  </div>
{:else}
  <div class="status-bar">You've got <span class="status-count">{items.length}</span> {items.length === 1 ? 'thing' : 'things'} waiting</div>
  <div class="grid-wrap">
    <div class="grid">
      {#each visibleItems as item (item.id)}
        <InboxCard {item} {onselect} />
      {/each}
    </div>
    {#if visibleCount < items.length}
      <!-- Keyed so a fresh sentinel (and a fresh IntersectionObserver) mounts
           for each window size; the action fires once and disconnects. -->
      {#key visibleCount}
        <div
          class="load-sentinel"
          aria-hidden="true"
          use:inview={() => {
            visibleCount = Math.min(visibleCount + PAGE, items.length);
          }}
        ></div>
      {/key}
    {/if}
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
      {archived.length} archived — on your calendar
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
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
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
    min-height: 50vh;
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
    color: var(--accent);
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

  .connect-link {
    display: inline;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.16em;
  }

  .connect-link:hover {
    color: var(--accent-hover);
  }

  .connect-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: 2px;
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
