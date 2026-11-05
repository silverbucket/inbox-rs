<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { type DndEvent, dragHandleZone } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { slide, fade } from 'svelte/transition';
  import { createDndLeaveGuard } from '../lib/dnd-leave-guard';
  import { createReorderFade } from '../lib/reorder-fade';
  import { onDestroy, onMount } from 'svelte';
  import {
    allTodos, visibleTodos, visibleOnCalendarTodos, reorderTodosGlobal,
    collections, sortedGroups, appConfig, updateConfig,
    clearSessionVisibleTodos, setItemPlan,
  } from '../lib/stores';
  import { isDueTodayOrOverdue } from '../lib/schedule';
  import { todayStart } from '../lib/now';
  import {
    DEFAULT_COLLAPSED, HORIZON_ORDER, type HorizonSection, type PlanChoice,
    type Plan, placeTodo, planFor, scheduledDayKey, sectionInfo, toDateKey,
  } from '../lib/plan';
  import { showToast } from '../lib/toast';
  import AlertsPermissionBanner from './AlertsPermissionBanner.svelte';
  import TodoRow from './TodoRow.svelte';
  import TodoQuickAdd from './TodoQuickAdd.svelte';
  import TodosToday from './TodosToday.svelte';
  import TodosCalendar from './TodosCalendar.svelte';
  import SlippedReview from './SlippedReview.svelte';
  import Fab from './Fab.svelte';

  let { onselect, onaddtodo, onaddtodoincollection, quickDraft = $bindable('') }: {
    onselect: (item: InboxItem) => void;
    /** Opens the add-todo modal with optional title and destination context.
        Callers may pass a collection explicitly; the quick-key path passes
        `null` to start Unfiled, while `undefined` leaves destination selection
        to the modal (as with the bare Fab). */
    onaddtodo: (
      prefillTitle?: string,
      collectionId?: string | null,
      plan?: Plan | null,
    ) => void;
    /** Opens the add-todo modal with a specific collection pre-selected.
        Used by the per-row quick-add affordance. Pass `null` to target an
        unfiled todo. */
    onaddtodoincollection: (collectionId: string | null) => void;
    /** Hoisted by App so search navigation preserves the quick-entry draft. */
    quickDraft?: string;
  } = $props();

  const todos = $derived($visibleTodos);
  // Todos deliberately filed into a hidden collection stay listed while the
  // page is open; leaving it hands the list back to the filter.
  // Session pins belong to one visit: start clean (a todo modal elsewhere
  // may have pinned an id) and leave clean.
  onMount(clearSessionVisibleTodos);
  onDestroy(clearSessionVisibleTodos);
  const openTodos = $derived(todos.filter(t => !t.completed));
  // The store pins due todos first (earliest due leading); the page renders
  // them as a separate non-draggable band so manual ordering stays meaningful
  // for everything below.
  const dueTodos = $derived(
    openTodos.filter(t => isDueTodayOrOverdue(t, $todayStart)),
  );
  const restOpenTodos = $derived(
    openTodos.filter(t => !isDueTodayOrOverdue(t, $todayStart)),
  );
  // Completed todos are sorted newest-first by completedAt for the collapsed
  // section — the global order only governs open todos.
  const completedTodos = $derived(
    todos.filter(t => t.completed)
      .slice()
      .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime()
                     - new Date(a.completedAt ?? a.createdAt).getTime())
  );

  // Group map by collection id, so each TodoRow can show its collection's color
  // and the parent group color without re-deriving per row.
  const collectionMap = $derived($collections);
  const groupMap = $derived(() => {
    const out: Record<string, typeof $sortedGroups[number]> = {};
    for (const g of $sortedGroups) out[g.id] = g;
    return out;
  });

  const completedExpanded = $derived($appConfig.completedTodosExpanded === true);

  // Todos moved to a calendar — the calendar owns them now. Collapsed by
  // default; local state only (unlike completed, no cross-device flag yet).
  const onCalendarTodos = $derived($visibleOnCalendarTodos);
  let onCalendarExpanded = $state(false);

  let isTouchDevice = $state(false);

  $effect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isTouchDevice = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // ── Horizon sections ────────────────────────────────────────────────────
  // Everything below the due band is grouped by plan (lib/plan.ts). Order
  // within a section still follows the global manual order from the store.
  const today = $derived(new Date($todayStart));
  const placements = $derived(
    new Map(restOpenTodos.map(t => [t.id, placeTodo(t, today)])),
  );
  const sectionItems = $derived.by(() => {
    const out = Object.fromEntries(
      HORIZON_ORDER.map(s => [s, [] as InboxItem[]]),
    ) as Record<HorizonSection, InboxItem[]>;
    for (const t of restOpenTodos) {
      out[placements.get(t.id)?.section ?? 'unplanned'].push(t);
    }
    return out;
  });
  /** Up next always shows (it is the default drop target); others only when non-empty. */
  const shownSections = $derived(
    HORIZON_ORDER.filter(s => s === 'next' || sectionItems[s].length > 0),
  );
  const collapsed = $derived(
    new Set<string>($appConfig.collapsedPlanSections ?? DEFAULT_COLLAPSED),
  );
  const rolledCount = $derived(
    sectionItems.next.filter(t => placements.get(t.id)?.rolledFrom).length,
  );

  async function toggleSection(section: HorizonSection) {
    const next = new Set(collapsed);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    try {
      await updateConfig({ collapsedPlanSections: [...next] });
    } catch (error) {
      console.error('Failed to toggle plan section', error);
    }
  }

  /** Collection names peeking out of a folded section, most frequent first. */
  function peek(list: InboxItem[]): string {
    const counts = new Map<string, number>();
    for (const t of list) {
      const name = lookupCollection(t.collectionId)?.name ?? 'Unfiled';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    return names.length > 3
      ? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
      : names.join(', ');
  }

  /** Where dropping into a section re-plans a todo. `undefined` = not a drop target. */
  const DROP_PLAN: Partial<Record<HorizonSection, PlanChoice | null>> = {
    next: 'next',
    week: 'week',
    nextWeek: 'nextWeek',
    month: 'month',
    nextMonth: 'nextMonth',
    someday: 'someday',
    unplanned: null,
  };

  // Local mutable copies for the dnd zones, one per section. Kept in sync
  // with the derived lists whenever upstream changes — except mid-drag, where
  // `handleDndConsider` is authoritative.
  let dndSections = $state<Record<string, Array<InboxItem & { id: string }>>>({});
  // Drops still being written. While any are outstanding, the lists keep
  // showing what the user dropped instead of snapping back to the stored
  // order between writes; the last one to finish resyncs.
  let settling = 0;
  $effect(() => {
    const next = Object.fromEntries(
      HORIZON_ORDER.map(s => [s, sectionItems[s].map(t => ({ ...t }))]),
    );
    if (settling > 0) return;
    dndSections = next;
  });

  // Rows fade when added or removed, but not while being reordered — a
  // lingering outro copy makes svelte-dnd-action lose the row it is carrying.
  const reorderFade = createReorderFade();

  // A two-row list is barely taller than the row being carried, so dragging
  // one todo above the other takes the pointer out of the list; the library
  // would revert the order and the drop would snap back.
  const leaveGuard = createDndLeaveGuard();

  function handleDndConsider(
    section: HorizonSection,
    e: CustomEvent<DndEvent<InboxItem & { id: string }>>,
  ) {
    if (leaveGuard.ignores(e.detail.info)) return;
    reorderFade.start();
    dndSections = { ...dndSections, [section]: e.detail.items };
  }

  // A cross-section drag finalizes both zones (and, for keyboard drags, the
  // library is still tidying up afterwards). Collect the arrivals and do the
  // writes once, on the next task, so no store update lands mid-drag.
  // Settles run strictly one after another: a quick second drop must not
  // start writing while the first is still awaiting storage, or the older
  // write could land last and undo the newer plan.
  const pendingArrivals = new Map<string, HorizonSection>();
  let settleQueued = false;
  /** Set when a drop is refused, so the origin zone's queued settle skips it. */
  let dropRejected = false;
  let settleChain: Promise<void> = Promise.resolve();

  /** One completed drop: its order and arrivals, captured when it landed. */
  interface SettleJob {
    order: string[];
    arrivals: Array<[string, HorizonSection]>;
  }

  function queueSettle() {
    if (settleQueued) return;
    settleQueued = true;
    // Next task: a cross-section drop finalizes both zones first, so the
    // snapshot below sees the whole drop.
    setTimeout(() => {
      settleQueued = false;
      if (dropRejected) {
        // The other half of this drop refused it: nothing to persist, the
        // lists are being reset instead.
        dropRejected = false;
        pendingArrivals.clear();
        return;
      }
      const job: SettleJob = {
        order: [
          ...dueTodos.map(t => t.id),
          ...HORIZON_ORDER.flatMap(s => (dndSections[s] ?? []).map(t => t.id)),
        ],
        arrivals: [...pendingArrivals.entries()],
      };
      pendingArrivals.clear();
      settling++;
      settleChain = settleChain.then(() => settle(job));
    }, 0);
  }

  async function settle(job: SettleJob) {
    try {
      try {
        // Due-band todos lead the persisted order so they resume a sane
        // manual slot once their due date passes out of the band.
        await reorderTodosGlobal(job.order);
      } catch (error) {
        console.error('Failed to reorder todos', error);
      }
      for (const [id, section] of job.arrivals) {
        // Read the todo now, not at drop time: an earlier settle, a card
        // edit or a sync may have changed it while this one waited.
        const current = $allTodos.find(t => t.id === id);
        const choice = DROP_PLAN[section];
        if (!current || current.completed || choice === undefined) continue;
        if (current.startsAt) {
          // It gained a date meanwhile — a date outranks the drop.
          showToast('This todo has a date now — it stays where its date puts it');
          continue;
        }
        try {
          const plan = choice === null ? null : planFor(choice, new Date());
          // Dropping into "not planned" also lets go of a legacy pin, which
          // would otherwise keep it in Up next.
          await setItemPlan(
            current,
            plan,
            choice === null && current.pinned ? { pinned: false } : {},
          );
        } catch (error) {
          console.error('Failed to re-plan todo', error);
          showToast('Couldn’t move that todo');
        }
      }
    } finally {
      settling--;
      if (settling === 0) {
        resetSections();
        // Only now let rows fade again: a cross-section drop finalizes two
        // zones and re-renders after the writes, and the library finds rows
        // by child index, so a lingering outro copy would desync it (see
        // reorder-fade).
        await reorderFade.end();
      }
    }
  }

  function resetSections() {
    dndSections = Object.fromEntries(
      HORIZON_ORDER.map(s => [s, sectionItems[s].map(t => ({ ...t }))]),
    );
  }

  async function handleDndFinalize(
    section: HorizonSection,
    e: CustomEvent<DndEvent<InboxItem & { id: string }>>,
  ) {
    leaveGuard.reset();
    dndSections = { ...dndSections, [section]: e.detail.items };
    // Rows that arrived from another section get that section's plan.
    for (const moved of e.detail.items) {
      if ((placements.get(moved.id)?.section ?? 'unplanned') === section) continue;
      const original = restOpenTodos.find(t => t.id === moved.id);
      if (!original) continue;
      if (DROP_PLAN[section] === undefined || original.startsAt) {
        showToast(
          original.startsAt
            ? 'This todo has a date — change it from its card'
            : 'Only dated todos live in Later',
        );
        pendingArrivals.clear();
        if (settleQueued) dropRejected = true;
        setTimeout(() => {
          resetSections();
          void reorderFade.end();
        }, 0);
        return;
      }
      pendingArrivals.set(moved.id, section);
    }
    queueSettle();
  }

  async function toggleCompletedSection() {
    try {
      await updateConfig({ completedTodosExpanded: !completedExpanded });
    } catch (error) {
      console.error('Failed to toggle completed todos section', error);
    }
  }

  // ── Views ─────────────────────────────────────────────────────────────
  // One plan, four layouts. Horizon and Board share the section zones and
  // drop logic above; Today and Calendar are read-mostly views of the same
  // placements. The choice syncs via appConfig; unset means Today on
  // phones and Horizon elsewhere.
  type TodosView = 'today' | 'horizon' | 'board' | 'calendar';
  const VIEWS: Array<{ id: TodosView; label: string }> = [
    { id: 'today', label: 'Today' },
    { id: 'horizon', label: 'Horizon' },
    { id: 'board', label: 'Board' },
    { id: 'calendar', label: 'Calendar' },
  ];
  let narrow = $state(false);
  $effect(() => {
    const mql = window.matchMedia('(max-width: 600px)');
    narrow = mql.matches;
    const handler = (e: MediaQueryListEvent) => { narrow = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });
  const view = $derived<TodosView>($appConfig.todosView ?? (narrow ? 'today' : 'horizon'));

  async function setView(next: TodosView) {
    try {
      await updateConfig({ todosView: next });
    } catch (error) {
      console.error('Failed to switch Todos view', error);
    }
  }

  /** Board columns; Later, Someday and Not planned sit in the side tray. */
  const BOARD_COLUMNS: HorizonSection[] = ['next', 'week', 'nextWeek', 'month', 'nextMonth'];
  const TRAY_SECTIONS: HorizonSection[] = ['later', 'someday', 'unplanned'];
  let openTrays = $state<Set<HorizonSection>>(new Set());
  function toggleTray(section: HorizonSection) {
    const next = new Set(openTrays);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    openTrays = next;
  }

  // ── Slipped review ────────────────────────────────────────────────────
  const todayKey = $derived(toDateKey(today));
  const overdueTodos = $derived(
    dueTodos.filter(t => (scheduledDayKey(t) ?? todayKey) < todayKey),
  );
  const rolledTodos = $derived(
    restOpenTodos
      .filter(t => placements.get(t.id)?.rolledFrom)
      .map(t => ({ todo: t, from: placements.get(t.id)?.rolledFrom ?? '' })),
  );
  let reviewOpen = $state(false);

  function lookupCollection(id: string | undefined) {
    if (!id) return null;
    return collectionMap[id] ?? null;
  }

  function lookupGroup(collectionId: string | undefined) {
    const col = lookupCollection(collectionId);
    if (!col?.groupId) return null;
    return groupMap()[col.groupId] ?? null;
  }
</script>

<div class="todos-page">
  <AlertsPermissionBanner />
  <!--
    Toolbar: count + Fab (the Fab is an inline pill on desktop, position:fixed
    and out of flow on mobile). Rendered BELOW the quick-add in the populated
    state — and at the top of the empty hero — so the quick-add input lines up
    vertically with the inbox's capture bar when switching tabs.
  -->
  {#snippet todoToolbar()}
    <!-- Desktop: hidden — capture happens in the input (Enter quick-adds,
         ⌘/Ctrl-Shift-Enter opens the modal). Mobile: the Fab is position:fixed, a
         floating + circle in the thumb zone. -->
    <div class="page-toolbar">
      <!-- No destination context: the modal then starts on the shared
           default and keeps following the filter while open. A collection
           id here would fix the destination, as collection-specific entry
           points want. -->
      <Fab onclick={() => onaddtodo('')} label="New todo" />
    </div>
  {/snippet}

  {#snippet zone(section: HorizonSection, stacked: boolean)}
      <ul
        id="{stacked ? 'board' : 'horizon'}-list-{section}"
        class="todo-list horizon-list"
        class:empty={(dndSections[section] ?? []).length === 0}
        role="list"
        use:dragHandleZone={{
          items: dndSections[section] ?? [],
          flipDurationMs: 200,
          // The grip is at the left edge of a wide row. Follow the pointer so
          // a diagonal drag inside the list isn't rejected when the row's
          // centre extends beyond the zone.
          useCursorForDetection: true,
          dropTargetStyle: {},
          // No `dragDisabled` — see the note in SidebarShell. Every
          // `dragHandleZone` shares one module-global copy of that flag, so
          // setting it here disabled every grip on the page. Reorder is gated on
          // the handle anyway. Sections share a type so rows can be dragged
          // between them, which re-plans the todo.
          type: 'todos-global',
        }}
        onconsider={(e) => handleDndConsider(section, e)}
        onfinalize={(e) => handleDndFinalize(section, e)}
      >
        {#each dndSections[section] ?? [] as todo (todo.id)}
          <div
            animate:flip={{ duration: 200 }}
            in:reorderFade.fade={{ duration: 180 }}
            out:reorderFade.fade={{ duration: 120 }}
          >
            <TodoRow
              {todo}
              collection={lookupCollection(todo.collectionId)}
              group={lookupGroup(todo.collectionId)}
              reorderable
              {stacked}
              planTag={placements.get(todo.id)?.rolledFrom}
              {onselect}
              onaddincollection={onaddtodoincollection}
            />
          </div>
        {/each}
      </ul>
  {/snippet}

  {#snippet board()}
    <div class="board">
      {#if dueTodos.length > 0}
        <section class="col" style="--h: var(--horizon-due)" aria-labelledby="board-due">
          <div class="col-head">
            <span class="swatch" aria-hidden="true"></span>
            <h2 class="col-label" id="board-due">Due &amp; overdue</h2>
            <span class="col-count">{dueTodos.length}</span>
          </div>
          {#if overdueTodos.length > 0}
            <button type="button" class="review-btn" onclick={() => (reviewOpen = true)}>Review {overdueTodos.length} overdue</button>
          {/if}
          <ul class="todo-list" role="list">
            {#each dueTodos as todo (todo.id)}
              <TodoRow
                {todo}
                stacked
                collection={lookupCollection(todo.collectionId)}
                group={lookupGroup(todo.collectionId)}
                {onselect}
                onaddincollection={onaddtodoincollection}
              />
            {/each}
          </ul>
        </section>
      {/if}
      {#each BOARD_COLUMNS as section (section)}
        {@const info = sectionInfo(section, today)}
        <section class="col" style="--h: var(--horizon-{section})" aria-labelledby="board-{section}">
          <div class="col-head">
            <span class="swatch" aria-hidden="true"></span>
            <h2 class="col-label" id="board-{section}">{info.label}</h2>
            <span class="col-count">{(dndSections[section] ?? []).length}</span>
          </div>
          <div class="col-sub">
            {#if section === 'next' && rolledCount > 0}
              <button type="button" class="rolled-chip" onclick={() => (reviewOpen = true)}>{rolledCount} rolled over · Review</button>
            {:else}
              {info.range}
            {/if}
          </div>
          {@render zone(section, true)}
        </section>
      {/each}
      <aside class="tray" aria-label="Off the board">
        <h2 class="tray-title">Off the board</h2>
        {#each TRAY_SECTIONS as section (section)}
          {@const info = sectionInfo(section, today)}
          {@const count = (dndSections[section] ?? []).length}
          <section class="tray-group" style="--h: var(--horizon-{section})">
            <button
              type="button"
              class="tray-toggle"
              aria-expanded={openTrays.has(section)}
              onclick={() => toggleTray(section)}
            >
              <span class="swatch" aria-hidden="true"></span>
              <span class="tray-label">{info.label}</span>
              <span class="col-count">{count}</span>
            </button>
            {#if openTrays.has(section)}
              {@render zone(section, true)}
            {:else if count > 0}
              <p class="tray-peek">{peek(dndSections[section] ?? [])}</p>
            {/if}
          </section>
        {/each}
        <p class="tray-hint">Drop a card on an open Someday or Not planned list to move it there.</p>
      </aside>
    </div>
  {/snippet}

  {#if openTodos.length === 0 && completedTodos.length === 0 && onCalendarTodos.length === 0}
    <!-- Lead with the composer so its input lines up with the inbox capture
         bar. The toolbar's Fab is hidden on desktop (the input + ⌘⇧↵ handle
         capture) and a floating + circle on mobile. -->
    <TodoQuickAdd hideOnMobile focusOnMount bind:quickTitle={quickDraft} onopenmodal={(t, c, p) => onaddtodo(t, c, p)} />
    {@render todoToolbar()}
    <div class="empty-state" in:fade={{ duration: 180 }}>
      <p class="empty-title">Jot a todo</p>
      <p class="empty-hint empty-hint--desktop">Capture it now. Organize it later.</p>
      <!-- Mobile: the inline composer is hidden in favour of the floating
           FAB, so the hint needs to point at it. CSS swaps which line shows. -->
      <p class="empty-hint empty-hint--mobile">Tap + to capture one. Organize it later.</p>
    </div>
  {:else}
    <TodoQuickAdd hideOnMobile compact focusOnMount bind:quickTitle={quickDraft} onopenmodal={(t, c, p) => onaddtodo(t, c, p)} />
    {@render todoToolbar()}

    <div class="view-switch" role="group" aria-label="Todos view">
      {#each VIEWS as v (v.id)}
        <button type="button" class="view-btn" aria-pressed={view === v.id} onclick={() => setView(v.id)}>
          {v.label}
        </button>
      {/each}
    </div>

    {#if view === 'today'}
      <TodosToday
        todos={openTodos}
        {placements}
        overdueCount={overdueTodos.length}
        rolledCount={rolledTodos.length}
        {lookupCollection}
        {lookupGroup}
        {onselect}
        onaddincollection={onaddtodoincollection}
        onreview={() => (reviewOpen = true)}
        onshowplan={() => setView('horizon')}
      />
    {:else if view === 'calendar'}
      <TodosCalendar
        todos={openTodos}
        {placements}
        overdueCount={overdueTodos.length}
        {lookupCollection}
        {onselect}
        onreview={() => (reviewOpen = true)}
      />
    {:else if view === 'board'}
      {@render board()}
    {:else}

    {#if dueTodos.length > 0}
      <section class="due-band" aria-labelledby="due-heading">
        <div class="due-head">
          <h2 class="due-header" id="due-heading">
            Due &amp; overdue <span class="count">{dueTodos.length}</span>
          </h2>
          {#if overdueTodos.length > 0}
            <button type="button" class="review-btn" onclick={() => (reviewOpen = true)}>Review {overdueTodos.length} overdue</button>
          {/if}
        </div>
        <!-- TodoRow renders its own <li>, so rows sit directly in the list —
             no transition wrapper (a div between ul and li breaks list
             semantics for assistive tech). -->
        <ul class="todo-list" role="list">
          {#each dueTodos as todo (todo.id)}
            <TodoRow
              {todo}
              collection={lookupCollection(todo.collectionId)}
              group={lookupGroup(todo.collectionId)}
              {onselect}
              onaddincollection={onaddtodoincollection}
            />
          {/each}
        </ul>
      </section>
    {/if}

    {#each shownSections as section (section)}
      {@const info = sectionInfo(section, today)}
      {@const list = dndSections[section] ?? []}
      {@const isCollapsed = collapsed.has(section)}
      <section
        class="horizon"
        class:unplanned={section === 'unplanned'}
        style="--h: var(--horizon-{section})"
        aria-labelledby="horizon-{section}"
      >
        <div class="horizon-head">
          <button
            type="button"
            class="horizon-toggle"
            aria-expanded={!isCollapsed}
            aria-controls="horizon-list-{section}"
            onclick={() => toggleSection(section)}
          >
            <svg aria-hidden="true" class="chevron" class:open={!isCollapsed} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            <h2 class="horizon-label" id="horizon-{section}">
              <span class="swatch" aria-hidden="true"></span>{info.label}
            </h2>
            {#if info.range}<span class="horizon-range">{info.range}</span>{/if}
            {#if isCollapsed && list.length > 0}
              <span class="horizon-peek">{peek(list)}</span>
            {/if}
          </button>
          {#if section === 'next' && rolledCount > 0}
            <button type="button" class="rolled-chip" onclick={() => (reviewOpen = true)}>
              {rolledCount} rolled over · Review
            </button>
          {/if}
          <span class="horizon-count" aria-label="{list.length} todos">{list.length}</span>
        </div>

        {#if !isCollapsed}
          {@render zone(section, false)}
          {#if section === 'next' && list.length === 0}
            <p class="horizon-hint">Nothing lined up. Drag a todo here, or pick “Up next” from When?.</p>
          {:else if section === 'unplanned'}
            <p class="horizon-hint">Drag these into a section above, or open one and choose When?.</p>
          {/if}
        {/if}
      </section>
    {/each}

    {/if}

    {#if (view === 'horizon' || view === 'board') && completedTodos.length > 0}
      <div class="completed-section">
        <button type="button"
          class="btn-completed-toggle"
          onclick={toggleCompletedSection}
          aria-expanded={completedExpanded}
        >
          <svg aria-hidden="true" class="chevron" class:open={completedExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          {completedTodos.length} completed
        </button>

        {#if completedExpanded}
          <ul
            class="todo-list completed-list"
            role="list"
            transition:slide={{ duration: isTouchDevice ? 0 : 200 }}
          >
            {#each completedTodos as todo (todo.id)}
              <div in:fade={{ duration: 150 }}>
                <TodoRow
                  {todo}
                  collection={lookupCollection(todo.collectionId)}
                  group={lookupGroup(todo.collectionId)}
                  {onselect}
                  onaddincollection={onaddtodoincollection}
                />
              </div>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if (view === 'horizon' || view === 'board') && onCalendarTodos.length > 0}
      <div class="completed-section">
        <button type="button"
          class="btn-completed-toggle"
          onclick={() => (onCalendarExpanded = !onCalendarExpanded)}
          aria-expanded={onCalendarExpanded}
        >
          <svg aria-hidden="true" class="chevron" class:open={onCalendarExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          {onCalendarTodos.length} archived
        </button>

        {#if onCalendarExpanded}
          <ul
            class="todo-list completed-list"
            role="list"
            transition:slide={{ duration: isTouchDevice ? 0 : 200 }}
          >
            {#each onCalendarTodos as todo (todo.id)}
              <TodoRow
                {todo}
                readonly
                collection={lookupCollection(todo.collectionId)}
                group={lookupGroup(todo.collectionId)}
                {onselect}
              />
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  {/if}

  {#if reviewOpen}
    <SlippedReview
      overdue={overdueTodos}
      rolled={rolledTodos}
      {lookupCollection}
      onclose={() => (reviewOpen = false)}
    />
  {/if}
</div>

<style>
  .todos-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .page-toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* Desktop: no inline New-todo pill — capture lives in the input (Enter to
     quick-add, ⌘/Ctrl-Shift-Enter to open the modal). On mobile the Fab is
     position:fixed (out of flow), so the floating + circle still shows. */
  @media (min-width: 769px) {
    .page-toolbar {
      display: none;
    }
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .due-band {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px dashed var(--border);
  }

  .due-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--danger-text);
    padding: 0 0.25rem;
  }

  .due-header .count {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }

  /* ── Horizon sections ── */
  .horizon {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .horizon + .horizon {
    margin-top: 0.4rem;
  }

  .horizon.unplanned {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border);
  }

  .horizon-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
  }

  .horizon-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    padding: 0.25rem 0.35rem;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
    font: inherit;
  }

  .horizon-toggle:hover {
    background: var(--surface-tint);
  }

  .horizon-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    padding: 0.15rem 0.55rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    white-space: nowrap;
    color: color-mix(in srgb, var(--h) 55%, var(--text));
    background: color-mix(in srgb, var(--h) 16%, transparent);
  }

  .swatch {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 2px;
    background: var(--h);
    flex-shrink: 0;
  }

  .horizon-range {
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .horizon-peek {
    font-size: 0.8rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-left: auto;
  }

  .horizon-count {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    min-width: 1.5rem;
    text-align: right;
    padding-right: 0.35rem;
  }

  .rolled-chip {
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
    color: var(--warn-text);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
  }

  /* An empty Up next stays a real drop zone. */
  .horizon-list.empty {
    min-height: 2.75rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
  }

  .horizon-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
    padding: 0 0.5rem;
  }

  .completed-section {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border);
  }

  .completed-list {
    margin-top: 0.4rem;
    opacity: 0.75;
  }

  .btn-completed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: color 150ms, background 150ms;
  }

  .btn-completed-toggle:hover {
    color: var(--text);
    background: var(--surface-tint);
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .chevron.open {
    transform: rotate(0);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    /* Sits below the composer now, so it needs only a little breathing room
       above rather than the full hero offset. */
    padding: 1.5rem 1rem 1rem;
    text-align: center;
    color: var(--text-muted);
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .empty-hint {
    font-size: 0.85rem;
    max-width: 32rem;
    margin: 0;
  }

  /* Mobile-only sibling — hidden by default, revealed in the mobile media
     query below. Keeps both lines in the DOM so screen readers see only the
     one that's currently visible. */
  .empty-hint--mobile {
    display: none;
  }

  /*
   * Mobile: the floating FAB is the canonical capture surface (TodoQuickAdd
   * hides itself there via hideOnMobile), so reserve a little bottom padding
   * and swap the empty-state hint to one that points at the FAB.
   */
  @media (max-width: 768px) {
    .todos-page {
      padding-bottom: 5rem;
    }

    .empty-hint--desktop {
      display: none;
    }

    .empty-hint--mobile {
      display: block;
    }
  }

  @media (max-width: 600px) {
    .todos-page {
      padding-bottom: 4.5rem;
    }
  }

  /* ── View switch ── */
  .view-switch {
    display: inline-flex;
    align-self: flex-start;
    padding: 3px;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-tint);
  }

  .view-btn {
    min-height: 2rem;
    padding: 0 0.8rem;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .view-btn[aria-pressed='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px var(--shadow);
  }

  .due-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .review-btn {
    margin-left: auto;
    min-height: 1.9rem;
    padding: 0 0.65rem;
    border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border));
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--warn-text);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }

  button.rolled-chip {
    border: none;
    font: inherit;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
  }

  /* ── Board ── */
  .board {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    overflow-x: auto;
    padding-bottom: 0.5rem;
  }

  .col {
    flex: 1 0 220px;
    min-width: 220px;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.55rem;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--h) 12%, var(--bg));
  }

  .col :global(.todo-list) {
    max-height: 62vh;
    overflow-y: auto;
  }

  .col-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0 0.2rem;
  }

  .col-label {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 700;
    color: color-mix(in srgb, var(--h) 55%, var(--text));
  }

  .col-count {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .col-sub {
    min-height: 1.4rem;
    padding: 0 0.2rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .tray {
    flex: 0 0 220px;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.55rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }

  .tray-title {
    margin: 0 0 0.15rem;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .tray-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.45rem;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .tray-toggle {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    text-align: left;
    padding: 0;
  }

  .tray-peek,
  .tray-hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  @media (max-width: 600px) {
    .view-switch {
      align-self: stretch;
    }

    .view-btn {
      flex: 1;
      padding: 0 0.4rem;
    }

    .tray {
      flex-basis: 200px;
    }
  }
</style>
