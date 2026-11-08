<script lang="ts">
  /**
   * Today view of the Todos plan — the default on phones.
   *
   * A strip of this week's days (dots mark days with something dated), one
   * banner for anything overdue or rolled over, then what matters now: due
   * today, Up next, and the rest of the picked day or week.
   */
  import type { Collection, CollectionGroup, InboxItem } from '@inbox-rs/rs-module';
  import { todayStart } from '../lib/now';
  import { type Placement, scheduledDayKey, toDateKey, weekStart } from '../lib/plan';
  import { compareByDueTime } from '../lib/schedule';
  import TodoRow from './TodoRow.svelte';

  let {
    todos,
    placements,
    overdueCount,
    rolledCount,
    lookupCollection,
    lookupGroup,
    onselect,
    onaddincollection,
    onreview,
    onshowplan,
  }: {
    /** Open todos in view (due band included). */
    todos: InboxItem[];
    placements: Map<string, Placement>;
    overdueCount: number;
    rolledCount: number;
    lookupCollection: (id: string | undefined) => Collection | null;
    lookupGroup: (collectionId: string | undefined) => CollectionGroup | null;
    onselect: (item: InboxItem) => void;
    onaddincollection: (collectionId: string | null) => void;
    onreview: () => void;
    /** Switch to the full Horizon view. */
    onshowplan: () => void;
  } = $props();

  const UP_NEXT_LIMIT = 5;

  const today = $derived(new Date($todayStart));
  const todayKey = $derived(toDateKey(today));
  const week = $derived.by(() => {
    const start = weekStart(today);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  });

  let pickedKey = $state<string | null>(null);
  // A pick from an earlier week (the strip moved on at midnight) falls back
  // to today instead of pointing at a day that's no longer on screen.
  const selectedKey = $derived(
    pickedKey && week.some((d) => toDateKey(d) === pickedKey) ? pickedKey : todayKey,
  );

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
      list.sort(compareByDueTime);
    }
    return map;
  });

  /** The week strip, precomputed for the template. */
  const days = $derived(
    week.map((d) => {
      const key = toDateKey(d);
      const count = byDay.get(key)?.length ?? 0;
      return {
        key,
        n: d.getDate(),
        dow: d.toLocaleDateString(undefined, { weekday: 'short' }),
        label: `${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${count ? `, ${count} dated` : ''}`,
        title: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
        count,
      };
    }),
  );
  const pickedTitle = $derived(days.find((d) => d.key === selectedKey)?.title ?? '');
  const slippedText = $derived(
    [overdueCount ? `${overdueCount} overdue` : '', rolledCount ? `${rolledCount} rolled over` : '']
      .filter(Boolean)
      .join(' · '),
  );

  const dueToday = $derived(byDay.get(todayKey) ?? []);
  const upNext = $derived(
    todos.filter((t) => !t.startsAt && placements.get(t.id)?.section === 'next'),
  );
  const pickedDay = $derived(selectedKey === todayKey ? [] : (byDay.get(selectedKey) ?? []));
  /** The rest of this week: dated later this week, plus "this week" plans. */
  const laterThisWeek = $derived(
    todos.filter((t) => {
      if (placements.get(t.id)?.section !== 'week') return false;
      const key = scheduledDayKey(t);
      // The picked day is already listed above; don't show it twice.
      return !key || (key > todayKey && key !== selectedKey);
    }),
  );

  const slipped = $derived(overdueCount + rolledCount);

</script>

