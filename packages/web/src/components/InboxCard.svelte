<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import BookmarkCard from './BookmarkCard.svelte';
  import NoteCard from './NoteCard.svelte';
  import ImageCard from './ImageCard.svelte';
  import AudioCard from './AudioCard.svelte';
  import DocumentCard from './DocumentCard.svelte';
  import EmailCard from './EmailCard.svelte';
  let { item, onselect }: { item: InboxItem; onselect: (item: InboxItem) => void } = $props();

  const cardNotes = $derived(
    ('notes' in item
      ? ((item as { notes?: string | null }).notes ?? null)
      : null) ||
      item.description ||
      null,
  );

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<article class="card" role="button" tabindex="0"
  onclick={(e) => {
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, audio, video')) return;
    onselect(item);
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(item); }
  }}>
  <div class="card-body">
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
    <span class="type-badge">{item.type}</span>
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
    padding: 1rem;
  }

  .card-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--border);
    font-size: 0.75rem;
  }

  .date {
    color: var(--text-muted);
  }

  .type-badge {
    background: var(--accent-subtle);
    color: var(--accent);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .card-notes {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--accent);
    line-height: 1.5;
    font-style: italic;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
