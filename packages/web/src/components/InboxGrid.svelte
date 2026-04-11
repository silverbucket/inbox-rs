<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { sortedItems } from '../lib/stores';
  import InboxCard from './InboxCard.svelte';

  let { onselect }: { onselect: (item: InboxItem) => void } = $props();
  const items = $derived($sortedItems);

</script>

{#if items.length === 0}
  <div class="inbox-zero">
    <div class="zero-glow"></div>
    <div class="zero-icon">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h2 class="zero-heading">Inbox zero</h2>
    <p class="zero-sub">You're all caught up. Nothing to process.</p>
  </div>
{:else}
  <div class="status-bar">You've got <span class="status-count">{items.length}</span> {items.length === 1 ? 'thing' : 'things'} waiting</div>
  <div class="grid">
    {#each items as item (item.id)}
      <InboxCard {item} {onselect} />
    {/each}
  </div>
{/if}

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
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

  .inbox-zero {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
    gap: 0.5rem;
    position: relative;
  }

  .zero-glow {
    position: absolute;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--accent-subtler) 0%, transparent 70%);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -60%);
    pointer-events: none;
  }

  .zero-icon {
    color: var(--accent);
    opacity: 0.7;
    margin-bottom: 0.5rem;
    animation: fade-in 0.6s ease-out;
  }

  .zero-heading {
    font-size: 1.4rem;
    font-weight: 600;
    color: var(--text);
    animation: fade-in 0.6s ease-out 0.1s both;
  }

  .zero-sub {
    font-size: 0.95rem;
    color: var(--text-muted);
    animation: fade-in 0.6s ease-out 0.2s both;
  }

  @keyframes fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
