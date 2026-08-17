<script lang="ts">
  /**
   * Quick-add todo composer, shared by the Todos page and the collection
   * view's Todos section. Plain Enter files a todo instantly; ⌘/Ctrl-Enter
   * opens the full modal pre-filled (via `onopenmodal`), mirroring the inbox
   * capture bar.
   *
   * When `fixedCollectionId` is set (collection view), todos are filed there
   * and the collection select is hidden. Otherwise the select lets the user
   * pick a destination, persisted per-device.
   */
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { canCaptureTodo, makeUnfiledTodo } from '../lib/add-entry-modal';
  import { autofocusIf } from '../lib/actions';
  import { modLabel } from '../lib/platform';
  import { showToast } from '../lib/toast';
  import type { FilingSubject } from '../lib/collection-suggest';
  import { formatScheduled, type PendingSchedule } from '../lib/schedule';
  import { applyPendingSchedule } from '../lib/schedule-sync';
  import CollectionPicker from './CollectionPicker.svelte';
  import ScheduleSheet from './ScheduleSheet.svelte';
  import {
    activeGroupIds,
    collections,
    moveItemToCollection,
    sortedGroups,
    storeItem,
    toggleGroupFilter,
  } from '../lib/stores';

  let {
    fixedCollectionId = undefined,
    compact = false,
    hideOnMobile = false,
    focusOnMount = false,
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
    /** ⌘/Ctrl-Enter — open the full todo modal pre-filled with the title and
        the resolved target collection. `null` when that target is Unfiled: the
        chip is a visible choice, so the modal must not swap in a remembered
        collection behind it. */
    onopenmodal: (prefillTitle: string, collectionId: string | null) => void;
  } = $props();

  let quickTitle = $state('');
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

  // Per-device quick-add destination (hidden when a fixed collection is given).
  // localStorage rather than synced config so a stale remote copy can't clobber
  // a just-set local value.
  const QUICK_ADD_KEY = 'inbox-rs:quickAddCollectionId';
  function readStoredQuickAddId(): string | undefined {
    try {
      return localStorage.getItem(QUICK_ADD_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }
  let storedQuickAddId = $state<string | undefined>(readStoredQuickAddId());
  // Whether the user has actively chosen a destination in this composer
  // instance. Distinguishes a deliberate in-session pick (honored verbatim,
  // even into a hidden group) from the passively-restored default (guarded
  // below). Resets on remount, so a stale hidden default never silently
  // reapplies across reloads.
  let userPicked = $state(false);

  /** True when the collection exists, belongs to a known group, and that group
   *  is currently filtered out of view — i.e. filing here makes the todo
   *  vanish from the list. Ungrouped/orphan collections are never hidden. */
  function isOutOfView(id: string | undefined): boolean {
    const gid = id ? collectionMap[id]?.groupId : undefined;
    return !!gid && !!groupMap()[gid] && !$activeGroupIds.has(gid);
  }

  // The remembered preference, if it still resolves to a real collection.
  const pickedId = $derived(
    storedQuickAddId && collectionMap[storedQuickAddId]
      ? storedQuickAddId
      : undefined,
  );
  // The passive default never targets a hidden group: a plain-Enter add would
  // file the todo where it can't be seen. Falls back to Unfiled instead.
  const defaultCollectionId = $derived(
    pickedId && isOutOfView(pickedId) ? undefined : pickedId,
  );
  // Live select value: an explicit in-session pick wins (you may deliberately
  // file into a hidden group — addQuickTodo surfaces a "Show" toast for that);
  // otherwise use the guarded default.
  const quickAddCollectionId = $derived(userPicked ? pickedId : defaultCollectionId);
  function setQuickAddCollection(id: string | undefined) {
    storedQuickAddId = id;
    userPicked = true;
    try {
      if (id) localStorage.setItem(QUICK_ADD_KEY, id);
      else localStorage.removeItem(QUICK_ADD_KEY);
    } catch (error) {
      console.error('Failed to persist quick-add collection', error);
    }
  }

  const targetCollectionId = $derived(fixedCollectionId ?? quickAddCollectionId);

  // ── Destination picker (shared CollectionPicker, chip trigger) ─────────
  let pickerOpen = $state(false);

  // ── Optional capture-time schedule ("When?" chip → ScheduleSheet) ──────
  let pendingSchedule = $state<PendingSchedule | null>(null);
  let scheduleOpen = $state(false);

  const whenLabel = $derived(
    pendingSchedule
      ? formatScheduled({
          startsAt: pendingSchedule.start.toISOString(),
          allDay: pendingSchedule.allDay,
        })
      : 'When?',
  );

  function handleSchedulePick(schedule: PendingSchedule | null) {
    pendingSchedule = schedule;
    scheduleOpen = false;
    quickInputEl?.focus();
  }

  /** Chip display parts for the current quick-add destination. */
  const chip = $derived.by(() => {
    const col = quickAddCollectionId
      ? collectionMap[quickAddCollectionId]
      : undefined;
    if (!col) return { name: 'Unfiled', color: '#9ca3af' };
    return { name: col.name, color: col.color || '#6366f1' };
  });

  /** What the picker files: the composed title feeds name-match suggestions. */
  const pickerSubject = $derived<FilingSubject>({
    title: quickTitle,
    collectionId: quickAddCollectionId,
    isTodo: true,
  });

  function handlePick(id: string | undefined) {
    setQuickAddCollection(id);
    pickerOpen = false;
    // Hand focus back to the title so capture flow isn't interrupted.
    quickInputEl?.focus();
  }

  // Where plain Enter will file the todo, shown in the hint while composing so
  // the destination is predictable before submitting. Flags an out-of-view
  // target so an explicit hidden pick isn't a surprise.
  const destinationLabel = $derived.by(() => {
    const id = targetCollectionId;
    const col = id ? collectionMap[id] : undefined;
    if (!col) return 'Unfiled';
    const group = col.groupId ? groupMap()[col.groupId] : undefined;
    const base = group ? `${group.name} › ${col.name}` : col.name;
    return isOutOfView(id) ? `${base} (hidden)` : base;
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
    try {
      const todo = makeUnfiledTodo(quickTitle);
      await storeItem(todo);
      created = true;
      quickTitle = '';
      // Separate step keeps collection.itemIds in sync, matching AddEntryModal.
      if (targetCollectionId) {
        await moveItemToCollection(todo.id, targetCollectionId);
        notifyIfOutOfView(targetCollectionId);
      }
      filed = true;
      if (pendingSchedule) {
        // Apply after the move so the stored item keeps its collectionId.
        // Posts to the picked calendar best-effort (local-first, toasts on
        // failure) — see applyPendingSchedule.
        await applyPendingSchedule(
          targetCollectionId
            ? { ...todo, collectionId: targetCollectionId }
            : todo,
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
      if (created) pendingSchedule = null;
      quickSaving = false;
      // Return focus so the user can keep capturing; tick() lets a hero→compact
      // remount settle before refocusing the (new) element.
      await tick();
      quickInputEl?.focus();
    }
  }

  // After filing into a collection whose group is filtered out of view, the
  // todo is intact but invisible here. Confirm where it went and offer a
  // one-tap reveal so it never feels like it vanished — no after-the-fact edit.
  function notifyIfOutOfView(collectionId: string) {
    if (!isOutOfView(collectionId)) return;
    const col = collectionMap[collectionId];
    const gid = col?.groupId;
    if (!gid) return;
    showToast(`Added to ${col.name} — hidden from this view`, {
      label: 'Show',
      // Guard against a double-toggle if the group was revealed meanwhile.
      run: () => {
        if (get(activeGroupIds).has(gid)) return;
        // A failed config write would otherwise be an unhandled rejection;
        // tell the user the reveal didn't take so they can retry.
        void toggleGroupFilter(gid).catch((error) => {
          console.error('Failed to reveal hidden group', error);
          showToast('Could not show the group. Please try again.');
        });
      },
    });
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
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey) &&
        canCaptureTodo(quickTitle)
      ) {
        e.preventDefault();
        onopenmodal(quickTitle, targetCollectionId ?? null);
        quickTitle = '';
      }
    }}
  />
  {#if !fixedCollectionId}
    <button
      type="button"
      class="quick-add__collection"
      aria-label="File into collection"
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
  {/if}
  <button
    type="button"
    class="quick-add__when"
    class:has-time={!!pendingSchedule}
    aria-label={pendingSchedule
      ? `Scheduled ${whenLabel} — change time`
      : 'Set a time'}
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
<div class="quick-hint">
  {#if quickFocused && quickTitle.trim()}
    <span>↵ {fixedCollectionId ? 'Add todo' : `Add to ${destinationLabel}`}</span>
    <span class="sep">·</span>
    <span>{mod}↵ Open editor</span>
  {/if}
</div>

{#if pickerOpen}
  <CollectionPicker
    item={pickerSubject}
    mode="todo"
    onpick={handlePick}
    onclose={() => (pickerOpen = false)}
  />
{/if}

{#if scheduleOpen}
  <ScheduleSheet
    subject={{ title: quickTitle, isTodo: true }}
    initial={pendingSchedule}
    onpick={handleSchedulePick}
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
    outline: 2px solid var(--accent);
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
    color: var(--accent);
  }

  .quick-add--compact button.quick-add__when {
    min-height: 2.25rem;
  }

  .quick-error {
    margin: 0;
    color: var(--danger);
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
