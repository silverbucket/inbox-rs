<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import BookmarkCard from './BookmarkCard.svelte';
  import NoteCard from './NoteCard.svelte';
  import ImageCard from './ImageCard.svelte';
  import VoiceMemoCard from './VoiceMemoCard.svelte';
  import DocumentCard from './DocumentCard.svelte';
  import CodeSnippetCard from './CodeSnippetCard.svelte';
  import DeleteConfirm from './DeleteConfirm.svelte';
  import { deleteItem } from '../lib/stores';

  let { item, onedit }: { item: InboxItem; onedit: (item: InboxItem) => void } = $props();
  let showDelete = $state(false);
  let deleting = $state(false);

  async function handleDelete() {
    deleting = true;
    await deleteItem(item.id, item);
    showDelete = false;
    deleting = false;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class="card" onclick={() => onedit(item)}>
  <div class="card-body">
    {#if item.type === 'bookmark'}
      <BookmarkCard {item} ondelete={handleDelete} />
    {:else if item.type === 'note'}
      <NoteCard {item} />
    {:else if item.type === 'image'}
      <ImageCard {item} ondelete={handleDelete} />
    {:else if item.type === 'voice-memo'}
      <VoiceMemoCard {item} />
    {:else if item.type === 'document'}
      <DocumentCard {item} />
    {:else if item.type === 'code-snippet'}
      <CodeSnippetCard {item} />
    {/if}
  </div>

  <footer class="card-footer">
    <time class="date">{formatDate(item.createdAt)}</time>
    <span class="type-badge">{item.type}</span>
    <button class="btn-delete" onclick={(e) => { e.stopPropagation(); showDelete = true; }} title="Delete">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
  </footer>

  {#if showDelete}
    <DeleteConfirm
      onConfirm={handleDelete}
      onCancel={() => showDelete = false}
      {deleting}
    />
  {/if}
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
    box-shadow: 0 0 0 1px var(--accent), 0 4px 16px rgba(0, 0, 0, 0.3);
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
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .btn-delete {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    transition: color 0.15s;
    cursor: pointer;
  }

  .btn-delete:hover {
    color: var(--danger);
  }
</style>
