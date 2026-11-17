<script lang="ts">
  /**
   * A board's columns at a glance, left to right: coloured dot and name,
   * with a tick on the Finished column. Shown wherever someone picks or
   * reviews a board, so they see what they're getting without opening it.
   */
  import { BOARD_UNSORTED, type BoardColumn } from '@inbox-rs/rs-module';

  let {
    columns,
    counts = undefined,
    withUnsorted = false,
  }: {
    columns: Array<Pick<BoardColumn, 'id' | 'name' | 'color' | 'done'>>;
    /** Item counts per column id; shown after each name when given. */
    counts?: Map<string, number>;
    /** Include the Unsorted column (left out by default: every board has it). */
    withUnsorted?: boolean;
  } = $props();

  const shown = $derived(withUnsorted ? columns : columns.filter((c) => c.id !== BOARD_UNSORTED));
</script>

<ol class="flow" aria-label="Columns">
  {#each shown as c (c.id)}
    <li>
      <span class="dot" style="background: {c.color}" aria-hidden="true"></span>
      <span class="name">{c.name}</span>
      {#if c.done}
        <svg class="tick" role="img" aria-label="Finished column" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      {/if}
      {#if counts}<span class="n">{counts.get(c.id) ?? 0}</span>{/if}
    </li>
  {/each}
</ol>

<style>
  .flow {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.35rem;
  }

  li {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
  }

  /* A quiet chevron between columns says "left to right" without words. */
  li + li::before {
    content: '';
    width: 0.32rem;
    height: 0.32rem;
    margin: 0 0.5rem 0 0.15rem;
    border-top: 1.5px solid var(--text-muted);
    border-right: 1.5px solid var(--text-muted);
    transform: rotate(45deg);
    opacity: 0.55;
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 3px;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }

  .tick {
    color: var(--success, #0f766e);
  }

  .n {
    font-weight: 500;
    color: var(--text-muted);
  }
</style>
