<script lang="ts">
  /**
   * Quick-add todo composer, shared by the Todos page and the collection
   * view's Todos section. Plain Enter files a todo instantly; ⌘/Ctrl-Shift-Enter
   * opens the full modal pre-filled (via `onopenmodal`), mirroring the inbox
   * capture bar.
   *
   * When `fixedCollectionId` is set (collection view), todos are filed there
   * and the collection select is hidden. Otherwise the destination follows
   * the shared rule in `todo-destination.ts`: it never points outside the
   * current view, so a plain-Enter capture always lands in the list it was
   * typed into. The chip lets the user pick anything — including a hidden
   * collection, which then stays an explicit, session-only choice.
   */
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { canCaptureTodo, makeUnfiledTodo } from '../lib/add-entry-modal';
  import { autofocusIf } from '../lib/actions';
  import { modLabel } from '../lib/platform';
  import {
    type FilingSubject,
    recordCollectionUse,
  } from '../lib/collection-suggest';
  import { formatScheduled, type PendingSchedule } from '../lib/schedule';
  import { applyPendingSchedule } from '../lib/schedule-sync';
  import {
    rememberTodoDestination,
    todoDestinationDefault,
  } from '../lib/todo-destination';
  import CollectionPicker from './CollectionPicker.svelte';
  import ScheduleSheet from './ScheduleSheet.svelte';
  import { applyPlan, type Plan, planLabel } from '../lib/plan';
  import { todayStart } from '../lib/now';
  import {
    collections,
    explicitTodoPick,
    hiddenCollectionIds,
    keepTodoVisible,
    moveItemToCollection,
    sessionPinGeneration,
    sortedGroups,
    storeItem,
  } from '../lib/stores';

  let {
    fixedCollectionId = undefined,
    compact = false,
    hideOnMobile = false,
    focusOnMount = false,
    quickTitle = $bindable(''),
    onopenmodal,
  }: {
    /** When set, todos are filed here and the collection select is hidden. */
    fixedCollectionId?: string;
    /** Slim variant used above an existing list. */
    compact?: boolean;
    /** Hide on mobile — the Todos page has a floating Fab there instead. */
    hideOnMobile?: boolean;
    /** Focus the input on mount (the Todos page does; the collection view
        doesn't, to avoid stealing focus when a collection is expanded). */
    focusOnMount?: boolean;
    /** Hoisted on the Todos page so navigation does not discard a draft. */
    quickTitle?: string;
    /** ⌘/Ctrl-Shift-Enter — open the full todo modal pre-filled with the title.
        Shortcut-created todos pass `null` so the modal starts Unfiled rather
        than inheriting the selected, fixed, or remembered collection. */
    onopenmodal: (
      prefillTitle: string,
      collectionId: string | null,
      plan?: Plan | null,
    ) => void;
  } = $props();

  let quickSaving = $state(false);
  let quickError = $state('');
  let quickFocused = $state(false);
  let quickInputEl = $state<HTMLInputElement | undefined>(undefined);
  const mod = modLabel();

  const collectionMap = $derived($collections);
  const groupMap = $derived(() => {
    const out: Record<string, (typeof $sortedGroups)[number]> = {};
    for (const g of $sortedGroups) out[g.id] = g;
    return out;
  });

  /** True when filing here would put the todo outside the current view. */
  function isOutOfView(id: string | undefined): boolean {
    return !!id && $hiddenCollectionIds.has(id);
  }

  // A pick the shared default can't express (see `explicitTodoPick`):
  // kept in the store so it survives this component's hero→compact
  // remount, and reset there whenever the filters change.
  const quickAddCollectionId = $derived(
    $explicitTodoPick === null
      ? undefined
      : ($explicitTodoPick ?? $todoDestinationDefault),
  );

  const targetCollectionId = $derived(fixedCollectionId ?? quickAddCollectionId);

  // ── Destination picker (shared CollectionPicker, chip trigger) ─────────
  let pickerOpen = $state(false);

  // ── Optional capture-time schedule ("When?" chip → ScheduleSheet) ──────
  let pendingSchedule = $state<PendingSchedule | null>(null);
  // …or a soft plan ("next week"). The two are mutually exclusive.
  let pendingPlan = $state<Plan | null>(null);
  let scheduleOpen = $state(false);

  const whenLabel = $derived(
    pendingSchedule
      ? formatScheduled({
          startsAt: pendingSchedule.start.toISOString(),
          endsAt: pendingSchedule.end?.toISOString(),
          allDay: pendingSchedule.allDay,
        })
      : pendingPlan
        ? planLabel(pendingPlan, new Date($todayStart))
        : 'When?',
  );

  function handleSchedulePick(schedule: PendingSchedule | null) {
    pendingSchedule = schedule;
    if (schedule) pendingPlan = null;
    scheduleOpen = false;
    quickInputEl?.focus();
  }

  function handlePlanPick(plan: Plan | null) {
    pendingPlan = plan;
    if (plan) pendingSchedule = null;
    scheduleOpen = false;
    quickInputEl?.focus();
  }

  /** Chip display parts for the current quick-add destination. */
  const chip = $derived.by(() => {
    const col = quickAddCollectionId
      ? collectionMap[quickAddCollectionId]
      : undefined;
    if (!col)
      return { name: 'Unfiled', color: '#9ca3af', hidden: false, set: false };
    return {
      name: col.name,
      color: col.color || '#6366f1',
      hidden: isOutOfView(col.id),
      set: true,
    };
  });

  /** What the picker files: the composed title feeds name-match suggestions. */
  const pickerSubject = $derived<FilingSubject>({
    title: quickTitle,
    collectionId: quickAddCollectionId,
    isTodo: true,
  });

  function handlePick(id: string | undefined) {
    // Visible picks become the remembered default; the shared rule then
    // keeps or drops them as the view changes. Anything the rule can't hold
    // (a hidden or ungrouped collection, Unfiled under a filter) is kept
    // explicitly — detected by asking the rule, so every such case is one.
    rememberTodoDestination(id ?? null);
    const resolved = get(todoDestinationDefault);
    explicitTodoPick.set(
      id === undefined
        ? resolved === undefined
          ? undefined
          : null
        : resolved === id
          ? undefined
          : id,
    );
    pickerOpen = false;
    // Hand focus back to the title so capture flow isn't interrupted.
    quickInputEl?.focus();
  }

  // Where plain Enter will file the todo, shown in the hint while composing so
  // the destination is predictable before submitting.
  const destinationLabel = $derived.by(() => {
    const id = targetCollectionId;
    const col = id ? collectionMap[id] : undefined;
    if (!col) return 'Unfiled';
    const group = col.groupId ? groupMap()[col.groupId] : undefined;
    return group ? `${group.name} › ${col.name}` : col.name;
  });

  async function addQuickTodo() {
    if (!canCaptureTodo(quickTitle) || quickSaving) return;
    quickSaving = true;
    quickError = '';
    // storeItem creates the todo; filing and scheduling are follow-up steps.
    // Track each boundary so the error names the stage that actually failed —
    // and so a failure never leaves the title around to be re-submitted,
    // which would store a duplicate todo on retry.
    let created = false;
    let filed = false;
    // Capture the destination the user saw at submit: a filter change during
    // the writes recomputes `targetCollectionId`, and every step below must
    // agree on one collection.
    const destination = targetCollectionId;
    const pinWanted = isOutOfView(destination);
    const pinGeneration = $sessionPinGeneration;
    try {
      // Stored already filed: a create-then-move writes the item twice in
      // quick succession, which can 412 and lose the move (see
      // moveItemToCollection). The move below then only updates itemIds.
      // The local draft stays unfiled so the schedule fallback below cannot
      // write a collection back that vanished during the store.
      const unplanned = makeUnfiledTodo(quickTitle);
      const todo = pendingPlan ? applyPlan(unplanned, pendingPlan) : unplanned;
      await storeItem(
        destination && collectionMap[destination]
          ? { ...todo, collectionId: destination }
          : todo,
      );
      created = true;
      quickTitle = '';
      // Separate step keeps collection.itemIds in sync, matching AddEntryModal.
      if (destination) {
        // Filed somewhere the filter hides on purpose: the row stays in the
        // list, tagged with its collection, instead of vanishing on Enter.
        // Pinned before the move so the row never blinks out between the
        // write and the pin — unless the pins were reset meanwhile (filter
        // changed, page left), in which case the list is already on the
        // user's new terms.
        if (pinWanted && $sessionPinGeneration === pinGeneration) {
          keepTodoVisible(todo.id);
        }
        await moveItemToCollection(todo.id, destination);
        recordCollectionUse(destination);
      }
      filed = true;
      if (pendingSchedule) {
        // Apply after the move so the stored item keeps its collectionId —
        // only if the move actually filed it (the collection may have been
        // deleted while the store write was in flight; the move then no-ops).
        // Posts to the picked calendar best-effort (local-first, toasts on
        // failure) — see applyPendingSchedule.
        const filedInto =
          destination && collectionMap[destination] ? destination : undefined;
        await applyPendingSchedule(
          filedInto ? { ...todo, collectionId: filedInto } : todo,
          pendingSchedule,
        );
      }
    } catch (error) {
      console.error('Failed to add todo', error);
      quickError = filed
        ? 'Todo added, but saving its schedule failed.'
        : created
          ? 'Todo added, but filing it into the collection failed.'
          : error instanceof Error
            ? error.message
            : 'Failed to add todo';
    } finally {
      // The pending time belongs to the todo just created (even when a
      // follow-up step failed) — never let it leak onto the next capture.
      if (created) {
        pendingSchedule = null;
        pendingPlan = null;
      }
      quickSaving = false;
      // Return focus so the user can keep capturing; tick() lets a hero→compact
      // remount settle before refocusing the (new) element.
      await tick();
      quickInputEl?.focus();
    }
  }

  // Clear a stale error once the user edits the input. Driven by the input's
  // oninput (a real keystroke) rather than a reactive effect on quickTitle —
  // the effect also read quickError, so setting it re-ran the effect and wiped
  // the message before it could render. A programmatic clear after a successful
  // submit must NOT clear the error, so this only fires on genuine edits.
  function clearStaleError() {
    if (quickError) quickError = '';
  }
