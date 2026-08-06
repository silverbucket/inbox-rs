<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { trapFocus } from '../lib/actions';
  import { cleanForStorage } from '../lib/clean-for-storage';
  import {
    applySchedule,
    clearSchedule,
    fromInputValues,
    nextRoundHour,
    type PendingSchedule,
    quickOptions,
    type ScheduleKind,
    toDateInputValue,
    toTimeInputValue,
  } from '../lib/schedule';
  import { showToast } from '../lib/toast';
  import { storeItem } from '../lib/stores';

  /**
   * The time sheet — deliberately calendar-free. Setting a time is card
   * metadata (due dates, "this happens Friday"); adding the card to a
   * calendar is a separate action (AddToCalendarSheet). The one link back:
   * when the card is already ON a calendar, saving a time change silently
   * updates the posted entry so the projection never drifts.
   */
  let {
    item,
    subject,
    initial = null,
    onpick,
    onclose,
  }: {
    /** Persist mode: edit the time on an existing item. */
    item?: InboxItem;
    /** Pick mode context for a not-yet-created item (capture-time chips). */
    subject?: { title?: string; isTodo?: boolean };
    /** Pick mode: the previously chosen pending schedule, for re-editing. */
    initial?: PendingSchedule | null;
    /**
     * Pick mode: return the choice instead of persisting — the caller
     * applies it once the item exists (null = clear the pending schedule).
     */
    onpick?: (schedule: PendingSchedule | null) => void;
    /** Called after any successful action, and on plain dismissal. */
    onclose: () => void;
  } = $props();

  const pickMode = !!onpick;
  const displayTitle = item?.title ?? subject?.title ?? '';
  const isTodoish = item
    ? item.isTodo || item.type === 'todo'
    : !!subject?.isTodo;

  // ── Editable state, seeded from the item's current schedule (persist
  // mode), the previously picked pending schedule (pick mode), or the
  // prefilled guess: next round hour, 1 h, event/task by card kind — the
  // fastest path is glance → confirm.
  const initialStart = item?.startsAt
    ? new Date(item.startsAt)
    : (initial?.start ?? nextRoundHour());
  const initialDuration =
    item?.startsAt && item.endsAt
      ? Math.max(
          1,
          Math.round(
            (new Date(item.endsAt).getTime() -
              new Date(item.startsAt).getTime()) /
              60_000,
          ),
        )
      : (initial?.durationMin ?? 60);
  const initialAllDay = item ? !!item.allDay : !!initial?.allDay;
  /** Whether a time is already set — drives titles and the remove action. */
  const hasExisting = item ? !!item.startsAt : !!initial;

  let kind = $state<ScheduleKind>(
    item?.scheduleKind ?? initial?.kind ?? (isTodoish ? 'task' : 'event'),
  );
  let dateStr = $state(toDateInputValue(initialStart));
  let timeStr = $state(initialAllDay ? '' : toTimeInputValue(initialStart));
  let allDay = $state(initialAllDay);
  let durationMin = $state(initialDuration);
  let saving = $state(false);

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
    if (!item || !start) return null;
    return applySchedule(item, {
      kind,
      start,
      durationMin,
      allDay: effectiveAllDay,
    });
  }

  async function persist(
    updated: InboxItem,
    failMessage: string,
  ): Promise<boolean> {
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
   * Save the time — local-only, always. Publishing is one-shot: a posted
   * calendar entry is a frozen snapshot, so a time edit changes the card
   * but never the calendar. The toast says so, once, so the drift isn't
   * mysterious in the other direction.
   */
  async function save() {
    if (pickMode) {
      if (!start) return;
      onpick?.({ kind, start, durationMin, allDay: effectiveAllDay });
      return;
    }
    const updated = scheduledItem();
    if (!updated) return;
    if (!(await persist(updated, 'Failed to save time'))) return;
    if (updated.eventUrl) {
      showToast('Time saved — the calendar entry keeps its original time');
    }
    onclose();
  }

  /**
   * Removing the time also drops the calendar receipt, locally: without its
   * time the card no longer matches what was posted, so it stops claiming
   * to be on a calendar (and un-archives). The calendar keeps its entry —
   * inbox-rs never deletes there. clearSchedule clears the receipt fields
   * along with the time.
   */
  async function remove() {
    if (pickMode) {
      onpick?.(null);
      return;
    }
    if (!item) return;
    const wasPosted = !!item.eventUrl;
    if (await persist(clearSchedule(item), 'Failed to remove time')) {
      if (wasPosted) {
        showToast('Time removed — the calendar entry stays put');
      }
      onclose();
    }
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || saving) return;
    onclose();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="Schedule" onclick={() => { if (!saving) onclose(); }}>
  <div class="sheet" use:trapFocus onclick={(e) => e.stopPropagation()}>
    <h3 class="title">
      {pickMode ? 'When?' : hasExisting ? 'Edit time' : 'Set time'}
    </h3>
    <p class="ctx">{displayTitle || 'Untitled'}</p>

    <div class="seg" role="radiogroup" aria-label="Entry kind">
      <button
        type="button"
        class="seg-btn"
        class:on={kind === 'event'}
        role="radio"
        aria-checked={kind === 'event'}
        onclick={() => (kind = 'event')}
      >
        Event
      </button>
      <button
        type="button"
        class="seg-btn"
        class:on={kind === 'task'}
        role="radio"
        aria-checked={kind === 'task'}
        onclick={() => (kind = 'task')}
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

    <span class="flabel">{kind === 'task' ? 'Due' : 'Date & time'}</span>
    <div class="inputrow">
      <input
        type="date"
        class="input"
        bind:value={dateStr}
        aria-label={kind === 'task' ? 'Due date' : 'Date'}
      />
      {#if !allDay}
        <input
          type="time"
          class="input time"
          bind:value={timeStr}
          aria-label={kind === 'task' ? 'Due time (optional)' : 'Time'}
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

    <button type="button" class="btn-primary" disabled={!canSave} onclick={save}>
      {pickMode ? 'Set time' : hasExisting ? 'Update time' : 'Set time'}
    </button>
    {#if hasExisting}
      <button type="button" class="btn-remove" disabled={saving} onclick={remove}>
        {pickMode
          ? 'Clear time'
          : item?.eventUrl
            ? 'Remove time & calendar entry'
            : 'Remove time'}
      </button>
    {/if}
  </div>
</div>

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

  .btn-remove {
    display: block;
    width: 100%;
    margin-top: 0.35rem;
    background: none;
    border: none;
    color: var(--danger);
    padding: 0.4rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .btn-remove:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  .btn-remove:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