{#snippet list(items: InboxItem[])}
  <ul class="list" role="list">
    {#each items as todo (todo.id)}
      <TodoRow
        {todo}
        collection={lookupCollection(todo.collectionId)}
        group={lookupGroup(todo.collectionId)}
        planTag={placements.get(todo.id)?.rolledFrom}
        {onselect}
        onaddincollection={onaddincollection}
      />
    {/each}
  </ul>
{/snippet}

<div class="today">
  <div class="week" role="group" aria-label="This week">
    {#each days as d (d.key)}
      <button
        type="button"
        class="day"
        class:is-today={d.key === todayKey}
        class:past={d.key < todayKey}
        aria-pressed={d.key === selectedKey}
        aria-label={d.label}
        onclick={() => (pickedKey = d.key === todayKey ? null : d.key)}
      >
        <span class="dow">{d.dow}</span>
        <span class="n">{d.n}</span>
        <span class="mark" class:on={d.count > 0}></span>
      </button>
    {/each}
  </div>

  {#if slipped > 0}
    <button type="button" class="slipped" onclick={onreview}>
      <span class="swatch"></span>
      <span class="slipped-text">{slippedText}</span>
      <span class="cta">Review</span>
    </button>
  {/if}

  {#if pickedDay.length > 0 || selectedKey !== todayKey}
    <section class="group" style="--h: var(--horizon-week)" aria-labelledby="today-picked">
      <h2 class="label" id="today-picked"><span class="swatch"></span>{pickedTitle}<span class="count">{pickedDay.length}</span></h2>
      {#if pickedDay.length > 0}
        {@render list(pickedDay)}
      {:else}
        <p class="empty">Nothing dated that day.</p>
      {/if}
    </section>
  {/if}

  <section class="group" style="--h: var(--horizon-due)" aria-labelledby="today-due">
    <h2 class="label" id="today-due"><span class="swatch"></span>Due today{#if dueToday.length}<span class="count">{dueToday.length}</span>{:else}<span class="empty-inline">Nothing due</span>{/if}</h2>
    {#if dueToday.length > 0}
      {@render list(dueToday)}
    {/if}
  </section>

  <section class="group" style="--h: var(--horizon-next)" aria-labelledby="today-next">
    <h2 class="label" id="today-next"><span class="swatch"></span>Up next<span class="count">{upNext.length}</span></h2>
    {#if upNext.length > 0}
      {@render list(upNext.slice(0, UP_NEXT_LIMIT))}
      {#if upNext.length > UP_NEXT_LIMIT}
        <button type="button" class="link" onclick={onshowplan}>Show all {upNext.length} in the plan</button>
      {/if}
    {:else}
      <p class="empty">Nothing lined up. Open a todo, choose When?, then Up next.</p>
    {/if}
  </section>

  {#if laterThisWeek.length > 0}
    <section class="group" style="--h: var(--horizon-week)" aria-labelledby="today-week">
      <h2 class="label" id="today-week"><span class="swatch"></span>Later this week<span class="count">{laterThisWeek.length}</span></h2>
      {@render list(laterThisWeek)}
    </section>
  {/if}

  <button type="button" class="link plan-link" onclick={onshowplan}>See the whole plan</button>
</div>

<style>
  .empty-inline { color: var(--text-muted); font-size: 0.82rem; font-weight: 400; }

  .today {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.25rem;
  }

  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    min-height: 3.5rem;
    padding: 0.35rem 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .day:hover {
    background: var(--surface-tint);
  }

  .day.past {
    color: var(--text-muted);
  }

  .day[aria-pressed='true'] {
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .n {
    min-width: 1.7rem;
    height: 1.7rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-weight: 700;
  }

  .day.is-today .n {
    background: var(--text);
    color: var(--bg);
  }

  .dow {
    font-size: 0.7rem;
    font-weight: 600;
  }


  .mark {
    width: 0.3rem;
    height: 0.3rem;
    border-radius: 999px;
  }

  .mark.on {
    background: var(--horizon-week);
  }

  .slipped {
    --h: var(--horizon-due);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 2.9rem;
    padding: 0 0.85rem;
    border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--warn-text);
    font: inherit;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
  }

  .slipped-text {
    flex: 1;
  }

  .cta {
    font-size: 0.82rem;
  }

  .swatch {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 2px;
    background: var(--h);
    flex-shrink: 0;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    padding: 0 0.25rem;
    font-size: 0.82rem;
    font-weight: 700;
    color: color-mix(in srgb, var(--h) 55%, var(--text));
  }

  .count {
    font-weight: 500;
    color: var(--text-muted);
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .empty {
    margin: 0;
    padding: 0 0.25rem;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .link {
    align-self: flex-start;
    min-height: 2.25rem;
    padding: 0 0.25rem;
    border: none;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .plan-link {
    align-self: center;
  }
</style>
