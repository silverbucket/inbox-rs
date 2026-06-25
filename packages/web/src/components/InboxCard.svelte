<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import BookmarkCard from './BookmarkCard.svelte';
  import NoteCard from './NoteCard.svelte';
  import ImageCard from './ImageCard.svelte';
  import AudioCard from './AudioCard.svelte';
  import DocumentCard from './DocumentCard.svelte';
  import EmailCard from './EmailCard.svelte';
  import { draggingItemId, DRAG_MIME } from '../lib/drag';

  let { item, onselect }: { item: InboxItem; onselect: (item: InboxItem) => void } = $props();

  // Drag onto a sidebar collection to file the item there. The id rides in
  // dataTransfer; the store lets drop targets highlight during the drag.
  function onDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(DRAG_MIME, item.id);
    e.dataTransfer.setData('text/plain', item.title || item.id);
    e.dataTransfer.effectAllowed = 'move';
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
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
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
