<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import type { Component } from 'svelte';
  import { trapFocus } from '../lib/actions';
  import { CaldavError } from '../lib/caldav';
  import {
    calendarAccounts,
    type CalendarChoice,
    choiceForEventUrl,
    findCalendarChoice,
    pickPreferredCalendar,
  } from '../lib/calendar-accounts';
  import { downloadIcs } from '../lib/ics';
  import { loadLazy } from '../lib/lazy-load';
  import { formatScheduled } from '../lib/schedule';
  import {
    addItemToCalendar,
    ReceiptWriteError,
    recordCalendarUse,
    reEnableFromCalendar,
  } from '../lib/schedule-sync';
  import { updateUserSettings, userSettings } from '../lib/stores';
  import { showToast } from '../lib/toast';
  import CalendarPicker from './CalendarPicker.svelte';

  /**
   * Publishing a timed card to a calendar — the counterpart to the
   * calendar-free time sheet. Only reachable once a time is set, and
   * ONE-SHOT: posting creates the entry and inbox-rs never updates or
   * deletes it afterwards. 'Move' mode (the default) archives the item —
   * any kind — into its surface's collapsed "On calendar" section; 'Keep a
   * copy' posts without archiving. For a posted item this sheet is a
   * receipt: it shows the destination calendar and offers local-only
   * re-enable. The move/copy choice is remembered in user settings.
   */
  let {
    item,
    onclose,
  }: {
    item: InboxItem;
    onclose: () => void;
  } = $props();

  const isTodoish = item.isTodo || item.type === 'todo';
  const kind = item.scheduleKind ?? (isTodoish ? 'task' : 'event');
  const timeLabel = formatScheduled(item);
  const isPosted = !!item.eventUrl;

  // Move vs copy — initialized once from the synced preference; toggling
  // persists so the next sheet opens on the same choice.
  let postMode = $state<'move' | 'copy'>(
    $userSettings.calendarPostMode ?? 'move',
  );

  function setPostMode(mode: 'move' | 'copy') {
    postMode = mode;
    updateUserSettings({ calendarPostMode: mode }).catch((err) => {
      console.error('Failed to save calendar post mode', err);
    });
  }

  const willArchive = $derived(!isPosted && postMode === 'move');
  const archiveNote = $derived(
    isTodoish
      ? "The todo moves to the Todos page's “On calendar” section once it's on your calendar. You can re-enable it from there anytime."
      : item.collectionId
        ? "The card moves to its collection's “On calendar” section once it's on your calendar. You can re-enable it from there anytime."
        : "The card moves to the Inbox's archived section once it's on your calendar. You can re-enable it from there anytime.",
  );

  // The receipt: which calendar this item went to (undefined when the
  // account has since been removed — the entry still exists there).
  const eventHome = choiceForEventUrl(item.eventUrl);
  let selectedCalendarId = $state<string | undefined>(
    pickPreferredCalendar(kind)?.calendar.id,
  );
  let showPicker = $state(false);
  let saving = $state(false);

  // Connecting the first account happens right here rather than bouncing the
  // user out to the user menu — lazy like UserMenu's copy so the CalDAV
  // settings code stays out of this path until asked for.
  type SettingsModal = Component<{ onclose: () => void; onconnected?: () => void }>;
  let SettingsComponent = $state<SettingsModal | null>(null);
  let showSettings = $state(false);
  // While the settings chunk is in flight the modal isn't mounted yet, so the
  // Escape/overlay close guards need this to keep the sheet from closing out
  // from under the load.
  let settingsLoading = $state(false);

  async function openSettings() {
    settingsLoading = true;
    try {
      SettingsComponent ??= await loadLazy<SettingsModal>(
        () => import('./CalendarSettingsModal.svelte'),
      );
    } finally {
      settingsLoading = false;
    }
    if (SettingsComponent) showSettings = true;
  }

  // Closing the settings modal after connecting the first account lands back
  // on the posting UI — preselect a calendar so the primary button is
  // immediately actionable.
  function closeSettings() {
    showSettings = false;
    selectedCalendarId ??= pickPreferredCalendar(kind)?.calendar.id;
  }

  const hasAccounts = $derived($calendarAccounts.length > 0);
  const selectedChoice = $derived<CalendarChoice | undefined>(
    findCalendarChoice(selectedCalendarId),
  );
  const calendarSupportsKind = $derived(
    !!selectedChoice?.calendar.components.includes(kind),
  );
  const canPost = $derived(
    !saving && !!selectedChoice && calendarSupportsKind,
  );

  function handlePick(choice: CalendarChoice) {
    selectedCalendarId = choice.calendar.id;
    showPicker = false;
  }

  function friendly(err: unknown): string {
    return err instanceof CaldavError
      ? err.message
      : 'the calendar relay is unreachable';
  }

  async function post() {
    if (!canPost || !selectedChoice) return;
    saving = true;
    try {
      const posted = await addItemToCalendar(
        item,
        selectedChoice.calendar.id,
        postMode,
      );
      recordCalendarUse(kind, selectedChoice.calendar.id);
      if (posted.archived) {
        showToast(
          isTodoish
            ? 'Added to calendar — todo moved to the On-calendar section'
            : item.collectionId
              ? "Added to calendar — card moved to the collection's On-calendar section"
              : 'Added to calendar — card archived from the Inbox',
        );
      }
      onclose();
    } catch (err) {
      console.error('Calendar post failed', err);
      if (err instanceof ReceiptWriteError) {
        // The entry WAS created; only the local receipt failed. Saying
        // "couldn't add" here would invite a confused re-add.
        showToast(
          "Added to the calendar, but the app couldn't record it — the card may still offer to add it.",
        );
        onclose();
      } else {
        showToast(`Couldn't add to calendar — ${friendly(err)}`);
      }
    } finally {
      saving = false;
    }
  }

  // Local-only: clears the archive state, never touches the calendar.
  async function reEnable() {
    saving = true;
    try {
      await reEnableFromCalendar(item);
      showToast('Re-enabled — the calendar entry stays put');
      onclose();
    } catch (err) {
      console.error('Re-enable failed', err);
      showToast("Couldn't re-enable — try again");
    } finally {
      saving = false;
    }
  }

  function handleDownload() {
    downloadIcs(item);
    onclose();
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || saving || settingsLoading) return;
    if (showPicker || showSettings) return; // the overlay on top closes itself first
    onclose();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="Add to calendar" onclick={() => { if (!saving && !settingsLoading) onclose(); }}>
  <div class="sheet" use:trapFocus onclick={(e) => e.stopPropagation()}>
    <h3 class="title">{isPosted ? 'On calendar' : 'Add to calendar'}</h3>
    <p class="ctx">{item.title || 'Untitled'}</p>

    <div class="time-row">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      {timeLabel}
      <span class="kind-tag">{kind}</span>
    </div>

    {#if isPosted}
      <!-- Receipt: which calendar this went to. Read-only — publishing is
           one-shot, so there is nothing to change from here. -->
      <div class="zone static">
        {#if eventHome}
          <span
            class="dot"
            style="background: {eventHome.calendar.color || 'var(--accent)'}"
          ></span>
          <span class="zone-name">{eventHome.calendar.name}</span>
          <span class="zone-sub">· {eventHome.account.label}</span>
        {:else}
          <span class="zone-name muted">On a calendar whose account was removed</span>
        {/if}
      </div>
      {#if item.archived}
        <button type="button" class="btn-primary" disabled={saving} onclick={reEnable}>
          Re-enable in {isTodoish ? 'Todos' : item.collectionId ? 'this collection' : 'the Inbox'}
        </button>
        <p class="note">
          Brings it back under this app's management. The calendar entry is
          not touched.
        </p>
      {/if}
      <button type="button" class="btn-ghost" disabled={saving} onclick={handleDownload}>
        Download .ics
      </button>
    {:else if hasAccounts}
      <button type="button" class="zone" onclick={() => (showPicker = true)}>
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
        <p class="note">
          {selectedChoice.calendar.name} doesn't support {kind}s — pick
          another calendar.
        </p>
      {/if}
      <div class="mode-switcher" role="group" aria-label="After adding to calendar">
        <button type="button"
          class="mode-option"
          class:active={postMode === 'move'}
          aria-pressed={postMode === 'move'}
          onclick={() => setPostMode('move')}
        >
          Move
        </button>
        <button type="button"
          class="mode-option"
          class:active={postMode === 'copy'}
          aria-pressed={postMode === 'copy'}
          onclick={() => setPostMode('copy')}
        >
          Keep a copy
        </button>
      </div>
      {#if willArchive}
        <p class="note">{archiveNote}</p>
      {/if}

      <button type="button" class="btn-primary" disabled={!canPost} onclick={post}>
        {kind === 'task' ? 'Add task' : 'Add to calendar'}
      </button>
      <button type="button" class="btn-ghost" disabled={saving} onclick={handleDownload}>
        Download .ics
      </button>
    {:else}
      <p class="hint">
        No calendar connected yet. Connect an account once and cards post
        straight to it.
      </p>
      <button type="button" class="btn-primary" disabled={settingsLoading} onclick={openSettings}>
        Connect calendar account
      </button>
      <button type="button" class="btn-ghost" onclick={handleDownload}>
        Download .ics instead
      </button>
    {/if}
  </div>
</div>

{#if showPicker}
  <CalendarPicker
    {kind}
    selectedId={selectedCalendarId}
    onpick={handlePick}
    onclose={() => (showPicker = false)}
  />
{/if}

{#if SettingsComponent && showSettings}
  <SettingsComponent onclose={closeSettings} onconnected={closeSettings} />
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

  /* The time being published — read-only here; edited via the time sheet. */
  .time-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.85rem;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.65rem;
  }

  .time-row svg {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .kind-tag {
    margin-left: auto;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.02rem 0.5rem;
    font-size: 0.64rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .zone {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    margin-top: 0.7rem;
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

  .zone.static {
    cursor: default;
  }

  .zone.static:hover {
    border-color: var(--border);
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

  .note {
    margin-top: 0.5rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  /* Move / Keep-a-copy — same segmented pattern as the user menu's
     theme switcher. */
  .mode-switcher {
    display: flex;
    gap: 2px;
    margin-top: 0.7rem;
  }

  .mode-option {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.35rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: all 150ms;
  }

  .mode-option:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .mode-option.active {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .btn-primary {
    display: block;
    width: 100%;
    margin-top: 0.9rem;
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

  .btn-ghost {
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

  .btn-ghost:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .hint {
    margin-top: 0.6rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    line-height: 1.5;
  }
</style>
