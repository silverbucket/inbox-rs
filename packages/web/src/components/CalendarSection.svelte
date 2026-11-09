<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { CaldavError } from '../lib/caldav';
  import {
    type CalendarChoice,
    calendarAccounts,
    choiceForCalendar,
  } from '../lib/calendar-accounts';
  import { cardCalendar, relativeTime, shortDate } from '../lib/calendar-card';
  import {
    calendarSyncStatus,
    cardSyncErrors,
    keepInSync,
    readOnlyReason,
    recurrenceLabel,
    removeFromCalendar,
    runCalendarSync,
    stopSyncing,
  } from '../lib/calendar-sync';
  import { now } from '../lib/now';
  import { collections, restoreItem, updateItem } from '../lib/stores';
  import { showToast } from '../lib/toast';
  import CalendarPicker from './CalendarPicker.svelte';

  /**
   * The card view's Calendar block: which calendar the card is on, how
   * (kept in sync / sent once / about to be added), where it came from, the
   * last sync, and the actions that change it. Rendered only for cards that
   * are on, or headed for, a calendar.
   */
  let {
    item,
    prepare,
    pickerOpen = $bindable(false),
  }: {
    item: InboxItem;
    /** Settles pending editor saves first, so they can't undo an action. */
    prepare?: () => Promise<void>;
    /** True while the calendar picker is up (the card defers Escape to it). */
    pickerOpen?: boolean;
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
  const status = $derived(info?.url ? $calendarSyncStatus[info.url] : undefined);
  const collection = $derived(
    item.collectionId ? $collections[item.collectionId] : undefined,
  );
  const lockReason = $derived(item.calendarSync ? readOnlyReason(item) : undefined);
  const repeats = $derived(item.calendarSync ? recurrenceLabel(item) : undefined);
  const kind = $derived<'event' | 'task'>(
    item.isTodo || item.type === 'todo' || item.scheduleKind === 'task'
      ? 'task'
      : 'event',
  );

  const lockText = $derived(
    lockReason === 'repeating'
      ? `${repeats ?? 'Repeating'} · edit it in your calendar app. Showing the next date.`
      : lockReason === 'attendees'
        ? 'Has attendees · edit it in your calendar app, so they get the update.'
        : lockReason === 'unsupported'
          ? 'This entry can only be changed in your calendar app.'
          : '',
  );

  const origin = $derived.by(() => {
    const parts: string[] = [];
    if (info?.viaCollection && collection)
      parts.push(`Via the ${collection.name} collection`);
    if (item.calendarCreatedAt)
      parts.push(`created in the calendar ${shortDate(item.calendarCreatedAt)}`);
    if (
      item.calendarChangedAt &&
      (!item.calendarCreatedAt || item.calendarChangedAt > item.calendarCreatedAt)
    )
      parts.push(`last changed there ${relativeTime(item.calendarChangedAt, $now.getTime())}`);
    if (item.importedAt) parts.push(`imported here ${shortDate(item.importedAt)}`);
    return parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p));
  });

  const statusLine = $derived.by(() => {
    if (!info) return '';
    if (!info.connected) {
      return 'Syncs from your other devices';
    }
    if (status?.syncing) return 'Syncing…';
    if (info.mode === 'pending') return 'Adding on the next sync…';
    if (info.mode === 'once') return 'Sent once · not updated';
    if (status?.lastSync) return `In sync · ${relativeTime(status.lastSync, $now.getTime())}`;
    return 'Kept in sync';
  });

  let busy = $state(false);
  let confirmRemove = $state(false);
  

  function friendly(err: unknown) {
    return err instanceof CaldavError || err instanceof Error
      ? err.message
      : 'the calendar relay is unreachable';
  }

  async function act(run: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await prepare?.();
      await run();
    } catch (err) {
      console.error('Calendar action failed', err);
      showToast(`Couldn’t do that: ${friendly(err)}`);
    } finally {
      busy = false;
    }
  }

  function handleStop() {
    const before = item;
    void act(async () => {
      const after = await stopSyncing(item);
      showToast(`Stopped syncing — the entry stays in ${info?.name ?? 'the calendar'}`, after
        ? {
            label: 'Undo',
            run: () =>
              void restoreItem({ before, after }).then(() => runCalendarSync()),
          }
        : undefined);
    });
  }

  function handleResume() {
    const choice = info?.url ? choiceForCalendar(info.url) : undefined;
    if (!choice) return;
    void act(async () => {
      await keepInSync(item, choice);
      showToast(`Kept in sync with ${choice.calendar.name}`);
    });
  }

  function handleRemove() {
    if (!confirmRemove) {
      confirmRemove = true;
      return;
    }
    confirmRemove = false;
    const name = info?.name ?? 'the calendar';
    void act(async () => {
      await removeFromCalendar(item);
      showToast(`Removed from ${name} — the card stays here`);
    });
  }

  function handleSkip() {
    const before = item;
    void act(async () => {
      const after = await updateItem(item.id, (c) =>
        c ? { ...c, calendarSync: false } : null,
      );
      showToast(`Kept off ${info?.name ?? 'the calendar'}`, after
        ? { label: 'Undo', run: () => void restoreItem({ before, after }) }
        : undefined);
    });
  }

  function handleMove(choice: CalendarChoice) {
    pickerOpen = false;
    if (choice.calendar.id === info?.url) return;
    void act(async () => {
      await keepInSync(item, choice);
      showToast(`Moved to ${choice.calendar.name}`);
    });
  }

  function retry() {
    void runCalendarSync();
  }
