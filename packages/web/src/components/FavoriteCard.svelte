<script lang="ts">
  /** A favourite collection on the Collections page: what's in it, and what's due. */
  import type { Collection } from '@inbox-rs/rs-module';

  let {
    collection,
    groupName,
    itemCount,
    latest,
    todoText,
    tone,
    onopen,
  }: {
    collection: Collection;
    groupName: string;
    itemCount: number;
    /** Title of the newest item, if any. */
    latest: string;
    todoText: string;
    tone: 'plain' | 'week' | 'warn' | 'muted';
    onopen: () => void;
  } = $props();
</script>

<button type="button" class="fav" style="--c: {collection.color || 'var(--accent)'}" onclick={onopen}>
  <span class="top">
    <span class="swatch" aria-hidden="true"></span>
    <span class="name">{collection.name}</span>
  </span>
  <span class="meta">{groupName ? `${groupName} · ` : ''}{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
  {#if latest}<span class="latest">{latest}</span>{/if}
  <span class="todos {tone}">{todoText}</span>
</button>

<style>
  .fav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--border);
    border-left: 4px solid var(--c);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .fav:hover {
    border-color: var(--accent);
    border-left-color: var(--c);
  }

  .fav:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .swatch {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 999px;
    background: var(--c);
    flex-shrink: 0;
  }

  .name {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta,
  .latest {
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .todos {
    margin-top: 0.15rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--accent-text);
  }

  .todos.week {
    color: var(--horizon-week);
  }

  .todos.warn {
    color: var(--warn-text);
  }

  .todos.muted {
    color: var(--text-muted);
    font-weight: 600;
  }
</style>
