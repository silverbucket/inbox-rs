<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { untrack } from 'svelte';
  import { inview } from '../lib/actions';
  import { isTodoLike, parseQuery, searchItemsWithTerms } from '../lib/search';
  import { collections, groups, items } from '../lib/stores';
  import InboxCard from './InboxCard.svelte';
  import TodoRow from './TodoRow.svelte';

  let {
    query,
    onquerychange,
    onselect,
    onfocuscollection,
    focusOnMount = false,
    focusNonce = 0,
  }: {
    /** Search text from the route (`#/search?q=`). */
    query: string;
    /** Called on every edit so the URL tracks the text (shareable, survives reload). */
    onquerychange: (query: string) => void;
    onselect: (item: InboxItem) => void;
    /** Open a result's collection in focus mode. */
    onfocuscollection: (collectionId: string) => void;
    /** Focus the field on mount. Off on touch, where the keyboard would cover the results. */
    focusOnMount?: boolean;
    /** Bump to re-focus the field while the page is already showing (the shortcut). */
    focusNonce?: number;
  } = $props();

  // Seeded from the route once; the effect below keeps it in step afterwards.
  // svelte-ignore state_referenced_locally
  let text = $state(query);
  let inputEl = $state<HTMLInputElement | null>(null);

  // The route is the source of truth; when it changes underneath us (a
  // pasted link, browser history), adopt its text. Edits flow the other way
  // through `onquerychange`, and App writes them back to the route
  // synchronously, so `text` and `query` only differ mid-navigation.
  $effect(() => {
    const fromRoute = query;
    untrack(() => {
      if (fromRoute !== text) text = fromRoute;
    });
  });

  $effect(() => {
    if (focusOnMount) inputEl?.focus();
  });

  $effect(() => {
    if (focusNonce > 0) {
      inputEl?.focus();
      inputEl?.select();
    }
  });

  // Incremental rendering, as in InboxGrid: a broad term can match most of
  // the store, and mounting every card at once is what the paging avoids.
  // Each new query starts a fresh window from the top.
  const PAGE = 60;
  let visibleCards = $state(PAGE);
  let visibleTodos = $state(PAGE);

  function setText(next: string) {
    text = next;
    visibleCards = PAGE;
    visibleTodos = PAGE;
    onquerychange(next);
  }

  function clear() {
    setText('');
    inputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    // First Escape clears the text; a second one drops focus so the page's
    // other shortcuts come back.
    e.preventDefault();
    if (text) clear();
    else inputEl?.blur();
  }

  const terms = $derived(parseQuery(text));
  const hasTerms = $derived(terms.length > 0);
  const results = $derived(
    searchItemsWithTerms(Object.values($items), terms, $collections),
  );
  const todos = $derived(results.filter((r) => isTodoLike(r.item)).map((r) => r.item));
  const cards = $derived(results.filter((r) => !isTodoLike(r.item)).map((r) => r.item));
  const shownTodos = $derived(todos.slice(0, visibleTodos));
  const shownCards = $derived(cards.slice(0, visibleCards));

  function lookupCollection(id: string | undefined) {
    return id ? ($collections[id] ?? null) : null;
  }

  function lookupGroup(collectionId: string | undefined) {
    const col = lookupCollection(collectionId);
    return col?.groupId ? ($groups[col.groupId] ?? null) : null;
  }

  /** Where a card lives, so a result can be placed without opening it. */
  function locationOf(item: InboxItem): { label: string; color?: string; collectionId?: string } {
    if (item.collectionId) {
      const col = $collections[item.collectionId];
      return col
        ? { label: col.name, color: col.color, collectionId: col.id }
        : { label: 'Missing collection' };
    }
    return { label: 'Inbox' };
  }
</script>

