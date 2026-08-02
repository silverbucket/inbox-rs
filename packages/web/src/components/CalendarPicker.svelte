<script lang="ts">
  import { trapFocus } from '../lib/actions';
  import {
    calendarAccounts,
    type CalendarChoice,
  } from '../lib/calendar-accounts';
  import type { ScheduleKind } from '../lib/schedule';

  let {
    kind,
    selectedId,
    onpick,
    onclose,
  }: {
    /** Entry kind being scheduled — task-incapable calendars are disabled. */
    kind: ScheduleKind;
    selectedId?: string;
    onpick: (choice: CalendarChoice) => void;
    onclose: () => void;
  } = $props();

  /** Accounts with their visible calendars — same hierarchy as the settings list. */
  const groups = $derived(
    $calendarAccounts
      .map((account) => ({
        account,
        calendars: account.calendars.filter(
          (c) => !account.hiddenCalendarIds?.includes(c.id),
        ),
      }))
      .filter((g) => g.calendars.length > 0),
  );

  function supports(components: Array<'event' | 'task'>): boolean {
    return components.includes(kind);
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    onclose();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="Choose calendar" onclick={onclose}>
  <div class="sheet" use:trapFocus onclick={(e) => e.stopPropagation()}>
    <h3 class="title">Choose calendar</h3>
    {#each groups as group (group.account.id)}
      <div class="grp">{group.account.label} · {group.account.username}</div>
      {#each group.calendars as cal (cal.id)}
        <button
          type="button"
          class="cal-row"
          class:sel={cal.id === selectedId}
          disabled={!supports(cal.components)}
          title={supports(cal.components)
            ? cal.name
            : `${cal.name} doesn't support ${kind}s`}
          onclick={() => onpick({ account: group.account, calendar: cal })}
        >
          <span class="dot" style="background: {cal.color || 'var(--accent)'}"></span>
          <span class="name">{cal.name}</span>
          <span class="tags">
            {#if cal.components.includes('task')}
              <span class="tag">tasks</span>
            {/if}
            {#if cal.id === group.account.defaultCalendarId}
              <span class="tag star" title="Default calendar">★</span>
            {/if}
          </span>
        </button>
      {/each}
    {:else}
      <p class="empty">
        No calendar accounts yet. Add one from the user menu → Calendar
        accounts, then events post straight to your calendar.
      </p>
    {/each}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    overflow-y: auto;
    overscroll-behavior: contain;
    z-index: 210;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .sheet {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.1rem;
    max-width: 360px;
    width: 100%;
    box-shadow: 0 12px 40px var(--shadow);
  }

  .title {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .grp {
    font-size: 0.64rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 650;
    margin: 0.7rem 0 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cal-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.45rem 0.45rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.15s;
  }

  .cal-row:hover:not(:disabled) {
    background: var(--accent-subtler);
  }

  .cal-row.sel {
    background: var(--accent-subtle);
    outline: 1.5px solid var(--accent);
    outline-offset: -1.5px;
  }

  .cal-row:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tags {
    display: inline-flex;
    gap: 0.35rem;
    flex-shrink: 0;
    align-items: center;
  }

  .tag {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.02rem 0.4rem;
    font-size: 0.62rem;
    color: var(--text-muted);
  }

  .tag.star {
    border: none;
    color: #eab308;
    padding: 0;
  }

  .empty {
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.5;
    padding: 0.5rem 0.25rem;
  }
</style>