</script>

<form
  class="quick-add"
  class:quick-add--compact={compact}
  class:quick-add--no-select={!!fixedCollectionId}
  class:quick-add--hide-mobile={hideOnMobile}
  onsubmit={(e) => {
    e.preventDefault();
    addQuickTodo();
  }}
>
  <input
    bind:this={quickInputEl}
    type="text"
    bind:value={quickTitle}
    placeholder={compact ? 'Add a todo…' : 'What needs doing?'}
    aria-label="Todo title"
    disabled={quickSaving}
    use:autofocusIf={focusOnMount}
    oninput={clearStaleError}
    onfocus={() => (quickFocused = true)}
    onblur={() => (quickFocused = false)}
    onkeydown={(e) => {
      if (
        e.key !== 'Enter' ||
        !(e.metaKey || e.ctrlKey) ||
        e.altKey ||
        !canCaptureTodo(quickTitle)
      ) {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) {
        // Shortcut-created todos always start unfiled. The selected/fixed
        // collection still applies to plain-Enter quick saves.
        // The soft plan picked here travels with the title into the editor.
        onopenmodal(quickTitle, null, pendingPlan);
        quickTitle = '';
        pendingPlan = null;
      } else {
        // ⌘/Ctrl-Enter on a typed title saves it like plain Enter. Claiming
        // the event keeps it from the global handler, which would otherwise
        // open an empty "new note" modal on top of the save.
        void addQuickTodo();
      }
    }}
  />
  {#if !fixedCollectionId}
    <!-- One grid cell: the chip, plus a ✕ while it points at a collection.
         The composer keeps the last pick (see todo-destination.ts), so the
         chip is tinted to make that visible and the ✕ undoes it. -->
    <span class="quick-add__dest">
    <button
      type="button"
      class="quick-add__collection"
      class:is-hidden-pick={chip.hidden}
      class:is-set={chip.set}
      style:--chip-color={chip.color}
      aria-label={chip.hidden
        ? `File into collection — ${chip.name} is hidden by your filter`
        : chip.set
          ? `File into collection — adding to ${chip.name}`
          : 'File into collection'}
      aria-haspopup="dialog"
      aria-expanded={pickerOpen}
      disabled={quickSaving}
      onclick={() => (pickerOpen = true)}
    >
      <span
        class="chip-dot"
        style="background: {chip.color}"
        aria-hidden="true"
      ></span>
      <span class="chip-name">{chip.name}</span>
      {#if chip.hidden}
        <!-- Eye-off: this destination is outside the filtered view. -->
        <svg
          aria-hidden="true"
          class="chip-hidden"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path>
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      {/if}
      <svg
        aria-hidden="true"
        class="chip-chevron"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
    {#if chip.set}
      <button
        type="button"
        class="quick-add__clear"
        aria-label="Clear collection — add as Unfiled"
        title="Add as Unfiled"
        disabled={quickSaving}
        onclick={() => handlePick(undefined)}
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    {/if}
    </span>
  {/if}
  <button
    type="button"
    class="quick-add__when"
    class:has-time={!!pendingSchedule || !!pendingPlan}
    aria-label={pendingSchedule
      ? `Scheduled ${whenLabel} — change time`
      : pendingPlan
        ? `Planned for ${whenLabel} — change`
        : 'Set a time or plan'}
    aria-haspopup="dialog"
    aria-expanded={scheduleOpen}
    disabled={quickSaving}
    onclick={() => (scheduleOpen = true)}
  >
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
    <span class="chip-name">{whenLabel}</span>
  </button>
  <button type="submit" disabled={!canCaptureTodo(quickTitle) || quickSaving}>
    {quickSaving ? 'Adding...' : 'Add'}
  </button>
</form>
<p class="quick-error" role="status" aria-live="polite">{quickError}</p>
<!-- Always rendered with a fixed height so the hint never shifts content. -->
<div class="quick-hint" class:quick-add--hide-mobile={hideOnMobile}>
  {#if quickFocused && quickTitle.trim()}
    <span>↵ {fixedCollectionId ? 'Add todo' : `Add to ${destinationLabel}`}</span>
    <span class="sep">·</span>
    <span>{mod}⇧↵ Open editor</span>
  {/if}
</div>

{#if pickerOpen}
  <CollectionPicker
    item={pickerSubject}
    mode="todo"
    hiddenCollectionIds={$hiddenCollectionIds}
    onpick={handlePick}
    onclose={() => (pickerOpen = false)}
  />
{/if}

{#if scheduleOpen}
  <ScheduleSheet
    subject={{ title: quickTitle, isTodo: true }}
    initial={pendingSchedule}
    initialPlan={pendingPlan}
    onpick={handleSchedulePick}
    onplanpick={handlePlanPick}
    onclose={() => (scheduleOpen = false)}
  />
{/if}

<style>
  .quick-add {
    /* Full width so the input matches the rows below it; no jump between the
       empty and populated states. Column auto-flow lets the chip set vary
       (destination chip hidden for fixed collections, When chip always)
       without enumerating template columns per variant. */
    width: 100%;
    display: grid;
    grid-auto-flow: column;
    grid-template-columns: minmax(0, 1fr);
    grid-auto-columns: auto;
    gap: 0.5rem;
    align-items: center;
  }

  .quick-add--compact {
    gap: 0.4rem;
  }

  .quick-add--compact input {
    min-height: 2.25rem;
  }

  .quick-add--compact button {
    min-height: 2.25rem;
    padding: 0 0.85rem;
    font-size: 0.88rem;
  }

  .quick-add input {
    min-height: 2.75rem;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    padding: 0 0.9rem;
    font: inherit;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    transition: border-color 150ms, box-shadow 150ms;
  }

  .quick-add input:focus-visible {
    outline: none;
    /* Border-only on focus (no glow ring), matching the inbox capture bar. */
    border-color: var(--accent);
  }

  .quick-add button {
    min-height: 2.75rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: white;
    padding: 0 1rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 150ms, transform 150ms, box-shadow 150ms;
  }

  .quick-add button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .quick-add button:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 3px;
  }

  .quick-add button:disabled,
  .quick-add input:disabled,
  .quick-add__collection:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* Chip-style trigger for the shared CollectionPicker — same box as the
     old native select, but speaks the app's location language (colored dot
     + name). Capped width so long names truncate instead of pushing the
     Add button off-screen. Selector carries the `button` element so it
     out-specifies the `.quick-add button` submit styling above (accent
     fill, hover lift) that would otherwise swallow the chip. */
  .quick-add button.quick-add__collection {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.75rem;
    max-width: 12rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    padding: 0 0.7rem;
    font: inherit;
    font-weight: 400;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    transition: border-color 150ms, box-shadow 150ms;
  }

  .quick-add button.quick-add__collection:hover:not(:disabled) {
    border-color: var(--accent);
    transform: none;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }

  .quick-add button.quick-add__collection:focus-visible {
    outline: none;
    border-color: var(--accent);
  }

  .chip-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .chip-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-chevron {
    flex-shrink: 0;
    opacity: 0.6;
    color: var(--text-muted);
  }

  /* A deliberate pick outside the filtered view reads muted, with the eye-off
     mark carrying the "hidden" meaning so the chip needs no extra words. */
  .quick-add__dest {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }

  /* A remembered collection: tinted in its colour so it isn't missed. */
  .quick-add button.quick-add__collection.is-set {
    border-color: var(--chip-color);
    background: color-mix(in srgb, var(--chip-color) 14%, var(--surface));
  }

  .quick-add button.quick-add__clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .quick-add button.quick-add__clear:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
    transform: none;
    box-shadow: none;
  }

  .quick-add button.quick-add__collection.is-hidden-pick {
    color: var(--text-muted);
    border-style: dashed;
  }

  .chip-hidden {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .quick-add--compact button.quick-add__collection {
    min-height: 2.25rem;
    /* Keep >=1rem (inherited) so iOS Safari doesn't auto-zoom on focus — the
       guideline forbids sub-1rem font-size on form controls. */
  }

  /* "When?" chip — same chrome as the destination chip; accent-tinted once
     a time is set so the pending schedule reads at a glance. */
  .quick-add button.quick-add__when {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.75rem;
    max-width: 11rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
    padding: 0 0.7rem;
    font: inherit;
    font-weight: 400;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    transition: border-color 150ms, color 150ms, box-shadow 150ms;
  }

  .quick-add button.quick-add__when:hover:not(:disabled) {
    border-color: var(--accent);
    transform: none;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }

  .quick-add button.quick-add__when:focus-visible {
    outline: none;
    border-color: var(--accent);
  }

  .quick-add button.quick-add__when.has-time {
    border-color: var(--accent-subtle-strong);
    background: var(--accent-subtler);
    color: var(--accent-text);
  }

  .quick-add--compact button.quick-add__when {
    min-height: 2.25rem;
  }

  .quick-error {
    margin: 0;
    color: var(--danger-text);
    font-size: 0.82rem;
  }

  /* Collapse the live region visually when there's no message — the element
     stays mounted so screen readers keep tracking it. */
  .quick-error:empty {
    display: none;
  }

  .quick-hint {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    /* Fixed height so the hint appearing on focus never shifts content. */
    min-height: 1.4rem;
    margin-top: 0.2rem;
    /* Left-align under the input's text (matches the input's horizontal
       padding) so the hint sits beneath what you're typing, not centered. */
    padding-left: 0.9rem;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .quick-hint .sep {
    opacity: 0.4;
  }

  /* The Todos page hides the inline composer on mobile (the floating Fab is the
     capture surface there). The collection view keeps it — it has no Fab. */
  @media (max-width: 768px) {
    .quick-add--hide-mobile {
      display: none;
    }
  }
</style>
