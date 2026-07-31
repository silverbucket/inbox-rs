<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { storeItem } from '../lib/stores';
  import { cleanForStorage } from '../lib/clean-for-storage';
  import { showToast } from '../lib/toast';
  import { downloadIcs } from '../lib/ics';
  import {
    applySchedule,
    clearSchedule,
    fromInputValues,
    nextRoundHour,
    quickOptions,
    toDateInputValue,
    toTimeInputValue,
    type ScheduleKind,
  } from '../lib/schedule';
  import {
    calendarAccounts,
    choiceForEventUrl,
    findCalendarChoice,
    pickPreferredCalendar,
    type CalendarChoice,
  } from '../lib/calendar-accounts';
  import {
    postScheduledItem,
    recordCalendarUse,
    removePostedEntry,
  } from '../lib/schedule-sync';
  import { CaldavError } from '../lib/caldav';
  import CalendarPicker from './CalendarPicker.svelte';

  let {
    item,
    onclose,
  }: {
    item: InboxItem;
    /** Called after any successful action, and on plain dismissal. */
    onclose: () => void;
  } = $props();

  const isTodoish = item.isTodo || item.type === 'todo';

  // ── Editable state, seeded from the item's current schedule ────────────
  // (or from the prefilled guess: next round hour, 1 h, event/task by card
  // kind — the fastest path is glance → confirm.)
  const initialStart = item.startsAt ? new Date(item.startsAt) : nextRoundHour();
  const initialDuration =
    item.startsAt && item.endsAt
      ? Math.max(
          1,
          Math.round(
            (new Date(item.endsAt).getTime() -
              new Date(item.startsAt).getTime()) /
              60_000,
          ),
        )
      : 60;

  let kind = $state<ScheduleKind>(
    item.scheduleKind ?? (isTodoish ? 'task' : 'event'),
  );
  let dateStr = $state(toDateInputValue(initialStart));
  let timeStr = $state(
    item.allDay ? '' : toTimeInputValue(initialStart),
  );
  let allDay = $state(!!item.allDay);
  let durationMin = $state(initialDuration);
  let saving = $state(false);

  // ── Destination calendar ───────────────────────────────────────────────
  // Already-posted entries open on their current home (even if hidden);
  // otherwise last-used-per-kind → account default → first suitable.
  const eventHome = choiceForEventUrl(item.eventUrl);
  let selectedCalendarId = $state<string | undefined>(
    eventHome?.calendar.id ??
      pickPreferredCalendar(item.scheduleKind ?? (isTodoish ? 'task' : 'event'))
        ?.calendar.id,
  );
  /** Once the user picks by hand, kind switches stop re-deriving the target. */
  let calendarTouched = $state(false);
  let showCalendarPicker = $state(false);

  const hasAccounts = $derived($calendarAccounts.length > 0);
  const selectedChoice = $derived<CalendarChoice | undefined>(
    findCalendarChoice(selectedCalendarId) ??
      (eventHome?.calendar.id === selectedCalendarId ? eventHome : undefined),
  );
  const calendarSupportsKind = $derived(
    !!selectedChoice?.calendar.components.includes(kind),
  );
  const willPost = $derived(hasAccounts && !!selectedChoice && calendarSupportsKind);

  function setKind(next: ScheduleKind) {
    kind = next;
    if (!calendarTouched && !item.eventUrl) {
      selectedCalendarId = pickPreferredCalendar(next)?.calendar.id;
    }
  }

  function handleCalendarPick(choice: CalendarChoice) {
    selectedCalendarId = choice.calendar.id;
    calendarTouched = true;
    showCalendarPicker = false;
  }

  const DURATIONS = [
    { label: '30 m', min: 30 },
    { label: '1 h', min: 60 },
    { label: '2 h', min: 120 },
  ];

  const quick = quickOptions();

  const start = $derived(fromInputValues(dateStr, allDay ? '' : timeStr));
  // Tasks may be date-only ("sometime that day") — that's all-day semantics.
  const effectiveAllDay = $derived(allDay || (kind === 'task' && !timeStr));
  const canSave = $derived(!!start && !saving);

  /** Quick chips highlight when they match the current selection exactly. */
  function isQuickSelected(optStart: Date): boolean {
    if (allDay || !start) return false;
    return start.getTime() === optStart.getTime();
  }

  function pickQuick(optStart: Date) {
    allDay = false;
    dateStr = toDateInputValue(optStart);
    timeStr = toTimeInputValue(optStart);
  }

  function scheduledItem(): InboxItem | null {
    if (!start) return null;
    return applySchedule(item, {
      kind,
      start,
      durationMin,
      allDay: effectiveAllDay,
    });
  }

  async function persist(updated: InboxItem, failMessage: string): Promise<boolean> {
    saving = true;
    try {
      await storeItem(cleanForStorage(updated));
      return true;
    } catch (err) {
      console.error(failMessage, err);
      showToast(failMessage);
      return false;
    } finally {
      saving = false;
    }
  }

  /**
   * Save locally, then post to the chosen calendar when one is selected.
   * Local-first: a failed post never loses the schedule — the card keeps it
   * and a toast explains; pressing the button again retries.
   */
  async function save() {
    const updated = scheduledItem();
    if (!updated) return;
    if (!(await persist(updated, 'Failed to save schedule'))) return;
    if (willPost && selectedChoice) {
      saving = true;
      try {
        const posted = await postScheduledItem(
          updated,
          selectedChoice.calendar.id,
        );
        await storeItem(cleanForStorage(posted));
        recordCalendarUse(kind, selectedChoice.calendar.id);
      } catch (err) {
        console.error('Calendar post failed', err);
        const reason =
          err instanceof CaldavError ? err.message : 'the calendar relay is unreachable';
        showToast(`Saved locally — ${reason}`);
      } finally {
        saving = false;
      }
    }
    onclose();
  }

  /** Save (so chips reflect the schedule) and hand the user the .ics. */
  async function saveAndDownload() {
    const updated = scheduledItem();
    if (!updated) return;
    if (await persist(updated, 'Failed to save schedule')) {
      downloadIcs(updated);
      onclose();
    }
  }

  /**
   * Removing the schedule also removes the posted calendar entry. If the
   * server refuses (and the entry may still exist), keep the schedule so
   * the card and calendar don't silently diverge.
   */
  async function remove() {
    if (item.eventUrl) {
      saving = true;
      try {
        await removePostedEntry(item);
      } catch (err) {
        console.error('Calendar delete failed', err);
        const reason =
          err instanceof CaldavError ? err.message : 'the calendar relay is unreachable';
        showToast(`Still on your calendar — ${reason}`);
        saving = false;
        return;
      }
      saving = false;
    }
    if (await persist(clearSchedule(item), 'Failed to remove schedule')) {
      onclose();
    }
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || saving) return;
    // The calendar picker layers on top and closes itself first.
    if (showCalendarPicker) return;
    onclose();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="Schedule" onclick={() => { if (!saving) onclose(); }}>
  <div class="sheet" onclick={(e) => e.stopPropagation()}>
    <h3 class="title">{item.startsAt ? 'Scheduled' : 'Add to calendar'}</h3>
    <p class="ctx">{item.title || 'Untitled'}</p>

    <div class="seg" role="radiogroup" aria-label="Entry kind">
      <button
        type="button"
        class="seg-btn"
        class:on={kind === 'event'}
        role="radio"
        aria-checked={kind === 'event'}
        onclick={() => setKind('event')}
      >
        Event
      </button>
      <button
        type="button"
        class="seg-btn"
        class:on={kind === 'task'}
        role="radio"
        aria-checked={kind === 'task'}
        onclick={() => setKind('task')}
      >
        Task
      </button>
    </div>

    {#if quick.length > 0}
      <div class="chips">
        {#each quick as opt (opt.label)}
          <button
            type="button"
            class="chip"
            class:sel={isQuickSelected(opt.start)}
            onclick={() => pickQuick(opt.start)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
    {/if}

    <span class="flabel" id="sched-when">{kind === 'task' ? 'Due' : 'Date & time'}</span>
    <div class="inputrow" aria-labelledby="sched-when">
      <input type="date" class="input" bind:value={dateStr} />
      {#if !allDay}
        <input
          type="time"
          class="input time"
          bind:value={timeStr}
          placeholder={kind === 'task' ? 'time?' : undefined}
        />
      {/if}
    </div>

    {#if kind === 'event'}
      <span class="flabel">Duration</span>
      <div class="chips">
        {#each DURATIONS as d (d.min)}
          <button
            type="button"
            class="chip"
            class:sel={!allDay && durationMin === d.min}
            disabled={allDay}
            onclick={() => {
              allDay = false;
              durationMin = d.min;
            }}
          >
            {d.label}
          </button>
        {/each}
        <button
          type="button"
          class="chip"
          class:sel={allDay}
          onclick={() => (allDay = !allDay)}
        >
          All-day
        </button>
      </div>
    {:else}
      <label class="allday-row">
        <input type="checkbox" bind:checked={allDay} />
        No specific time — due sometime that day
      </label>
    {/if}

    {#if hasAccounts}
      <button
        type="button"
        class="zone"
        onclick={() => (showCalendarPicker = true)}
      >
        {#if selectedChoice}
          <span
            class="dot"
            style="background: {selectedChoice.calendar.color || 'var(--accent)'}"
          ></span>
          <span class="zone-name">{selectedChoice.calendar.name}</span>
          <span class="zone-sub">· {selectedChoice.account.label}</span>
        {:else}
          <span class="zone-name muted">Choose calendar…</span>
        {/if}
        <svg class="chev" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      {#if selectedChoice && !calendarSupportsKind}
        <p class="zone-warn">
          {selectedChoice.calendar.name} doesn't support {kind}s — the
          schedule stays on the card only.
        </p>
      {/if}
    {/if}

    <button type="button" class="btn-primary" disabled={!canSave} onclick={save}>
      {#if willPost}
        {item.eventUrl ? 'Update event' : kind === 'task' ? 'Add task' : 'Add to calendar'}
      {:else}
        {item.startsAt ? 'Update schedule' : 'Schedule'}
      {/if}
    </button>
    <button type="button" class="btn-ghost" disabled={!canSave} onclick={saveAndDownload}>
      Save &amp; download .ics
    </button>
    {#if item.startsAt}
      <button type="button" class="btn-remove" disabled={saving} onclick={remove}>
        {item.eventUrl ? 'Remove from calendar' : 'Remove schedule'}
      </button>
    {/if}
  </div>
</div>

{#if showCalendarPicker}
  <CalendarPicker
    {kind}
    selectedId={selectedCalendarId}
    onpick={handleCalendarPick}
    onclose={() => (showCalendarPicker = false)}
  />
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    overflow-y: auto;
    overscroll-behavior: contain;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .sheet {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    max-width: 380px;
    width: 100%;
    box-shadow: 0 12px 40px var(--shadow);
  }

  .title {
    font-size: 1rem;
    font-weight: 600;
  }

  .ctx {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin-bottom: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Event / Task segmented control */
  .seg {
    display: flex;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 3px;
    margin-bottom: 0.85rem;
  }

  .seg-btn {
    flex: 1;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    font-family: inherit;
    padding: 0.32rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .seg-btn.on {
    background: var(--accent);
    color: white;
    font-weight: 600;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chip {
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    border-radius: 999px;
    padding: 0.28rem 0.7rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .chip.sel {
    border-color: var(--accent);
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .chip:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .flabel {
    display: block;
    font-size: 0.68rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 550;
    margin: 0.85rem 0 0.35rem;
  }

  .inputrow {
    display: flex;
    gap: 0.45rem;
  }

  .input {
    flex: 1;
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.42rem 0.55rem;
    /* ≥1rem: form controls below 1rem trigger iOS Safari focus-zoom
       (see AGENTS.md → "Form controls: never below 1rem"). */
    font-size: 1rem;
    font-family: inherit;
    color: var(--text);
    color-scheme: dark light;
  }

  .input.time {
    flex: 0.6;
  }

  .input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .allday-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.7rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    cursor: pointer;
  }

  .allday-row input {
    accent-color: var(--accent);
  }

  /* Destination calendar zone — the location-chip idiom from filing. */
  .zone {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    margin-top: 0.85rem;
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    font-family: inherit;
    font-size: 0.82rem;
    color: var(--text);
    cursor: pointer;
    transition: border-color 0.15s;
    text-align: left;
  }

  .zone:hover {
    border-color: var(--accent);
  }

  .zone .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .zone-name {
    font-weight: 550;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .zone-name.muted {
    color: var(--text-muted);
    font-weight: 400;
  }

  .zone-sub {
    font-size: 0.7rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .zone .chev {
    margin-left: auto;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .zone-warn {
    margin-top: 0.4rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .btn-primary {
    display: block;
    width: 100%;
    margin-top: 1rem;
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.55rem;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-ghost,
  .btn-remove {
    display: block;
    width: 100%;
    margin-top: 0.35rem;
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.4rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .btn-ghost:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-hover);
  }

  .btn-remove {
    color: var(--danger);
  }

  .btn-remove:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  .btn-ghost:disabled,
  .btn-remove:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
