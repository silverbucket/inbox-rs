<script lang="ts">
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import BookmarkCard from './BookmarkCard.svelte';
  import NoteCard from './NoteCard.svelte';
  import ImageCard from './ImageCard.svelte';
  import AudioCard from './AudioCard.svelte';
  import DocumentCard from './DocumentCard.svelte';
  import EmailCard from './EmailCard.svelte';
  import { draggingItemId, DRAG_MIME } from '../lib/drag';
  import { now } from '../lib/now';
  import { animatePriorityChange } from '../lib/priority-motion';
  import { formatScheduled, isOverdue, isPast } from '../lib/schedule';
  import { kindOf } from '../lib/kinds';
  import { setItemPinned } from '../lib/stores';
  import { type CardHints, relativeAge } from '../lib/triage';
  import { hasIncompletePreview, metadataReportUrl } from '../lib/metadata-report';

  let {
    item,
    onselect,
    hints,
    onfile,
  }: {
    item: InboxItem;
    onselect: (item: InboxItem) => void;
    /** Inbox-only extras: a warning line, a filing suggestion, emphasis. */
    hints?: CardHints;
    /** File the card into the suggested collection. */
    onfile?: (collection: Collection) => void;
  } = $props();

  // Drag onto a sidebar collection to file the item there. The id rides in
  // dataTransfer; the store lets drop targets highlight during the drag.
  function onDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;
    // svelte-dnd-action sets `ondragstart = () => false` on every direct child
    // of a drop zone, so a bubbling dragstart from a card nested in one (the
    // collections page) cancels the drag before it leaves the ground.
    e.stopPropagation();
    e.dataTransfer.setData(DRAG_MIME, item.id);
    e.dataTransfer.setData('text/plain', item.title || item.id);
    e.dataTransfer.effectAllowed = 'move';
    // Custom drag image: a compact, tilted chip carrying the title + a count
    // badge (so multi-select can extend this later). Mirrors the sidebar mock.
    const ghost = document.createElement('div');
    ghost.textContent = item.title || kind.label;
    Object.assign(ghost.style, {
      position: 'fixed',
      top: '-1000px',
      left: '-1000px',
      maxWidth: '240px',
      padding: '0.45rem 0.65rem',
      borderRadius: '10px',
      background: 'var(--surface)',
      border: '1px solid var(--accent)',
      color: 'var(--text)',
      font: '600 0.85rem system-ui, sans-serif',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      boxShadow: '0 12px 30px rgba(20, 20, 40, 0.22)',
      zIndex: '9999',
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 14, 14);
    // Remove once the browser has snapshotted it for the drag cursor.
    setTimeout(() => ghost.remove(), 0);
    draggingItemId.set(item.id);
  }

  function onDragEnd() {
    draggingItemId.set(null);
  }

  const kind = $derived(kindOf(item.type));
  const reportUrl = $derived(item.type === 'bookmark' && hasIncompletePreview(item) ? metadataReportUrl(item) : null);

  // Bookmarks identify by their source domain rather than the generic label.
  const bookmarkDomain = $derived.by(() => {
    if (item.type !== 'bookmark' || !('url' in item)) return null;
    try {
      return new URL((item as { url: string }).url).hostname.replace(
        /^www\./,
        '',
      );
    } catch {
      return null;
    }
  });
  // `||` not `??`: a parsed-but-empty hostname ('' for odd/non-host URLs)
  // should still fall back to the generic label rather than render blank.
  const kindLabel = $derived(bookmarkDomain || kind.label);

  // The site's favicon decorates bookmark cards in place of the generic
  // bookmark glyph. Resolved against the bookmark URL because older items
  // (and some servers) carry a relative icon path; a failed load falls
  // back to the glyph. The failure is scoped to the URL that failed — a
  // later enrichment pass can replace a broken favicon, and the new URL
  // deserves a fresh attempt.
  let failedFaviconUrl = $state<string | null>(null);
  const bookmarkFavicon = $derived.by(() => {
    if (item.type !== 'bookmark' || !('favicon' in item) || !item.favicon) {
      return null;
    }
    try {
      const resolved = new URL(item.favicon, (item as { url: string }).url);
      return resolved.protocol === 'http:' || resolved.protocol === 'https:'
        ? resolved.href
        : null;
    } catch {
      return null;
    }
  });

  // Preview text — note body or description, shown beneath the title so each
  // card gives a real sense of its content.
  const cardNotes = $derived(
    ('notes' in item
      ? ((item as { notes?: string | null }).notes ?? null)
      : null) ||
      item.description ||
      null,
  );

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  // "yesterday", "5 days ago" — the full date stays in the tooltip.
  const age = $derived(relativeAge(item.createdAt, $now) || formatDate(item.createdAt));

  const scheduledLabel = $derived(item.startsAt ? formatScheduled(item) : '');
  const scheduleOverdue = $derived(isOverdue(item, $now));
  const schedulePast = $derived(isPast(item, $now));

  async function togglePinned(e: MouseEvent) {
    e.stopPropagation();
    try {
      const card = (e.currentTarget as HTMLElement).closest<HTMLElement>(
        '[data-priority-item]',
      );
      await animatePriorityChange(card, () =>
        setItemPinned(item, !item.pinned),
      );
    } catch (error) {
      console.error('Failed to update reference priority:', error);
    }
  }
