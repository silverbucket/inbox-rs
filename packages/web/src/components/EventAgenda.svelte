<script lang="ts">
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import { todayStart } from '../lib/now';
  import { recurrenceLabel } from '../lib/calendar-sync';
  import { DRAG_MIME, draggingItemId } from '../lib/drag';
  import CalendarChip from './CalendarChip.svelte';

  /**
   * A collection's events as an agenda: one row per event, date first, in
   * time order. Events read as appointments, not as notes in a masonry
   * grid whose column flow scrambles the order.
   */
  let {
    events,
    onselect,
    viewing = null,
    past = false,
  }: {
    events: InboxItem[];
    onselect: (item: InboxItem) => void;
    viewing?: Collection | null;
    /** Ended events: muted, newest first. */
    past?: boolean;
  } = $props();

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  function dayParts(iso: string) {
    const d = new Date(iso);
    return {
      weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
      day: d.getDate(),
      month: d.toLocaleDateString(undefined, { month: 'short' }),
    };
  }

  // Local calendar days, not a 24-hour window (DST days aren't 24 hours).
  function isToday(iso: string, start: number) {
    return new Date(iso).toDateString() === new Date(start).toDateString();
  }

  // Rows file onto sidebar collections by drag, like the cards they replace.
  function onDragStart(e: DragEvent, item: InboxItem) {
    if (!e.dataTransfer) return;
    e.stopPropagation(); // see InboxCard: drop-zone parents cancel bubbling drags
    e.dataTransfer.setData(DRAG_MIME, item.id);
    e.dataTransfer.setData('text/plain', item.title || item.id);
    e.dataTransfer.effectAllowed = 'move';
    draggingItemId.set(item.id);
  }

  function onDragEnd() {
    draggingItemId.set(null);
  }

  /** Everything the row shows, for screen readers (the visuals are hidden). */
  function spokenLabel(item: InboxItem, today: boolean): string {
    const when = item.startsAt
      ? new Date(item.startsAt).toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      : '';
    return [
      `Open ${item.title || 'Untitled'}`,
      today ? 'today' : when,
      timeRange(item),
      item.location,
      item.cancelled ? 'cancelled' : '',
      item.calendarSync ? recurrenceLabel(item) : '',
    ]
      .filter(Boolean)
      .join(', ');
  }

  function timeRange(item: InboxItem): string {
    if (!item.startsAt) return '';
    if (item.allDay) {
      if (!item.endsAt) return 'All day';
      const end = new Date(item.endsAt);
      return `All day · until ${end.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
    }
    const start = timeFmt.format(new Date(item.startsAt));
    if (!item.endsAt) return start;
    const end = new Date(item.endsAt);
    const sameDay = new Date(item.startsAt).toDateString() === end.toDateString();
    return sameDay
      ? `${start} – ${timeFmt.format(end)}`
      : `${start} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  }
</script>

<ul class="agenda" class:past role="list">
  {#each events as item (item.id)}
    {@const parts = dayParts(item.startsAt ?? item.createdAt)}
    {@const today = !past && !!item.startsAt && isToday(item.startsAt, $todayStart)}
    <li>
      <button
        type="button"
        class="row"
        class:today
        class:cancelled={item.cancelled}
        aria-label={spokenLabel(item, today)}
        draggable="true"
        ondragstart={(e) => onDragStart(e, item)}
        ondragend={onDragEnd}
        onclick={() => onselect(item)}
      >
        <span class="date" aria-hidden="true">
          <span class="wd">{today ? 'Today' : parts.weekday}</span>
          <span class="dn">{parts.day}</span>
          <span class="mo">{parts.month}</span>
        </span>
        <span class="body">
          <span class="title">{item.title || 'Untitled'}</span>
          <span class="sub">
            {#if item.cancelled}<span class="cancel-tag">Cancelled</span>{/if}
            <span>{timeRange(item)}</span>
            {#if item.location}<span class="loc">· {item.location}</span>{/if}
            {#if item.calendarSync && recurrenceLabel(item)}
              <span class="repeat">
                <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                {recurrenceLabel(item)}
              </span>
            {/if}
          </span>
        </span>
        <span class="chip"><CalendarChip {item} context={viewing} /></span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .agenda {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .row {
    display: grid;
    grid-template-columns: 3.4rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    width: 100%;
    min-height: 56px;
    padding: 0.5rem 0.85rem 0.5rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 150ms, border-color 150ms;
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .date {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0.3rem 0;
    border-radius: 8px;
    background: var(--surface-tint);
    line-height: 1.05;
  }

  .wd,
  .mo {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .dn {
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin: 0.08rem 0;
  }

  .today .date {
    background: var(--accent);
  }

  .today .date .wd,
  .today .date .mo,
  .today .date .dn {
    color: white;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .title {
    font-weight: 600;
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    display: flex;
    gap: 0.3rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    min-width: 0;
    white-space: nowrap;
  }

  .loc {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .repeat {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: 0.25rem;
  }

  .cancelled .title {
    text-decoration: line-through;
    color: var(--text-muted);
  }

  .cancel-tag {
    color: var(--danger-text);
    font-weight: 600;
  }

  .chip {
    display: flex;
    justify-content: flex-end;
    min-width: 0;
  }

  .past .row {
    background: transparent;
  }

  .past .title,
  .past .dn {
    color: var(--text-muted);
  }
</style>
