<script lang="ts">
  /**
   * Process inbox: the inbox one card at a time. Each card gets one
   * decision — make it a todo for a horizon, file it, archive it, or skip
   * it for now — and the panel moves on. Every action confirms with an
   * undo toast, and single-key shortcuts work while the panel is open.
   *
   * The queue is the inbox as it stood when the panel opened. Cards handled
   * elsewhere meanwhile (or by undo coming back) are picked up as they are:
   * a card that has left the inbox is passed over.
   */
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import { getRecentCollectionIds, suggestCollections } from '../lib/collection-suggest';
  import { kindOf } from '../lib/kinds';
  import { now } from '../lib/now';
  import { planFor } from '../lib/plan';
  import { collections, items, sortedItems } from '../lib/stores';
  import {
    type CardHints,
    nextInQueue,
    previousInQueue,
    relativeAge,
    suggestedDate,
    TRIAGE_HORIZONS,
    type TriageHorizon,
  } from '../lib/triage';
  import { archiveFromInbox, fileFromInbox, todoFromInbox } from '../lib/triage-actions';
  import CollectionPicker from './CollectionPicker.svelte';

  let {
    queue,
    hintsFor,
    onopen,
    onclose,
    oncurrent,
  }: {
    /** Inbox ids in the order to process them. */
    queue: string[];
    /** The same warning line the grid shows on each card. */
    hintsFor: (item: InboxItem) => CardHints;
    /** Open the full card. */
    onopen: (item: InboxItem) => void;
    onclose: () => void;
    /** Tells the grid which card to highlight. */
    oncurrent: (id: string | null) => void;
  } = $props();

  let pos = $state(0);
  let done = $state(0);
  let busy = $state(false);
  let picking = $state(false);

  const inInbox = $derived(new Set($sortedItems.map((i) => i.id)));
  const index = $derived(nextInQueue(queue, pos, (id) => inInbox.has(id)));
  const current = $derived(index >= 0 ? ($items[queue[index]] ?? null) : null);
  const remaining = $derived(queue.filter((id) => inInbox.has(id)).length);

  $effect(() => {
    oncurrent(current?.id ?? null);
  });
  $effect(() => () => oncurrent(null));

  const liveCollections = $derived(
    Object.values($collections).filter((c) => !c.archived),
  );
  const suggestions = $derived(
    current
      ? suggestCollections(current, liveCollections, $items, getRecentCollectionIds(), 2).map(
          (s) => s.collection,
        )
      : [],
  );
  const dateHint = $derived(current ? suggestedDate(current, $now) : null);
  const flag = $derived(current ? hintsFor(current).flag : undefined);

  const preview = $derived.by(() => {
    if (!current) return '';
    const r = current as unknown as Record<string, unknown>;
    const text =
      (typeof r.body === 'string' && r.body) ||
      (typeof r.notes === 'string' && r.notes) ||
      current.description ||
      (typeof r.url === 'string' ? r.url : '');
    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/[*_#>`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  });

  /** "Thu, Nov 26". */
  function dayLabel(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /** Move on first so the panel feels instant; step back if the write fails. */
  async function act(run: (item: InboxItem, onundo: () => void) => Promise<boolean>) {
    if (!current || busy) return;
    const item = current;
    const at = index;
    busy = true;
    pos = at + 1;
    // Undo brings the card back into the inbox; show it again.
    const onundo = () => {
      pos = at;
      done = Math.max(0, done - 1);
    };
    try {
      if (await run(item, onundo)) done += 1;
      // Back to the card that failed — unless the user has moved on meanwhile.
      else if (pos === at + 1) pos = at;
    } finally {
      busy = false;
    }
  }

  const plan = (h: TriageHorizon) => {
    const label = TRIAGE_HORIZONS.find((x) => x.key === h)?.label ?? '';
    const today = new Date($now);
    today.setHours(0, 0, 0, 0);
    return act((item, onundo) =>
      todoFromInbox(
        item,
        h === 'today' ? { day: today } : { plan: planFor(h, $now) },
        label,
        onundo,
      ),
    );
  };
  const useDate = (d: Date) =>
    act((item, onundo) => todoFromInbox(item, { day: d }, dayLabel(d), onundo));
  const file = (c: Collection) => act((item, onundo) => fileFromInbox(item, c, onundo));
  const archive = () => act(archiveFromInbox);

  /** Leave this card in the inbox and show the next. */
  function skip() {
    if (index >= 0) pos = index + 1;
  }

  /** Show the previous card still in the inbox. */
  function back() {
    const prev = previousInQueue(queue, index >= 0 ? index : queue.length, (id) => inInbox.has(id));
    if (prev >= 0) pos = prev;
  }

  /** Go through the skipped cards again. */
  function startOver() {
    pos = 0;
  }

  /** The collection picker's choice; closing it without one does nothing. */
  function onpick(collectionId: string | undefined) {
    picking = false;
    const target = collectionId ? $collections[collectionId] : undefined;
    if (target) void file(target);
  }

  /** Whether a key press is text going into a field. */
  function typing(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return (
      el.isContentEditable ||
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT'
    );
  }

  /** Single-key shortcuts while the panel is open and nothing sits on top. */
  function handleKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (picking || typing(e.target)) return;
    // A card or another dialog is open on top: its keys win.
    if (document.querySelector('[aria-modal="true"]')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape') {
      e.preventDefault();
      onclose();
      return;
    }
    if (!current) return;
    const horizon = TRIAGE_HORIZONS.find((h) => h.shortcut === key);
    let handled = true;
    if (horizon) void plan(horizon.key);
    else if (key === '1' && suggestions[0]) void file(suggestions[0]);
    else if (key === '2' && suggestions[1]) void file(suggestions[1]);
    else if (key === 'f') picking = true;
    else if (key === 'd' && dateHint) void useDate(dateHint);
    else if (key === 'a') void archive();
    else if (key === 'j' || key === 'ArrowRight') skip();
    else if (key === 'k' || key === 'ArrowLeft') back();
    else if (key === 'o' || (key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'BUTTON')) onopen(current);
    else handled = false;
    if (handled) e.preventDefault();
  }
</script>

<svelte:window onkeydown={handleKey} />

<section class="triage" aria-labelledby="triage-title">
  <header class="head">
    <h2 id="triage-title">Process inbox</h2>
    {#if current}
      <span class="count">{index + 1} of {queue.length}</span>
    {/if}
    <button type="button" class="close" aria-label="Close Process inbox" onclick={onclose}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </button>
  </header>
  <div
    class="progress"
    role="progressbar"
    aria-label="Triage progress"
    aria-valuemin="0"
    aria-valuemax={queue.length}
    aria-valuenow={current ? index : queue.length}
  >
    <div class="bar" style="width: {queue.length ? ((current ? index : queue.length) / queue.length) * 100 : 100}%"></div>
  </div>

  {#if current}
    <article class="subject" aria-live="polite">
      <div class="meta">{kindOf(current.type).label} · {relativeAge(current.createdAt, $now)}</div>
      <h3 class="title">{current.title || 'Untitled'}</h3>
      {#if preview}
        <p class="preview">{preview}</p>
      {/if}
      {#if flag}
        <p class="flag">{flag}</p>
      {/if}
    </article>

    {#if dateHint}
      <div class="date-hint">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>
        <span class="date-text">Mentions <strong>{dayLabel(dateHint)}</strong></span>
        <button type="button" class="use-date" disabled={busy} onclick={() => useDate(dateHint)}>
          Todo for then <kbd>D</kbd>
        </button>
      </div>
    {/if}

    <div class="block">
      <h4 class="label" id="triage-todo">Make it a todo for…</h4>
      <div class="chips" role="group" aria-labelledby="triage-todo">
        {#each TRIAGE_HORIZONS as h (h.key)}
          <button type="button" class="chip" style="--h: var(--horizon-{h.key === 'today' ? 'due' : h.key})" disabled={busy} onclick={() => plan(h.key)}>
            <span class="swatch" aria-hidden="true"></span>{h.label}<kbd>{h.shortcut.toUpperCase()}</kbd>
          </button>
        {/each}
      </div>
    </div>

    <div class="block">
      <h4 class="label" id="triage-file">Or file it{suggestions.length ? ' — suggested' : ''}</h4>
      <div class="chips" role="group" aria-labelledby="triage-file">
        {#each suggestions as c, i (c.id)}
          <button type="button" class="chip file" class:first={i === 0} disabled={busy} onclick={() => file(c)}>
            <span class="dot" style="background: {c.color || 'var(--text-muted)'}" aria-hidden="true"></span>{c.name}<kbd>{i + 1}</kbd>
          </button>
        {/each}
        <button type="button" class="chip search" disabled={busy} onclick={() => (picking = true)}>
          {liveCollections.length ? `Search ${liveCollections.length}…` : 'Choose a collection…'}<kbd>F</kbd>
        </button>
      </div>
    </div>

    <footer class="actions">
      <button type="button" class="act" onclick={() => onopen(current as InboxItem)}>Open <kbd>O</kbd></button>
      <button type="button" class="act" disabled={busy} onclick={archive}>Archive <kbd>A</kbd></button>
      <button type="button" class="act primary" onclick={skip}>Skip <kbd>→</kbd></button>
    </footer>
  {:else}
    <div class="finished">
      <p class="finished-title">{$sortedItems.length === 0 ? 'Inbox zero' : 'That’s the lot'}</p>
      <p class="finished-sub">
        {done === 0 ? 'Nothing changed.' : `${done} ${done === 1 ? 'card' : 'cards'} sorted.`}
        {remaining > 0 ? ` ${remaining} skipped ${remaining === 1 ? 'card is' : 'cards are'} still waiting.` : ''}
      </p>
      <div class="actions">
        {#if remaining > 0}
          <button type="button" class="act" onclick={startOver}>Go round again</button>
        {/if}
        <button type="button" class="act primary" onclick={onclose}>Close</button>
      </div>
    </div>
  {/if}
</section>

{#if picking && current}
  <CollectionPicker item={current} onpick={onpick} onclose={() => (picking = false)} />
{/if}

<style>
  kbd {
    font: 0.68rem ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--text-muted);
  }

  /* Touch screens have no keys to show. */
  @media (hover: none) {
    kbd {
      display: none;
    }
  }

  .triage {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    box-shadow: 0 8px 24px var(--shadow);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .head h2 {
    flex: 1;
    margin: 0;
    font-size: 1rem;
  }

  .count {
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .close {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface-tint);
  }

  .progress {
    height: 6px;
    border-radius: 999px;
    background: var(--surface-tint);
    overflow: hidden;
  }

  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease-out;
  }

  .subject {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }

  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .preview {
    margin: 0;
    font-size: 0.86rem;
    color: var(--text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .flag {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--warn-text);
  }

  .date-hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.65rem;
    border-radius: var(--radius-sm);
    background: var(--accent-subtler);
    color: var(--accent-text);
    font-size: 0.82rem;
  }

  .date-text {
    flex: 1;
    min-width: 8rem;
  }

  .use-date {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.85rem;
    padding: 0 0.6rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }

  .use-date kbd {
    color: inherit;
    opacity: 0.8;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .label {
    margin: 0;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.1rem;
    padding: 0 0.65rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    max-width: 100%;
  }

  .chip:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .chip:disabled,
  .act:disabled,
  .use-date:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .swatch {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 3px;
    background: var(--h, var(--text-muted));
    flex-shrink: 0;
  }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .chip.file.first {
    border: 2px solid var(--accent);
    background: var(--accent-subtler);
    color: var(--accent-text);
  }

  .chip.search {
    border-style: dashed;
    background: transparent;
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
  }

  .act {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 2.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
  }

  .act:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .act.primary {
    flex: 1.3;
    border-color: transparent;
    background: var(--accent);
    color: #fff;
    font-weight: 700;
  }

  .act.primary:hover:not(:disabled) {
    background: var(--accent-hover, var(--accent));
  }

  .act.primary kbd {
    color: inherit;
    opacity: 0.8;
  }

  .finished {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    text-align: center;
    padding-top: 0.25rem;
  }

  .finished-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
  }

  .finished-sub {
    margin: 0 0 0.4rem;
    font-size: 0.86rem;
    color: var(--text-muted);
  }

</style>
