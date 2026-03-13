<script lang="ts">
  import { sortedItems } from '../lib/stores';
  import InboxCard from './InboxCard.svelte';

  const items = $derived($sortedItems);
</script>

{#if items.length === 0}
  <div class="empty">
    <p>Your inbox is empty.</p>
    <p class="hint">Use the browser extension to save links, notes, and more.</p>
  </div>
{:else}
  <div class="grid">
    {#each items as item (item.id)}
      <InboxCard {item} />
    {/each}
  </div>
{/if}

<style>
  .grid {
    column-count: 3;
    column-gap: 1rem;
  }

  .grid > :global(*) {
    break-inside: avoid;
    margin-bottom: 1rem;
  }

  @media (max-width: 900px) {
    .grid { column-count: 2; }
  }

  @media (max-width: 550px) {
    .grid { column-count: 1; }
  }

  .empty {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--text-muted);
  }

  .empty p {
    font-size: 1.1rem;
  }

  .hint {
    font-size: 0.9rem !important;
    margin-top: 0.5rem;
    opacity: 0.7;
  }
</style>