<div class="search-page">
  <form class="search-form" role="search" onsubmit={(e) => e.preventDefault()}>
    <div class="search-box">
      <svg aria-hidden="true" class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input
        bind:this={inputEl}
        value={text}
        type="search"
        class="search-input"
        placeholder="Search everything…"
        aria-label="Search"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        oninput={(e) => setText(e.currentTarget.value)}
        onkeydown={handleKeydown}
      />
      {#if text}
        <button type="button" class="search-clear" aria-label="Clear search" onclick={clear}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      {/if}
    </div>
  </form>

  {#if !hasTerms}
    <p class="page-hint">
      Searches titles, notes, links, transcripts, senders and collection names
      across your inbox, todos and collections. Wrap words in quotes to match a phrase.
    </p>
  {:else if results.length === 0}
    <div class="empty-state" role="status">
      <p class="empty-title">Nothing matches “{text.trim()}”</p>
      <p class="empty-sub">Try fewer words, or check the spelling.</p>
    </div>
  {:else}
    <div class="status-bar" role="status">
      <span class="status-count">{results.length}</span>
      {results.length === 1 ? 'result' : 'results'} for “{text.trim()}”
    </div>

    {#if todos.length > 0}
      <section class="result-section" aria-label="Matching todos">
        <h2 class="section-head">Todos <span class="section-count">{todos.length}</span></h2>
        <ul class="todo-list" role="list">
          {#each shownTodos as todo (todo.id)}
            <TodoRow
              {todo}
              collection={lookupCollection(todo.collectionId)}
              group={lookupGroup(todo.collectionId)}
              readonly={!!todo.archived}
              {onselect}
            />
          {/each}
        </ul>
        {#if visibleTodos < todos.length}
          {#key visibleTodos}
            <div
              class="load-sentinel"
              aria-hidden="true"
              use:inview={() => {
                visibleTodos = Math.min(visibleTodos + PAGE, todos.length);
              }}
            ></div>
          {/key}
        {/if}
      </section>
    {/if}

    {#if cards.length > 0}
      <section class="result-section" aria-label="Matching cards">
        <h2 class="section-head">Cards <span class="section-count">{cards.length}</span></h2>
        <div class="grid-wrap">
          <div class="grid">
            {#each shownCards as item (item.id)}
              {@const where = locationOf(item)}
              {@const collectionId = where.collectionId}
              <div class="result" class:archived={!!item.archived}>
                <div class="result-where">
                  {#if collectionId}
                    <button
                      type="button"
                      class="where-chip where-link"
                      title="Open {where.label}"
                      onclick={() => onfocuscollection(collectionId)}
                    >
                      <span class="where-dot" style="background: {where.color || 'var(--accent)'}"></span>
                      {where.label}
                    </button>
                  {:else}
                    <span class="where-chip">{where.label}</span>
                  {/if}
                  {#if item.archived}
                    <span class="where-chip where-muted">Archived</span>
                  {/if}
                </div>
                <InboxCard {item} {onselect} />
              </div>
            {/each}
          </div>
          {#if visibleCards < cards.length}
            {#key visibleCards}
              <div
                class="load-sentinel"
                aria-hidden="true"
                use:inview={() => {
                  visibleCards = Math.min(visibleCards + PAGE, cards.length);
                }}
              ></div>
            {/key}
          {/if}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .search-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .search-form {
    display: flex;
    justify-content: center;
  }

  .search-box {
    position: relative;
    width: 100%;
    max-width: 640px;
  }

  .search-icon {
    position: absolute;
    left: 1rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text);
    padding: 0.7rem 2.6rem 0.7rem 2.7rem;
    /* >=1rem avoids the iOS Safari focus-zoom on touch devices. */
    font-size: 1.05rem;
    font-family: inherit;
    -webkit-appearance: none;
    appearance: none;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  /* One clear control, ours, so it looks the same in every engine. */
  .search-input::-webkit-search-cancel-button,
  .search-input::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtler);
  }

  .search-clear {
    position: absolute;
    right: 0.6rem;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .search-clear:hover {
    background: var(--surface-tint-hover);
    color: var(--text);
  }

  .search-clear:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .page-hint {
    max-width: 520px;
    margin: 1.5rem auto 0;
    text-align: center;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
  }

  .empty-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 0.35rem;
  }

  .empty-sub {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin: 0;
  }

  /* Mirrors InboxGrid's "N things waiting" bar. */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.9rem;
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

  .result-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .section-count {
    font-weight: 600;
    letter-spacing: 0;
    color: var(--text-muted);
    background: var(--surface-tint);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  /* Same container-query masonry as InboxGrid so the two look alike. */
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

  .result {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .result.archived :global(.card) {
    opacity: 0.7;
  }

  .result.archived :global(.card:hover) {
    opacity: 1;
  }

  .result-where {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.25rem;
  }

  .where-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
    border: 1px solid transparent;
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    background: var(--surface-tint);
    font-family: inherit;
  }

  .where-link {
    cursor: pointer;
  }

  .where-link:hover {
    color: var(--text);
    border-color: var(--border);
  }

  .where-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .where-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .where-muted {
    background: none;
    border-color: var(--border);
  }

  .load-sentinel {
    height: 1px;
  }

  @container (max-width: 760px) {
    .grid { column-count: 2; }
  }

  @container (max-width: 480px) {
    .grid { column-count: 1; }
  }
</style>
