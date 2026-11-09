<script lang="ts">
  /**
   * The "slipped" review: todos whose date has passed (overdue) or whose
   * planned week/month ended without them getting done (rolled over).
   *
   * Roll-forward itself never needs this sheet — rolled-over todos already
   * sit in Up next. The review is an optional, user-opened place to decide
   * what to do with them in one pass: re-plan, park in Someday, give them a
   * date, or mark them done. It never opens on its own.
   */
  import type { Collection, InboxItem } from '@inbox-rs/rs-module';
  import { trapFocus } from '../lib/actions';
  import { todayStart } from '../lib/now';
  import { type PlanChoice, planFor } from '../lib/plan';
  import { setItemCompleted } from '../lib/schedule-sync';
  import { lockText } from '../lib/calendar-sync';
  import { moveStoredItemToDay, setItemPlan } from '../lib/stores';
  import { showToast } from '../lib/toast';
  import ScheduleSheet from './ScheduleSheet.svelte';

  let {
    overdue,
    rolled,
    lookupCollection,
    onclose,
  }: {
    /** Open todos dated before today. */
    overdue: InboxItem[];
    /** Rolled-over todos, each with its "from last week" note. */
    rolled: Array<{ todo: InboxItem; from: string }>;
    lookupCollection: (id: string | undefined) => Collection | null;
    onclose: () => void;
  } = $props();

  let busyId = $state<string | null>(null);
  let pickingDateFor = $state<InboxItem | null>(null);

  const total = $derived(overdue.length + rolled.length);
  const today = $derived(new Date($todayStart));

  function dueLabel(todo: InboxItem): string {
    if (!todo.startsAt) return '';
    const d = new Date(todo.startsAt);
    const days = Math.round(
      (today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000,
    );
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return days <= 1 ? `due ${date}` : `due ${date} · ${days} days ago`;
  }

  async function run(todo: InboxItem, action: () => Promise<void>, failMessage: string) {
    busyId = todo.id;
    try {
      await action();
    } catch (error) {
      console.error(failMessage, error);
      showToast(failMessage);
    } finally {
      busyId = null;
    }
  }

  const plan = (todo: InboxItem, choice: PlanChoice) =>
    run(todo, () => setItemPlan(todo, planFor(choice, today)), 'Couldn’t re-plan that todo');

  const dueToday = (todo: InboxItem) =>
    run(
      todo,
      // Only the date changes: a timed event keeps its kind, time and length.
      () => moveStoredItemToDay(todo, today),
      'Couldn’t move that todo to today',
    );

  const done = (todo: InboxItem) =>
    run(todo, () => setItemCompleted(todo, true), 'Couldn’t complete that todo');

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || pickingDateFor) return;
    onclose();
  }
</script>

<svelte:window onkeydown={handleEscape} />

{#snippet actions(todo: InboxItem, isOverdue: boolean)}
  <div class="actions" role="group" aria-label="What to do with {todo.title}">
    {#if isOverdue}
      <button type="button" class="act primary" disabled={busyId !== null || !!lockText(todo)} title={lockText(todo) || undefined} onclick={() => dueToday(todo)}>Today</button>
    {/if}
    <button type="button" class="act" class:primary={!isOverdue} disabled={busyId !== null} onclick={() => plan(todo, 'week')}>This week</button>
    <button type="button" class="act" disabled={busyId !== null} onclick={() => plan(todo, 'nextWeek')}>Next week</button>
    <button type="button" class="act" disabled={busyId !== null} onclick={() => (pickingDateFor = todo)}>Pick date…</button>
    <button type="button" class="act quiet" disabled={busyId !== null} onclick={() => plan(todo, 'someday')}>Someday</button>
    <button type="button" class="act quiet" disabled={busyId !== null} onclick={() => done(todo)}>Done</button>
  </div>
{/snippet}

{#snippet row(todo: InboxItem, note: string, isOverdue: boolean)}
  {@const col = lookupCollection(todo.collectionId)}
  <li class="item" class:overdue={isOverdue}>
    <div class="line">
      <span class="name">{todo.title}</span>
      <span class="note">{note}</span>
    </div>
    <div class="sub">
      <span class="coll"><span class="dot" style="background: {col?.color || 'var(--text-muted)'}"></span>{col?.name ?? 'Unfiled'}</span>
    </div>
    {@render actions(todo, isOverdue)}
  </li>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={() => { if (!pickingDateFor) onclose(); }}>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="slipped-title"
    use:trapFocus
    onclick={(e) => e.stopPropagation()}
  >
    <header class="head">
      <div>
        <h3 class="title" id="slipped-title">
          {total === 0 ? 'Nothing slipped' : `${total} ${total === 1 ? 'thing' : 'things'} slipped`}
        </h3>
        <p class="lede">
          {total === 0
            ? 'Everything is on plan.'
            : 'Rolled-over todos are already in Up next. Re-plan, park or finish them here — or just close this.'}
        </p>
      </div>
      <button type="button" class="close" aria-label="Close" onclick={onclose}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
    </header>

    {#if overdue.length > 0}
      <h4 class="group-label">Overdue</h4>
      <ul class="list" role="list">
        {#each overdue as todo (todo.id)}
          {@render row(todo, dueLabel(todo), true)}
        {/each}
      </ul>
    {/if}

    {#if rolled.length > 0}
      <h4 class="group-label">Rolled over</h4>
      <ul class="list" role="list">
        {#each rolled as { todo, from } (todo.id)}
          {@render row(todo, from, false)}
        {/each}
      </ul>
    {/if}

    <footer class="foot">
      <button type="button" class="btn-done" onclick={onclose}>Done</button>
    </footer>
  </div>
</div>

{#if pickingDateFor}
  <ScheduleSheet item={pickingDateFor} onclose={() => (pickingDateFor = null)} />
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    overflow-y: auto;
    overscroll-behavior: contain;
    z-index: 190;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4vh 1rem;
  }

  .sheet {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.1rem 1.25rem;
    max-width: 560px;
    width: 100%;
    box-shadow: 0 12px 40px var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .head > div {
    flex: 1;
  }

  .title {
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0;
  }

  .lede {
    margin: 0.2rem 0 0;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .close {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface-tint);
  }

  .group-label {
    margin: 0.4rem 0 0;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }

  .item.overdue {
    border-color: color-mix(in srgb, var(--warn) 40%, var(--border));
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--warn-text);
    white-space: nowrap;
  }

  .sub {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .coll {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .act {
    min-height: 2rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }

  .act:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .act.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .act.quiet {
    border-style: dashed;
    background: transparent;
    color: var(--text-muted);
  }

  .act:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.4rem;
  }

  .btn-done {
    min-height: 2.25rem;
    padding: 0 1rem;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--text);
    color: var(--bg);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
</style>