</script>

<article class="card"
  class:pinned={item.pinned}
  class:duplicate={hints?.duplicate}
  class:stale={hints?.stale}
  class:active={hints?.active}
  data-item-id={item.id}
  data-priority-item
  draggable="true"
  ondragstart={onDragStart}
  ondragend={onDragEnd}
>
  <!-- A native button supplies whole-card mouse and keyboard selection without
       making the article itself interactive. Real card controls sit above this
       overlay, so the flag, links, and media remain independent siblings. -->
  <button
    type="button"
    class="card-select"
    aria-label="Open {item.title}"
    onclick={() => onselect(item)}
  ></button>
  <div class="card-body">
    <button
      type="button"
      class="pin-button"
      class:active={item.pinned}
      aria-pressed={item.pinned === true}
      aria-label={item.pinned ? `Remove important flag from ${item.title}` : `Flag ${item.title} as important`}
      title={item.pinned ? 'Remove important flag' : 'Flag as important'}
      onclick={togglePinned}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path fill={item.pinned ? 'currentColor' : 'none'} d="M5 4s1.5-1 4-1 4 2 7 2 4-1 4-1v10s-1 1-4 1-4-2-7-2-4 1-4 1z"></path>
        <path d="M5 22V4"></path>
      </svg>
    </button>
    <div class="card-kind">
      <span class="kind-ic" style="--kc:{kind.color}" aria-hidden="true">
        {#if item.type === 'note'}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
        {:else if item.type === 'bookmark'}
          {#if bookmarkFavicon && bookmarkFavicon !== failedFaviconUrl}
            <img
              class="kind-favicon"
              src={bookmarkFavicon}
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
              onerror={(e) => {
                // Detaching an img mid-load (an item update can swap the
                // if-block) aborts the fetch and fires `error` on the
                // detached node. Only a *connected* img that fails should
                // fall back to the glyph — an abort must not latch the
                // failure and suppress the favicon after it returns.
                const img = e.currentTarget as HTMLImageElement;
                if (img.isConnected) {
                  failedFaviconUrl = img.src;
                }
              }}
            />
          {:else}
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          {/if}
        {:else if item.type === 'image'}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
        {:else if item.type === 'audio'}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
        {:else if item.type === 'document'}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        {:else if item.type === 'email'}
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
        {/if}
      </span>
      <span class="kind-label">{kindLabel}</span>
      <time class="date" datetime={item.createdAt} title={formatDate(item.createdAt)}>{age}</time>
    </div>

    {#if item.type === 'bookmark'}
      <BookmarkCard {item} />
    {:else if item.type === 'note'}
      <NoteCard {item} />
    {:else if item.type === 'image'}
      <ImageCard {item} />
    {:else if item.type === 'audio'}
      <AudioCard {item} />
    {:else if item.type === 'document'}
      <DocumentCard {item} />
    {:else if item.type === 'email'}
      <EmailCard {item} />
    {/if}
    {#if cardNotes}
      <p class="card-notes">{cardNotes}</p>
    {/if}
    {#if hints?.flag}
      <p class="hint-flag">{hints.flag}</p>
    {/if}
    {#if reportUrl}
      <a class="report-preview" href={reportUrl} target="_blank" rel="noopener noreferrer" title="Review a public Sockethub issue draft on GitHub">Report preview issue ↗</a>
    {/if}
    {#if hints?.suggest && onfile}
      {@const target = hints.suggest}
      <button
        type="button"
        class="hint-file"
        onclick={(e) => {
          e.stopPropagation();
          onfile(target);
        }}
      >
        <span class="hint-dot" style="background: {target.color || 'var(--text-muted)'}" aria-hidden="true"></span>
        File to {target.name}?
      </button>
    {/if}
  </div>

  {#if scheduledLabel}
  <footer class="card-footer">
      <span
        class="sched-chip"
        class:overdue={scheduleOverdue}
        class:past={schedulePast && !scheduleOverdue}
        title="Scheduled · {scheduledLabel}"
      >
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        {scheduledLabel}
      </span>
      {#if item.cancelled}
        <span class="sched-chip overdue cancelled">Cancelled</span>
      {/if}
  </footer>
  {/if}
</article>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: 0 2px 5px color-mix(in srgb, var(--shadow) 25%, transparent);
    transition: border-color 0.15s, box-shadow 0.15s;
    position: relative;
    cursor: pointer;
  }

  .card:hover {
    border-color: var(--accent);
    /* Keep hover paint inside the card so it cannot bleed across masonry columns. */
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .card.pinned {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .card-select {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    cursor: pointer;
  }

  .card-select:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: -3px;
  }

  /* Keep genuine card controls above the full-card selection surface. The
     pin button is excluded — it is absolutely positioned in the card corner
     and must not pick up `position: relative` (that reserves flow space and
     shifts the flag into the kind row). */
  .card :global(a),
  .card :global(button:not(.card-select):not(.pin-button)),
  .card :global(input),
  .card :global(audio),
  .card :global(video) {
    position: relative;
    z-index: 2;
  }

  .pin-button {
    position: absolute;
    top: 0.65rem;
    right: 0.65rem;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    cursor: pointer;
    opacity: 0;
    transition: color 150ms, background 150ms, opacity 150ms;
  }

  .card:hover .pin-button,
  .card:focus-within .pin-button,
  .pin-button.active {
    opacity: 1;
  }

  .pin-button:hover,
  .pin-button:focus-visible,
  .pin-button.active {
    color: var(--accent-text);
    background: var(--accent-subtler);
  }

  .pin-button:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 1px;
  }

  @media (hover: none) {
    .pin-button {
      width: 44px;
      height: 44px;
      top: 0.35rem;
      right: 0.35rem;
      opacity: 0.65;
    }
  }

  .card-body {
    padding: 1rem 1.1rem 1.1rem;
  }

  /* Per-type identity row: a colour-coded icon chip + source/kind label, so
     each card type reads distinctly at a glance. */
  .card-kind {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.7rem;
    padding-right: 2rem;
  }

  .kind-ic {
    width: 24px;
    height: 24px;
    border-radius: 7px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--kc);
    background: color-mix(in srgb, var(--kc) 15%, var(--surface));
  }

  .kind-ic svg {
    width: 14px;
    height: 14px;
  }

  .kind-ic .kind-favicon {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    object-fit: contain;
  }

  .kind-label {
    flex: 1 1 8rem;
    overflow-wrap: anywhere;
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 500;
    white-space: normal;
    min-width: 0;
  }

  .report-preview { margin-top: 0.25rem; min-height: 44px; display: flex; align-items: center; width: fit-content; font-size: 0.78rem; }

  .hint-flag {
    margin: 0.55rem 0 0;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--warn-text);
  }

  .hint-file {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.55rem;
    padding: 0.2rem 0.55rem 0.2rem 0.45rem;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--accent-subtler);
    color: var(--accent-text);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    max-width: 100%;
    text-align: left;
  }

  .hint-file:hover,
  .hint-file:focus-visible {
    border-color: var(--accent-subtle-strong);
  }

  .hint-file:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 1px;
  }

  .hint-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  /* Triage emphasis. Drawn inside the card (inset) so it can't bleed
     across masonry columns. */
  .card.duplicate {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--warn) 70%, transparent);
  }

  .card.stale {
    border-style: dashed;
    background: color-mix(in srgb, var(--surface) 70%, var(--bg));
  }

  .card.active,
  .card.active:hover {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .card-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.1rem;
    border-top: 1px solid var(--border);
    font-size: 0.75rem;
  }

  .date {
    flex-shrink: 0;
    margin-left: auto;
    font-size: 0.72rem;
    font-weight: 400;
    color: var(--text-muted);
  }

  /* Scheduled chip: the card wears its calendar time at a glance. */
  .sched-chip {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: var(--accent-text);
    background: var(--accent-subtler);
    border: 1px solid var(--accent-subtle-strong);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .sched-chip.overdue {
    color: var(--danger-text);
    background: color-mix(in srgb, var(--danger) 8%, transparent);
    border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  }

  .sched-chip.cancelled {
    margin-left: 0;
  }

  .sched-chip.past {
    color: var(--text-muted);
    background: var(--surface-tint);
    border-color: var(--border);
  }

  .card-notes {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  @media (max-width: 600px) {
    .card-notes { -webkit-line-clamp: 3; }
  }
</style>
