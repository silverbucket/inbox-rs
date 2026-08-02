<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import BookmarkCard from './BookmarkCard.svelte';
  import NoteCard from './NoteCard.svelte';
  import ImageCard from './ImageCard.svelte';
  import AudioCard from './AudioCard.svelte';
  import DocumentCard from './DocumentCard.svelte';
  import EmailCard from './EmailCard.svelte';
  import { draggingItemId, DRAG_MIME } from '../lib/drag';
  import { formatScheduled, isOverdue, isPast } from '../lib/schedule';

  let { item, onselect }: { item: InboxItem; onselect: (item: InboxItem) => void } = $props();

  // Drag onto a sidebar collection to file the item there. The id rides in
  // dataTransfer; the store lets drop targets highlight during the drag.
  function onDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;
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

  // Stable per-type identity colours (independent of the theme accent so types
  // stay distinguishable under any accent / light or dark mode).
  const KIND: Record<string, { label: string; color: string }> = {
    note: { label: 'Note', color: '#c08a2e' },
    bookmark: { label: 'Bookmark', color: '#3b82f6' },
    image: { label: 'Image', color: '#3f9d6b' },
    audio: { label: 'Voice memo', color: '#7c6cf0' },
    document: { label: 'Document', color: '#c0573a' },
    email: { label: 'Email', color: '#2f8079' },
  };
  const kind = $derived(
    KIND[item.type] ?? { label: item.type, color: 'var(--text-muted)' },
  );

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

  const scheduledLabel = $derived(item.startsAt ? formatScheduled(item) : '');
  const scheduleOverdue = $derived(isOverdue(item));
  const schedulePast = $derived(isPast(item));
</script>

<article class="card" role="button" tabindex="0"
  draggable="true"
  ondragstart={onDragStart}
  ondragend={onDragEnd}
  onclick={(e) => {
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, audio, video')) return;
    onselect(item);
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(item); }
  }}>
  <div class="card-body">
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
      <span class="type-tag">{item.type}</span>
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
  </div>

  <footer class="card-footer">
    <time class="date">{formatDate(item.createdAt)}</time>
    {#if scheduledLabel}
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
    {/if}
  </footer>
</article>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
    position: relative;
    cursor: pointer;
  }

  .card:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 4px 16px var(--shadow);
  }

  .card-body {
    padding: 1rem 1.1rem 1.1rem;
  }

  /* Per-type identity row: a colour-coded icon chip + source/kind label, so
     each card type reads distinctly at a glance. */
  .card-kind {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.7rem;
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
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .type-tag {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    white-space: nowrap;
    flex-shrink: 0;
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
    color: var(--text-muted);
  }

  /* Scheduled chip: the card wears its calendar time at a glance. */
  .sched-chip {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: var(--accent);
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
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, transparent);
    border-color: color-mix(in srgb, var(--danger) 35%, transparent);
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
</style>
