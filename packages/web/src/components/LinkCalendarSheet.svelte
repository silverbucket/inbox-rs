<script lang="ts">
  import type { Collection } from '@inbox-rs/rs-module';
  import type { Component } from 'svelte';
  import { portal, trapFocus } from '../lib/actions';
  import { CaldavError, type RemoteEntry } from '../lib/caldav';
  import {
    type CalendarChoice,
    calendarAccounts,
    choiceForCalendar,
  } from '../lib/calendar-accounts';
  import {
    calendarCardCount,
    cardsToAdd,
    itemFieldsFromEntry,
    type LinkPreview,
    linkCollection,
    linkedCollection,
    previewLink,
    unlinkCollection,
  } from '../lib/calendar-sync';
  import { loadLazy } from '../lib/lazy-load';
  import { formatScheduled, isOverdue } from '../lib/schedule';
  import { collections, items } from '../lib/stores';
  import { showToast } from '../lib/toast';

  /**
   * Link a collection to a calendar — or, from Settings, a calendar to a
   * collection. Shows exactly what will come in (today onward) before
   * anything is imported, lets the user skip entries, and decides whether
   * the collection's own todos and dated cards go to the calendar.
   */
  let {
    collection: initialCollection,
    calendarId: initialCalendarId,
    onclose,
  }: {
    collection?: Collection;
    /** Preselect a calendar (from Settings → Calendars). */
    calendarId?: string;
    onclose: () => void;
  } = $props();

  let collectionId = $state(initialCollection?.id ?? '');
  const collection = $derived(collectionId ? $collections[collectionId] : undefined);
  const linked = $derived(collection?.calendar);
  let choice = $state<CalendarChoice | undefined>(
    initialCalendarId ? choiceForCalendar(initialCalendarId) : undefined,
  );
  let preview = $state<LinkPreview | null>(null);
  let loading = $state(false);
  let loadError = $state('');
  let saving = $state(false);
  let confirmUnlink = $state(false);
  let reviewing = $state<'event' | 'task' | null>(null);
  let skipped = $state<Set<string>>(new Set());
  let addExisting = $state(true);
  let includeEvents = $state(true);
  let includeTasks = $state(true);

  const groups = $derived(
    $calendarAccounts
      .map((account) => ({
        account,
        calendars: account.calendars.filter(
          (c) => !account.hiddenCalendarIds?.includes(c.id),
        ),
      }))
      .filter((g) => g.calendars.length > 0),
  );

  const openCollections = $derived(
    Object.values($collections)
      .filter((c) => !c.archived)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  function linkedElsewhere(calendarUrl: string): Collection | undefined {
    const other = linkedCollection(calendarUrl, $collections);
    return other && other.id !== collectionId ? other : undefined;
  }

  let loadSeq = 0;

  async function load(next: CalendarChoice) {
    const seq = ++loadSeq;
    choice = next;
    preview = null;
    loadError = '';
    skipped = new Set();
    reviewing = null;
    loading = true;
    try {
      const result = await previewLink(next);
      if (seq === loadSeq) preview = result; // ignore a superseded pick
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error('Calendar preview failed', err);
      loadError =
        err instanceof CaldavError || err instanceof Error
          ? err.message
          : 'Couldn’t reach the calendar';
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    // Opened from Settings with a calendar but no collection: wait for the
    // collection pick. Opened with both: preview straight away.
    if (choice && collection && !preview && !loading && !loadError && !linked) {
      void load(choice);
    }
  });

  const events = $derived(preview?.events ?? []);
  const tasks = $derived(preview?.tasks ?? []);
  const overdue = $derived(
    tasks.filter((t) => {
      const f = itemFieldsFromEntry(t);
      return isOverdue({ ...f, completed: false } as never);
    }).length,
  );
  const undated = $derived(tasks.filter((t) => !t.due).length);
  const existingCount = $derived(
    preview
      ? [...events, ...tasks].filter(
          (e) => preview?.existing[e.id] && isChosen(e),
        ).length
      : 0,
  );
  const ownCards = $derived(
    collection && choice ? cardsToAdd(collection, choice.calendar.components) : [],
  );

  function isChosen(entry: RemoteEntry): boolean {
    if (skipped.has(entry.id)) return false;
    return entry.type === 'event' ? includeEvents : includeTasks;
  }

  const chosenCount = $derived(
    [...events, ...tasks].filter((e) => isChosen(e)).length,
  );

  function toggleEntry(id: string) {
    const next = new Set(skipped);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    skipped = next;
  }

  function whenLabel(entry: RemoteEntry): string {
    const fields = itemFieldsFromEntry(entry);
    if (!fields.startsAt) return entry.type === 'task' ? 'No due date' : '';
    return formatScheduled(fields as never);
  }

  async function confirm(importAll: boolean) {
    if (!collection || !preview || saving) return;
    saving = true;
    try {
      const importIds = new Set(
        importAll
          ? [...events, ...tasks].filter((e) => isChosen(e)).map((e) => e.id)
          : [],
      );
      const name = preview.choice.calendar.name;
      const count = await linkCollection(collection, preview, {
        importIds,
        addExisting,
      });
      showToast(
        count > 0
          ? `Linked to ${name} — brought in ${count} ${count === 1 ? 'card' : 'cards'}`
          : `Linked to ${name}`,
      );
      onclose();
    } catch (err) {
      console.error('Linking failed', err);
      showToast(
        `Couldn’t link: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      saving = false;
    }
  }

  async function unlink() {
    if (!collection) return;
    if (!confirmUnlink) {
      confirmUnlink = true;
      return;
    }
    saving = true;
    try {
      const name = collection.calendar?.name ?? 'the calendar';
      await unlinkCollection(collection);
      showToast(`Unlinked from ${name} — cards and entries stay where they are`);
      onclose();
    } catch (err) {
      console.error('Unlinking failed', err);
      showToast('Couldn’t unlink — try again');
    } finally {
      saving = false;
    }
  }

  // Connecting the first account right here, like AddToCalendarSheet.
  type SettingsModal = Component<{ onclose: () => void; onconnected?: () => void }>;
  let SettingsComponent = $state<SettingsModal | null>(null);
  let showSettings = $state(false);
  async function openSettings() {
    SettingsComponent ??= await loadLazy<SettingsModal>(
      () => import('./CalendarSettingsModal.svelte'),
    );
    if (SettingsComponent) showSettings = true;
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || showSettings) return;
    // The sheet is on top: forms underneath must not also close.
    e.stopPropagation();
    if (saving) return;
    if (reviewing) {
      reviewing = null;
      return;
    }
    onclose();
  }

  const linkedCount = $derived.by(() => {
    void $items; // recount as cards change
    return linked ? calendarCardCount(linked.url) : 0;
  });
  const pastNote =
    'Events ending today or later, plus every open task — overdue and undated too. Unticked entries stay out unless they change later.';

  /** Exactly what "Link calendar" will do, in one line. */
  const summary = $derived.by(() => {
    const n = chosenCount;
    const own = addExisting ? ownCards.length : 0;
    const cal = preview?.choice.calendar.name ?? '';
    const entries = `${n} ${n === 1 ? 'entry' : 'entries'}`;
    const cards = `${own} ${own === 1 ? 'card' : 'cards'}`;
    if (n && own) return `Brings in ${entries} and adds ${cards} to the ${cal} calendar. New ones keep arriving.`;
    if (n) return `Brings in ${entries}. New ones keep arriving.`;
    if (own) return `Adds ${cards} to the ${cal} calendar. New entries arrive from now on.`;
    return 'Links only. New entries arrive from now on.';
  });

  function isEntryOverdue(entry: RemoteEntry): boolean {
    if (entry.type !== 'task') return false;
    const f = itemFieldsFromEntry(entry);
    return isOverdue({ ...f, completed: false } as never);
  }
</script>

<svelte:window onkeydowncapture={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" use:portal onclick={() => !saving && onclose()} style:visibility={showSettings ? 'hidden' : undefined}>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="link-cal-title"
    use:trapFocus
    onclick={(e) => e.stopPropagation()}
  >
    <div class="grab" aria-hidden="true"></div>
    <header class="top">
      <h3 id="link-cal-title">
        {#if linked}
          “{collection?.name}” is linked
        {:else if collection}
          Link “{collection.name}” to a calendar
        {:else if choice}
          Link {choice.calendar.name} to a collection
        {:else}
          Link a calendar
        {/if}
      </h3>
      <button type="button" class="icon-btn" aria-label="Close" onclick={onclose} disabled={saving}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </header>

    {#if linked && collection}
      <!-- Already linked: say what that means, offer the way out. -->
      <div class="linked-card" style="--cal-color: {linked.color || 'var(--accent)'}">
        <svg class="swatch" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>
        <div class="linked-text">
          <strong>{linked.name} calendar</strong>
          <span>{linkedCount} {linkedCount === 1 ? 'card' : 'cards'} kept in sync</span>
        </div>
      </div>
      <ul class="rules">
        <li>New events and open tasks in the {linked.name} calendar arrive in the <strong>{collection.name}</strong> collection.</li>
        <li>Todos and dated cards filed here are added to the {linked.name} calendar.</li>
        <li>Edits sync both ways. If both sides change, the calendar wins — with Undo.</li>
      </ul>
      {#if confirmUnlink}
        <p class="note warn">
          Cards stay in the {collection.name} collection and their entries stay in the
          {linked.name} calendar. They just stop syncing.
        </p>
      {/if}
      <div class="footer">
        <button type="button" class="btn ghost" onclick={onclose} disabled={saving}>Done</button>
        <button type="button" class="btn danger" class:solid={confirmUnlink} onclick={unlink} disabled={saving}>
          {confirmUnlink ? 'Unlink now' : 'Unlink…'}
        </button>
      </div>
    {:else if groups.length === 0}
      <p class="note">Connect a calendar account to link it here. Your app password stays on this device.</p>
      <div class="footer">
        <button type="button" class="btn ghost" onclick={onclose}>Not now</button>
        <button type="button" class="btn primary" onclick={openSettings}>Connect an account</button>
      </div>
    {:else}
      {#if !initialCollection}
        <label class="field">
          <span class="field-label">Collection</span>
          <select bind:value={collectionId} disabled={saving} onchange={() => { preview = null; loadError = ''; }}>
            <option value="" disabled>Choose a collection…</option>
            {#each openCollections as c (c.id)}
              <option value={c.id} disabled={!!c.calendar}>
                {c.name}{c.calendar ? ` — linked to ${c.calendar.name}` : ''}
              </option>
            {/each}
          </select>
        </label>
      {/if}

      {#if !initialCalendarId || !choice}
        <div class="field">
          <div class="cal-list" role="radiogroup" aria-label="Calendar">
            {#each groups as group (group.account.id)}
              <div class="grp">{group.account.label}</div>
              {#each group.calendars as cal (cal.id)}
                {@const other = linkedElsewhere(cal.id)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={choice?.calendar.id === cal.id}
                  class="cal-row"
                  class:sel={choice?.calendar.id === cal.id}
                  disabled={!!other || saving}
                  onclick={() => (collection ? load({ account: group.account, calendar: cal }) : (choice = { account: group.account, calendar: cal }))}
                >
                  <svg style="color: {cal.color || 'var(--accent)'}" class="dot" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>
                  <span class="cal-name">{cal.name}</span>
                  <span class="cal-meta">
                    {#if other}
                      Linked to {other.name}
                    {:else if cal.components.length === 1}
                      {cal.components[0] === 'event' ? 'Events only' : 'Tasks only'}
                    {/if}
                  </span>
                </button>
              {/each}
            {/each}
          </div>
        </div>
      {:else if choice}
        <div class="linked-card compact" style="--cal-color: {choice.calendar.color || 'var(--accent)'}">
          <svg class="swatch" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>
          <div class="linked-text"><strong>{choice.calendar.name}</strong><span>{choice.account.label}</span></div>
        </div>
      {/if}

      {#if loading}
        <div class="loading" role="status">
          <span class="spinner" aria-hidden="true"></span>
          Checking {choice?.calendar.name} for upcoming events and open tasks…
        </div>
      {:else if loadError}
        <div class="problem" role="status">
          {loadError}
          {#if choice}<button type="button" class="link-btn" onclick={() => choice && load(choice)}>Try again</button>{/if}
        </div>
      {:else if preview && collection}
        <div class="preview">
          <p class="eyebrow">From the {preview.choice.calendar.name} calendar</p>
          {#if events.length === 0 && tasks.length === 0}
            <p class="note">Nothing upcoming right now. New entries will arrive as they're added.</p>
          {/if}
          {#if events.length > 0}
            <div class="opt">
              <label class="check">
                <input type="checkbox" bind:checked={includeEvents} disabled={saving} />
                <span><strong>{events.length}</strong> upcoming {events.length === 1 ? 'event' : 'events'}</span>
              </label>
              <button type="button" class="link-btn" aria-expanded={reviewing === 'event'} onclick={() => (reviewing = reviewing === 'event' ? null : 'event')}>
                {reviewing === 'event' ? 'Hide' : 'Review'}
              </button>
            </div>
            {#if reviewing === 'event'}
              <ul class="review">
                {#each events as entry (entry.id)}
                  <li>
                    <label>
                      <input type="checkbox" checked={includeEvents && !skipped.has(entry.id)} disabled={!includeEvents} onchange={() => toggleEntry(entry.id)} />
                      <span class="r-title">{entry.name}</span>
                      <span class="r-when" class:overdue={isEntryOverdue(entry)}>{whenLabel(entry)}{isEntryOverdue(entry) ? ' · overdue' : ''}</span>
                    </label>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
          {#if tasks.length > 0}
            <div class="opt">
              <label class="check">
                <input type="checkbox" bind:checked={includeTasks} disabled={saving} />
                <span>
                  <strong>{tasks.length}</strong> open {tasks.length === 1 ? 'task' : 'tasks'}
                  {#if overdue || undated}
                    <span class="sub">({[overdue ? `${overdue} overdue` : '', undated ? `${undated} undated` : ''].filter(Boolean).join(', ')})</span>
                  {/if}
                </span>
              </label>
              <button type="button" class="link-btn" aria-expanded={reviewing === 'task'} onclick={() => (reviewing = reviewing === 'task' ? null : 'task')}>
                {reviewing === 'task' ? 'Hide' : 'Review'}
              </button>
            </div>
            {#if reviewing === 'task'}
              <ul class="review">
                {#each tasks as entry (entry.id)}
                  <li>
                    <label>
                      <input type="checkbox" checked={includeTasks && !skipped.has(entry.id)} disabled={!includeTasks} onchange={() => toggleEntry(entry.id)} />
                      <span class="r-title">{entry.name}</span>
                      <span class="r-when" class:overdue={isEntryOverdue(entry)}>{whenLabel(entry)}{isEntryOverdue(entry) ? ' · overdue' : ''}</span>
                    </label>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
          {#if existingCount > 0}
            <p class="note">{existingCount} of these {existingCount === 1 ? 'is' : 'are'} already cards — {existingCount === 1 ? 'it moves' : 'they move'} into {collection.name}.</p>
          {/if}
          <p class="note subtle">{pastNote}</p>
          {#if ownCards.length > 0}
            <p class="eyebrow out">To the {preview.choice.calendar.name} calendar</p>
            <div class="opt own">
              <label class="check">
                <input type="checkbox" bind:checked={addExisting} disabled={saving} />
                <span><strong>{ownCards.length}</strong> {ownCards.length === 1 ? 'card' : 'cards'} from this collection <span class="sub">(todos and dated cards)</span></span>
              </label>
            </div>
          {/if}
        </div>
        <div class="footer">
          <p class="summary" aria-live="polite">{summary}</p>
          <button type="button" class="btn ghost" onclick={onclose} disabled={saving}>Cancel</button>
          <button type="button" class="btn primary" onclick={() => confirm(true)} disabled={saving}>
            {saving ? 'Linking…' : 'Link calendar'}
          </button>
        </div>
      {:else if !collection && choice}
        <p class="note subtle">Choose the collection {choice.calendar.name}'s entries should arrive in.</p>
      {/if}
    {/if}
  </div>
</div>

{#if showSettings && SettingsComponent}
  <SettingsComponent onclose={() => (showSettings = false)} onconnected={() => (showSettings = false)} />
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    z-index: 320;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .sheet {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 440px;
    max-height: min(88dvh, 720px);
    overflow-y: auto;
    padding: 1.1rem 1.2rem 1rem;
    box-shadow: 0 16px 48px var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .grab {
    display: none;
  }

  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h3 {
    font-size: 1.05rem;
    font-weight: 650;
    line-height: 1.3;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field-label,
  .eyebrow,
  .grp {
    margin: 0;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .grp {
    margin: 0.2rem 0 0.1rem 0.6rem;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .eyebrow.out {
    margin-top: 0.5rem;
  }

  .r-when.overdue {
    color: var(--danger-text);
    font-weight: 600;
  }

  select {
    min-height: 44px;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }

  .cal-list {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-height: 15rem;
    overflow-y: auto;
  }

  .cal-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 44px;
    padding: 0.4rem 0.6rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
  }

  .cal-row:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .cal-row.sel {
    border-color: var(--accent);
    background: var(--accent-subtler, color-mix(in srgb, var(--accent) 10%, transparent));
  }

  .cal-row:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .dot {
    flex-shrink: 0;
  }

  .cal-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }

  .cal-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .linked-card {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.75rem 0.85rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--cal-color) 35%, var(--border));
    background: color-mix(in srgb, var(--cal-color) 8%, var(--surface));
  }

  .linked-card.compact {
    padding: 0.55rem 0.75rem;
  }

  .swatch {
    color: var(--cal-color);
    flex-shrink: 0;
  }

  .linked-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .linked-text span {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .rules {
    margin: 0;
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.84rem;
    line-height: 1.45;
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-top: 1px solid var(--border);
    padding-top: 0.85rem;
  }

  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .opt.own {
    margin-top: 0.15rem;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    font-size: 0.9rem;
    line-height: 1.4;
    cursor: pointer;
    min-height: 32px;
    padding-top: 0.2rem;
  }

  .check input,
  .review input {
    width: 17px;
    height: 17px;
    margin-top: 0.1rem;
    accent-color: var(--accent);
    flex-shrink: 0;
  }

  .sub {
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  .review {
    list-style: none;
    margin: 0 0 0.25rem 1.6rem;
    padding: 0.25rem 0;
    max-height: 13rem;
    overflow-y: auto;
    border-left: 2px solid var(--border);
  }

  .review label {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.84rem;
    cursor: pointer;
    min-height: 36px;
  }

  .r-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .r-when {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .note {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--text);
  }

  .note.subtle {
    color: var(--text-muted);
    font-size: 0.78rem;
  }

  .note.warn {
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-sm);
    background: var(--surface-tint);
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    padding: 0.5rem 0;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .problem {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.6rem;
    align-items: center;
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger-text);
    font-size: 0.84rem;
  }

  .link-btn {
    border: 0;
    background: none;
    padding: 0.2rem 0.1rem;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent-text);
    cursor: pointer;
    min-height: 32px;
    flex-shrink: 0;
  }

  .problem .link-btn {
    color: inherit;
    text-decoration: underline;
  }

  .summary {
    flex-basis: 100%;
    margin: 0;
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-sm);
    background: var(--surface-tint);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .footer {
    position: sticky;
    bottom: -1rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    margin: 0 -1.2rem -1rem;
    padding: 0.7rem 1.2rem 1rem;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }

  .btn {
    min-height: 40px;
    padding: 0.45rem 0.95rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.86rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .btn.ghost:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn.danger {
    color: var(--danger-text);
  }

  .btn.danger.solid {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }

  /* Phones: a bottom sheet, thumb-reachable, full width. */
  @media (max-width: 600px) {
    .overlay {
      align-items: flex-end;
      padding: 0;
    }

    .sheet {
      max-width: none;
      max-height: 92dvh;
      border-radius: 16px 16px 0 0;
      border-bottom: 0;
      padding: 0.5rem 1rem calc(1rem + env(safe-area-inset-bottom));
    }

    .grab {
      display: block;
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: var(--border);
      margin: 0.1rem auto 0.2rem;
    }

    .footer {
      bottom: calc(-1rem - env(safe-area-inset-bottom));
      margin: 0 -1rem calc(-1rem - env(safe-area-inset-bottom));
      padding: 0.7rem 1rem calc(1rem + env(safe-area-inset-bottom));
    }

    .footer .btn {
      flex: 1;
      min-height: 46px;
    }
  }
</style>
