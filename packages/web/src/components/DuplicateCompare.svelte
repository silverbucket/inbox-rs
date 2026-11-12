<script lang="ts">
  /**
   * Every copy of a duplicated card side by side, so the user can see what
   * each one has and keep one. Keeping a copy archives the others; closing
   * changes nothing.
   */
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { portal, trapFocus } from '../lib/actions';
  import { compareRows } from '../lib/duplicate-compare';
  import { now } from '../lib/now';
  import { collections, items } from '../lib/stores';
  import { archiveCopies } from '../lib/triage-actions';
  import InboxCard from './InboxCard.svelte';

  let {
    ids,
    onopen,
    onclose,
  }: {
    /** The flagged card first, then its other copies. */
    ids: string[];
    /** Open one copy's full card. */
    onopen: (item: InboxItem) => void;
    onclose: () => void;
  } = $props();

  // Live copies: one archived or deleted meanwhile drops out.
  const copies = $derived(
    ids.map((id) => $items[id]).filter((item) => item && !item.archived),
  );
  const rows = $derived(compareRows(copies, $collections, $now));
  let busy = $state(false);

  // Nothing left to compare once a single copy remains.
  $effect(() => {
    if (copies.length < 2) onclose();
  });

  async function keep(item: InboxItem) {
    if (busy) return;
    busy = true;
    try {
      await archiveCopies(copies.filter((copy) => copy.id !== item.id));
    } finally {
      busy = false;
    }
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || busy) return;
    e.preventDefault();
    onclose();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- Portalled: the mobile shell's content sits in its own stacking context,
     below the tab bar. -->
<div class="overlay" use:portal onclick={() => { if (!busy) onclose(); }}>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="dup-compare-title"
    tabindex="-1"
    use:trapFocus
    onclick={(e) => e.stopPropagation()}
  >
    <header class="head">
      <div>
        <h2 id="dup-compare-title">
          {copies.length > 2 ? `${copies.length} copies of the same card` : 'Two copies of the same card'}
        </h2>
        <p class="sub">Keep one and the {copies.length > 2 ? 'others are' : 'other is'} archived. Differences are highlighted.</p>
      </div>
      <button type="button" class="close" aria-label="Close" onclick={onclose} disabled={busy}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </header>
    <!-- Each copy spans the same rows (card, one per fact, button), so a
         fact sits at the same height in every column. -->
    <div class="copies" style="--rows: {rows.length + 2}">
      {#each copies as copy, at (copy.id)}
        <section class="copy" aria-label="Copy {at + 1}: {rows.find((r) => r.key === 'where')?.values[at] ?? ''}">
          <InboxCard item={copy} onselect={onopen} />
          <dl class="facts">
            {#each rows as row (row.key)}
              <div class="fact" class:differs={row.differs} data-fact={row.key}>
                <dt>{row.label}</dt>
                <dd class:none={!row.values[at]}>{row.values[at] || 'None'}</dd>
              </div>
            {/each}
          </dl>
          <button type="button" class="keep" onclick={() => keep(copy)} disabled={busy}>Keep this one</button>
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .dialog {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 880px;
    max-height: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px var(--shadow);
    outline: none;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.1rem 1.25rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  .sub {
    margin: 0.25rem 0 0;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: -0.5rem -0.6rem 0 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .close:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg);
  }

  /* One column per copy; more than fit scroll sideways, a copy at a time. */
  .copies {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(260px, 1fr);
    grid-template-rows: repeat(var(--rows), auto);
    gap: 0.15rem 1rem;
    padding: 1.1rem 1.25rem 1.25rem;
    overflow: auto;
    overscroll-behavior: contain;
    scroll-snap-type: x proximity;
  }

  .copy {
    display: grid;
    grid-template-rows: subgrid;
    grid-row: span var(--rows);
    min-width: 0;
    scroll-snap-align: start;
  }

  .copy > :global(.card) {
    margin-bottom: 0.6rem;
  }

  .facts {
    display: contents;
  }

  .fact {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    gap: 0.5rem;
    padding: 0.25rem 0.45rem;
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
  }

  .fact.differs {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .fact.differs dd {
    font-weight: 600;
  }

  dd.none {
    color: var(--text-muted);
    font-weight: 400;
  }

  .keep {
    margin-top: 0.6rem;
    min-height: 44px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
  }

  .keep:disabled,
  .close:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .keep:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }

  @media (max-width: 600px) {
    .overlay {
      padding: 0;
      align-items: flex-end;
    }

    .dialog {
      max-height: 92dvh;
      border-radius: var(--radius) var(--radius) 0 0;
    }

    .copies {
      grid-auto-columns: 82%;
      scroll-snap-type: x mandatory;
    }
  }
</style>
