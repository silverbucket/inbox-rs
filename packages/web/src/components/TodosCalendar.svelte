<script lang="ts">
  /**
   * Calendar view of the Todos plan.
   *
   * Dated todos sit on their day. Soft plans have no day, so they show as
   * bands across the week (or above the month) they were planned for. Up
   * next, Someday and "Not planned yet" live in the side panel; dragging any
   * todo onto a day gives it that date (an all-day task unless it already
   * had a time, which it keeps).
   */
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import { todayStart } from '../lib/now';
  import {
    fromDateKey,
    monthGrid,
    monthStart,
    moveToDay,
    type Placement,
    scheduledDayKey,
    sectionInfo,
    shiftMonth,
    toDateKey,
    weekStart,
  } from '../lib/plan';
  import { applySchedule } from '../lib/schedule';
  import { storeItem } from '../lib/stores';
  import { showToast } from '../lib/toast';

  let {
    todos,
    placements,
    overdueCount,
    lookupCollection,
    onselect,
    onreview,
  }: {
    /** Open todos in view (due band included). */
    todos: InboxItem[];
    placements: Map<string, Placement>;
    overdueCount: number;
    lookupCollection: (id: string | undefined) => Collection | null;
    onselect: (item: InboxItem) => void;
    onreview: () => void;
  } = $props();

  const today = $derived(new Date($todayStart));
  const todayKey = $derived(toDateKey(today));
  let viewMonth = $state(monthStart(new Date()));
  const weeks = $derived(monthGrid(viewMonth));
  const monthTitle = $derived(
    viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );
  const monthName = $derived(viewMonth.toLocaleDateString(undefined, { month: 'long' }));
  const weekdayNames = $derived(
    weeks[0]?.map((d) => d.toLocaleDateString(undefined, { weekday: 'short' })) ?? [],
  );

  /** Dated todos by local day. */
  const byDay = $derived.by(() => {
    const map = new Map<string, InboxItem[]>();
    for (const t of todos) {
      const key = scheduledDayKey(t);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
    }
    return map;
  });

  /** Undated week plans by their Monday. Rolled-over ones live in Up next. */
  const byWeek = $derived.by(() => {
    const map = new Map<string, InboxItem[]>();
    for (const t of todos) {
      if (t.startsAt || t.planKind !== 'week' || !t.planStart) continue;
      if (placements.get(t.id)?.rolledFrom) continue;
      const list = map.get(t.planStart) ?? [];
      list.push(t);
      map.set(t.planStart, list);
    }
    return map;
  });

  /** Undated month plans for the month on screen. */
  const monthPlans = $derived(
    todos.filter(
      (t) =>
        !t.startsAt &&
        t.planKind === 'month' &&
        t.planStart === toDateKey(viewMonth) &&
        !placements.get(t.id)?.rolledFrom,
    ),
  );

  /** Grid rows with everything the template needs, precomputed. */
  const rows = $derived(
    weeks.map((days) => {
      const wkKey = toDateKey(weekStart(days[0]));
      return {
        key: wkKey,
        weekLabel:
          fromDateKey(wkKey)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) ?? '',
        planned: byWeek.get(wkKey) ?? [],
        days: days.map((day) => {
          const key = toDateKey(day);
          const items = byDay.get(key) ?? [];
          return {
            key,
            n: day.getDate(),
            day,
            items,
            other: day.getMonth() !== viewMonth.getMonth(),
            label: `${dayTitle(day)}${items.length ? `, ${items.length} todos` : ''}`,
          };
        }),
      };
    }),
  );

  const side = $derived.by(() => {
    const pick = (section: string) =>
      todos.filter((t) => !t.startsAt && placements.get(t.id)?.section === section);
    return { next: pick('next'), someday: pick('someday'), unplanned: pick('unplanned') };
  });

  let openTray = $state<'someday' | 'unplanned' | null>(null);

  function dayTitle(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function previewNames(list: InboxItem[]): string {
    const names = list.slice(0, 3).map((t) => t.title);
    return list.length > 3 ? `${names.join(', ')} +${list.length - 3}` : names.join(', ');
  }

  // ── Drag a todo onto a day ────────────────────────────────────────────
  const DRAG_TYPE = 'application/x-inbox-rs-todo';
  let dragOverKey = $state<string | null>(null);

  function startDrag(e: DragEvent, todo: InboxItem) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(DRAG_TYPE, todo.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function allowDrop(e: DragEvent, key: string) {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverKey = key;
  }

  async function dropOn(e: DragEvent, day: Date) {
    dragOverKey = null;
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    try {
      await storeItem(applySchedule(todo, moveToDay(todo, day)));
    } catch (error) {
      console.error('Failed to move todo to day', error);
      showToast('Couldn’t move that todo');
    }
  }

</script>

{#snippet chip(t: InboxItem)}
  <button
    type="button"
    class="chip"
    draggable="true"
    title={t.title}
    ondragstart={(e) => startDrag(e, t)}
    onclick={() => onselect(t)}
  >
    <span class="dot" style="background: {lookupCollection(t.collectionId)?.color || 'var(--text-muted)'}"></span>
    <span class="chip-text">{t.title}</span>
  </button>
{/snippet}

{#snippet sideItem(t: InboxItem)}
  <li>
    <button
      type="button"
      class="side-item"
      draggable="true"
      ondragstart={(e) => startDrag(e, t)}
      onclick={() => onselect(t)}
    >
      <span class="dot" style="background: {lookupCollection(t.collectionId)?.color || 'var(--text-muted)'}"></span>
      <span class="chip-text">{t.title}</span>
      {#if placements.get(t.id)?.rolledFrom}<span class="rolled">{placements.get(t.id)?.rolledFrom}</span>{/if}
    </button>
  </li>
{/snippet}

<div class="cal-layout">
  <section class="cal" aria-labelledby="cal-title">
    <div class="cal-head">
      <h2 class="cal-title" id="cal-title">{monthTitle}</h2>
      <div class="cal-nav">
        <button type="button" class="nav-btn" aria-label="Previous month" onclick={() => (viewMonth = shiftMonth(viewMonth, -1))}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 6l-6 6 6 6"></path></svg>
        </button>
        <button type="button" class="nav-btn today-btn" onclick={() => (viewMonth = monthStart(today))}>Today</button>
        <button type="button" class="nav-btn" aria-label="Next month" onclick={() => (viewMonth = shiftMonth(viewMonth, 1))}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"></path></svg>
        </button>
      </div>
    </div>

    {#if monthPlans.length > 0}
      <div class="band month-band" style="--h: var(--horizon-month)">
        <span class="swatch"></span>
        <strong>Planned for {monthName}</strong>
        <span class="band-peek">{previewNames(monthPlans)}</span>
        <span class="band-count">{monthPlans.length}</span>
      </div>
    {/if}

    <div class="grid-scroll">
      <div class="grid" role="grid" aria-labelledby="cal-title">
        <div class="row dow" role="row">
          {#each weekdayNames as name, i (i)}
            <div class="dow-cell" role="columnheader">{name}</div>
          {/each}
        </div>
        {#each rows as row (row.key)}
          {#if row.planned.length > 0}
            <div class="band week-band" style="--h: var(--horizon-week)">
              <span class="swatch"></span>
              <strong>Week of {row.weekLabel}</strong>
              <span class="band-peek">{previewNames(row.planned)}</span>
              <span class="band-count">{row.planned.length}</span>
            </div>
          {/if}
          <div class="row" role="row">
            {#each row.days as cell (cell.key)}
              <div
                class="cell"
                class:other={cell.other}
                class:is-today={cell.key === todayKey}
                class:past={cell.key < todayKey}
                class:drop={dragOverKey === cell.key}
                role="gridcell"
                aria-label={cell.label}
                ondragover={(e) => allowDrop(e, cell.key)}
                ondragleave={() => { if (dragOverKey === cell.key) dragOverKey = null; }}
                ondrop={(e) => dropOn(e, cell.day)}
              >
                <span class="num">{cell.n}</span>
                {#each cell.items.slice(0, 3) as t (t.id)}
                  {@render chip(t)}
                {/each}
                {#if cell.items.length > 3}
                  <span class="more">+{cell.items.length - 3} more</span>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
    <p class="hint">Drag a todo onto a day to give it that date. Open a todo and choose When? to plan it without one.</p>
  </section>

  <aside class="side" aria-label="Todos without a date">
    {#if overdueCount > 0}
      <button type="button" class="overdue" onclick={onreview}>
        <span class="swatch" style="--h: var(--horizon-due)"></span>
        <span class="overdue-text">{overdueCount} overdue</span>
        <span class="overdue-cta">Review</span>
      </button>
    {/if}

    <section class="side-group" style="--h: var(--horizon-next)" aria-labelledby="side-next">
      <h3 class="side-title" id="side-next"><span class="swatch"></span>{sectionInfo('next', today).label}<span class="side-count">{side.next.length}</span></h3>
      {#if side.next.length > 0}
        <ul class="side-list" role="list">
          {#each side.next as t (t.id)}
            {@render sideItem(t)}
          {/each}
        </ul>
      {:else}
        <p class="side-empty">Nothing lined up.</p>
      {/if}
    </section>

    {#each [{ key: 'unplanned', label: 'Not planned yet', list: side.unplanned }, { key: 'someday', label: 'Someday', list: side.someday }] as tray (tray.key)}
      {#if tray.list.length > 0}
        <section class="side-group tray" style="--h: var(--horizon-{tray.key})">
          <button
            type="button"
            class="tray-toggle"
            aria-expanded={openTray === tray.key}
            onclick={() => (openTray = openTray === tray.key ? null : (tray.key as 'someday' | 'unplanned'))}
          >
            <span class="swatch"></span>{tray.label}<span class="side-count">{tray.list.length}</span>
          </button>
          {#if openTray === tray.key}
            <ul class="side-list" role="list">
              {#each tray.list as t (t.id)}
                {@render sideItem(t)}
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    {/each}
  </aside>
</div>

<style>
  .cal-layout {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
  }

  .cal {
    flex: 999 1 560px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .cal-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .cal-title {
    flex: 1;
    margin: 0;
    font-size: 1.05rem;
  }

  .cal-nav {
    display: flex;
    gap: 0.25rem;
  }

  .nav-btn {
    display: grid;
    place-items: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .nav-btn:hover {
    background: var(--surface-hover);
  }

  .grid-scroll {
    overflow-x: auto;
  }

  .grid {
    min-width: 640px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    border-bottom: 1px solid var(--border);
  }

  .row:last-child {
    border-bottom: none;
  }

  .dow-cell {
    padding: 0.4rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-muted);
  }

  .cell {
    min-height: 5.5rem;
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    border-right: 1px solid var(--border);
    min-width: 0;
  }

  .cell:last-child {
    border-right: none;
  }

  .cell.other {
    background: var(--surface-tint);
  }

  .cell.is-today {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }

  .cell.drop {
    outline: 2px dashed var(--accent);
    outline-offset: -3px;
  }

  .num {
    align-self: flex-start;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text);
  }

  .cell.other .num,
  .cell.past .num {
    color: var(--text-muted);
  }

  .cell.is-today .num {
    background: var(--text);
    color: var(--bg);
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
    padding: 0.15rem 0.35rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.72rem;
    text-align: left;
    cursor: grab;
    min-width: 0;
  }

  .chip:hover {
    background: var(--surface-hover);
  }

  .chip-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 999px;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .more {
    font-size: 0.7rem;
    color: var(--text-muted);
    padding-left: 0.3rem;
  }

  .band {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.6rem;
    font-size: 0.75rem;
    color: color-mix(in srgb, var(--h) 55%, var(--text));
    background: color-mix(in srgb, var(--h) 14%, var(--surface));
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }

  .month-band {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .swatch {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 2px;
    background: var(--h);
    flex-shrink: 0;
  }

  .band-peek {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
  }

  .band-count {
    font-weight: 700;
  }

  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .side {
    flex: 1 1 260px;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .overdue {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0 0.75rem;
    border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--warn-text);
    font: inherit;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
  }

  .overdue-text {
    flex: 1;
  }

  .overdue-cta {
    font-size: 0.8rem;
  }

  .side-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.55rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--h) 12%, var(--surface));
  }

  .side-title,
  .tray-toggle {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    font-size: 0.82rem;
    font-weight: 700;
    color: color-mix(in srgb, var(--h) 55%, var(--text));
  }

  .tray-toggle {
    width: 100%;
    min-height: 2rem;
    border: none;
    background: none;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  .side-count {
    margin-left: auto;
  }

  .side-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .side-item {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    min-height: 2.25rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.82rem;
    text-align: left;
    cursor: grab;
  }

  .side-item:hover {
    background: var(--surface-hover);
  }

  .rolled {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--warn-text);
    white-space: nowrap;
  }

  .side-empty {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  @media (max-width: 768px) {
    .side {
      max-width: none;
    }
  }
</style>
