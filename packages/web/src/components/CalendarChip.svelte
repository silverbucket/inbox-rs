<script lang="ts">
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import { calendarAccounts } from '../lib/calendar-accounts';
  import { cardCalendar } from '../lib/calendar-card';
  import { calendarSyncStatus, cardSyncErrors } from '../lib/calendar-sync';
  import { collections } from '../lib/collections-store';

  /**
   * Which calendar a card is on, and how: kept in sync (⇄), sent once (↗),
   * waiting to be added (…) or in trouble (!). Hidden where it would only
   * repeat the page — inside the collection linked to that same calendar —
   * unless something is wrong.
   */
  let {
    item,
    context = null,
  }: {
    item: InboxItem;
    /** The collection being viewed, if any. */
    context?: Collection | null;
  } = $props();

  const info = $derived(
    cardCalendar(
      item,
      $collections,
      $calendarAccounts,
      $cardSyncErrors,
      $calendarSyncStatus,
    ),
  );
  const redundant = $derived(
    !!info &&
      !info.error &&
      info.mode === 'sync' &&
      !!context?.calendar &&
      context.calendar.url === info.url,
  );
  // A card that simply follows its collection's link needs no name: the
  // collection pill beside it already says where it lives.
  const compact = $derived(
    !!info && info.viaCollection && info.mode === 'sync' && !info.error,
  );
  const label = $derived.by(() => {
    if (!info) return '';
    if (info.error) return `${info.name}: ${info.error}`;
    if (info.mode === 'pending') return `Adding to ${info.name}`;
    if (info.mode === 'once') return `Sent once to ${info.name}`;
    return `Kept in sync with ${info.name}`;
  });
</script>

{#if info && !redundant}
  <span
    class="cal-chip"
    class:compact
    class:error={!!info.error}
    class:pending={info.mode === 'pending'}
    style="--cal-color: {info.color || 'var(--accent)'}"
    title={label}
    aria-label={label}
    role="img"
  >
    <svg class="cal-icon" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>
    {#if !compact}<span class="name">{info.name}</span>{/if}
    <svg class="mode" aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      {#if info.error}
        <line x1="12" y1="7" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      {:else if info.mode === 'pending'}
        <circle cx="12" cy="12" r="8" stroke-dasharray="3 4"></circle>
      {:else if info.mode === 'once'}
        <line x1="7" y1="17" x2="17" y2="7"></line>
        <polyline points="8 7 17 7 17 16"></polyline>
      {:else}
        <polyline points="17 2 21 6 17 10"></polyline>
        <path d="M3 11V9a3 3 0 0 1 3-3h15"></path>
        <polyline points="7 22 3 18 7 14"></polyline>
        <path d="M21 13v2a3 3 0 0 1-3 3H3"></path>
      {/if}
    </svg>
  </span>
{/if}

<style>
  .cal-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 9.5rem;
    min-width: 0;
    padding: 0.12rem 0.45rem 0.12rem 0.4rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--cal-color) 40%, var(--border));
    background: color-mix(in srgb, var(--cal-color) 10%, transparent);
    color: var(--text-muted);
    font-size: 0.72rem;
    line-height: 1.2;
    flex-shrink: 1;
    white-space: nowrap;
  }

  .cal-icon {
    color: var(--cal-color);
    flex-shrink: 0;
  }

  .compact {
    padding: 0.14rem 0.38rem;
    gap: 0.2rem;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .mode {
    flex-shrink: 0;
    opacity: 0.85;
  }

  .pending {
    border-style: dashed;
    background: transparent;
  }

  .error {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger-text);
  }

  .error .cal-icon {
    color: inherit;
  }

  .error .mode {
    width: 12px;
    height: 12px;
    opacity: 1;
  }
</style>