</script>

{#if info}
  <section class="cal-section" aria-label="Calendar" style="--cal-color: {info.color || 'var(--accent)'}">
    <div class="head">
      <svg class="swatch" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>
      <span class="where">
        <span class="cal-name">{info.name} calendar</span>
        {#if info.account}<span class="acct">{info.account}</span>{/if}
      </span>
      {#if !info.error}
        <span class="state" class:muted={info.mode !== 'sync'} aria-live="polite">
          {#if status?.syncing}<span class="spinner" aria-hidden="true"></span>{:else}<span class="status-dot" class:ok={info.mode === 'sync' && info.connected} aria-hidden="true"></span>{/if}
          {statusLine}
        </span>
      {/if}
    </div>

    {#if lockText}
      <p class="line lock">
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
        {lockText}
      </p>
    {/if}

    {#if origin.length}
      <p class="line muted origin">
        {#each origin as part, i}<span class="part">{part}{i < origin.length - 1 ? ' ·' : ''}</span>{' '}{/each}
      </p>
    {/if}

    {#if info.error}
      <div class="problem" role="status">
        <span>{info.error}</span>
        {#if info.connected}
          <button type="button" class="link-btn" onclick={retry}>Try again</button>
        {/if}
      </div>
    {/if}


    {#if info.connected || info.mode !== 'once'}
      <!-- Keep off / Stop syncing only change the card, so they work on a
           device without the account; the rest talk to the calendar. -->
      <div class="actions">
        {#if info.mode === 'pending'}
          <button type="button" class="btn" disabled={busy} onclick={handleSkip}>Keep off {info.name}</button>
        {:else if info.mode === 'once'}
          <button type="button" class="btn primary" disabled={busy} onclick={handleResume}>Keep in sync</button>
        {:else}
          {#if info.connected && !info.viaCollection && !lockReason}
            <button type="button" class="btn" disabled={busy} onclick={() => (pickerOpen = true)}>Move to…</button>
          {/if}
          <button type="button" class="btn" disabled={busy} onclick={handleStop}>Stop syncing</button>
          {#if info.connected && !lockReason}
            <button
              type="button"
              class="btn danger"
              class:confirm={confirmRemove}
              disabled={busy}
              onclick={handleRemove}
              onblur={() => (confirmRemove = false)}
            >
              {confirmRemove ? `Delete from ${info.name} calendar? Card stays` : 'Remove from calendar'}
            </button>
          {/if}
        {/if}
      </div>
      {#if info.mode === 'sync'}
        <p class="consequence">
          <strong>Stop syncing</strong> keeps both copies, unlinked.
          {#if !lockReason}<strong>Remove</strong> deletes the entry from the {info.name} calendar; the card stays here.{/if}
        </p>
      {:else if info.mode === 'pending'}
        <p class="consequence">The {collection?.name ?? ''} collection adds its todos and dated cards to the {info.name} calendar.</p>
      {/if}
    {/if}
  </section>

  {#if pickerOpen}
    <CalendarPicker
      {kind}
      selectedId={info.url}
      onpick={handleMove}
      onclose={() => (pickerOpen = false)}
    />
  {/if}
{/if}

<style>
  .cal-section {
    max-width: 40rem;
    margin: 0.75rem 0 0.5rem;
    padding: 0.8rem 0.9rem 0.85rem;
    border: 1px solid var(--border);
    border-left: 3px solid var(--cal-color);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--cal-color) 5%, var(--surface));
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }

  .head {
    flex-wrap: wrap;
  }

  .state {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.6;
  }

  .status-dot.ok {
    background: #22a06b;
    opacity: 1;
  }

  .origin .part {
    white-space: nowrap;
  }

  @media (max-width: 600px) {
    .state {
      flex-basis: 100%;
      margin-left: 0;
    }
  }

  .consequence {
    margin: 0.15rem 0 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .consequence strong {
    font-weight: 600;
    color: var(--text);
  }




  .where {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    min-width: 0;
    overflow: hidden;
  }

  .swatch {
    color: var(--cal-color);
    flex-shrink: 0;
    align-self: center;
  }

  .cal-name {
    font-weight: 650;
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .acct {
    font-size: 0.78rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .acct::before {
    content: '· ';
  }

  .line {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text);
  }

  .line.muted {
    color: var(--text-muted);
  }


  .line.lock {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    color: var(--text-muted);
  }

  .line.lock svg {
    margin-top: 0.2rem;
    flex-shrink: 0;
  }

  .spinner {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .problem {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.6rem;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger-text);
    font-size: 0.8rem;
  }

  .link-btn {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    min-height: 32px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.35rem;
  }

  .btn {
    min-height: 36px;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 550;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .btn.danger {
    color: var(--danger-text);
  }

  .btn.danger.confirm {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }

  @media (max-width: 600px) {
    .btn {
      min-height: 44px;
      flex: 1 1 auto;
    }
  }
</style>
