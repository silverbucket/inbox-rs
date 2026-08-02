<script lang="ts">
  import {
    CaldavError,
    fetchCalendars,
    type CaldavCredentials,
  } from '../lib/caldav';
  import {
    accountEndpoint,
    addCalendarAccount,
    calendarAccounts,
    removeCalendarAccount,
    updateCalendarAccount,
    type CalendarAccount,
  } from '../lib/calendar-accounts';
  import { trapFocus } from '../lib/actions';
  import { resolveSockethubEndpoint } from '../lib/enrich';
  import { DEFAULT_SOCKETHUB_ENDPOINT } from '../lib/link-metadata';
  import { showToast } from '../lib/toast';

  let {
    onclose,
    onconnected,
  }: {
    onclose: () => void;
    /**
     * Fired after an account connects successfully. The add-to-calendar
     * sheet uses it to close the modal and return to posting; from the user
     * menu it's absent and the modal stays open on the accounts list.
     */
    onconnected?: () => void;
  } = $props();

  let showAdd = $state(false);
  let serverUrl = $state('');
  let username = $state('');
  let password = $state('');
  let connecting = $state(false);
  let connectError = $state('');
  let refreshingId = $state<string | null>(null);
  let confirmRemoveId = $state<string | null>(null);

  const canConnect = $derived(
    !!serverUrl.trim() && !!username.trim() && !!password && !connecting,
  );

  // The relay that will receive the credentials, surfaced BEFORE the user
  // presses Connect. The synced `sockethubUrl` setting decides it, and a
  // compromised linked device could have rewritten that setting — showing
  // the destination (and flagging a non-default relay) makes a redirected
  // connect visible at the moment it matters. Recomputed when the add form
  // opens; the chosen value is pinned on the account afterwards.
  let connectEndpoint = $state(resolveSockethubEndpoint());
  const endpointHost = $derived.by(() => {
    try {
      return new URL(connectEndpoint).host;
    } catch {
      return connectEndpoint;
    }
  });
  const isCustomRelay = $derived(connectEndpoint !== DEFAULT_SOCKETHUB_ENDPOINT);

  /** Accept a bare host ("caldav.fastmail.com") — discovery wants a URL. */
  function normalizeUrl(raw: string): string {
    const trimmed = raw.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  function friendlyError(err: unknown): string {
    if (err instanceof CaldavError) return err.message;
    return 'Could not reach the calendar relay — are you offline?';
  }

  async function handleConnect() {
    if (!canConnect) return;
    connecting = true;
    connectError = '';
    const creds: CaldavCredentials = {
      url: normalizeUrl(serverUrl),
      username: username.trim(),
      password,
    };
    // The endpoint shown in the form is the one used and then pinned on the
    // account — later credential-bearing requests never re-resolve the
    // synced setting (see CalendarAccount.endpoint).
    const endpoint = connectEndpoint;
    try {
      const calendars = await fetchCalendars(creds, endpoint);
      if (calendars.length === 0) {
        connectError = 'Connected, but the account has no calendars.';
        return;
      }
      let host = creds.url;
      try {
        host = new URL(creds.url).host;
      } catch {
        // keep as-is
      }
      addCalendarAccount({ label: host, ...creds, endpoint, calendars });
      showAdd = false;
      serverUrl = '';
      username = '';
      password = '';
      showToast(`Found ${calendars.length} calendar${calendars.length === 1 ? '' : 's'}`);
      onconnected?.();
    } catch (err) {
      console.error('Calendar discovery failed', err);
      connectError = friendlyError(err);
    } finally {
      connecting = false;
    }
  }

  /** Re-run discovery, keeping hidden/default choices for surviving calendars. */
  async function handleRefresh(account: CalendarAccount) {
    refreshingId = account.id;
    try {
      const calendars = await fetchCalendars(account, accountEndpoint(account));
      const ids = new Set(calendars.map((c) => c.id));
      updateCalendarAccount(account.id, {
        calendars,
        hiddenCalendarIds: account.hiddenCalendarIds?.filter((id) => ids.has(id)),
        defaultCalendarId:
          account.defaultCalendarId && ids.has(account.defaultCalendarId)
            ? account.defaultCalendarId
            : undefined,
      });
    } catch (err) {
      console.error('Calendar refresh failed', err);
      showToast(friendlyError(err));
    } finally {
      refreshingId = null;
    }
  }

  function toggleHidden(account: CalendarAccount, calendarId: string) {
    const hidden = new Set(account.hiddenCalendarIds ?? []);
    if (hidden.has(calendarId)) {
      hidden.delete(calendarId);
    } else {
      hidden.add(calendarId);
    }
    updateCalendarAccount(account.id, { hiddenCalendarIds: [...hidden] });
  }

  function toggleDefault(account: CalendarAccount, calendarId: string) {
    updateCalendarAccount(account.id, {
      defaultCalendarId:
        account.defaultCalendarId === calendarId ? undefined : calendarId,
    });
  }

  function handleRemove(accountId: string) {
    if (confirmRemoveId !== accountId) {
      confirmRemoveId = accountId;
      return;
    }
    removeCalendarAccount(accountId);
    confirmRemoveId = null;
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (showAdd) {
      showAdd = false;
      return;
    }
    onclose();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="Calendar accounts" onclick={onclose}>
  <div class="modal" use:trapFocus onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <h3 class="title">Calendar accounts</h3>
      <button type="button" class="icon-btn" aria-label="Close" onclick={onclose}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <p class="sub">
      Scheduled cards can post straight to your calendar. Credentials stay on
      this device and are relayed per-request — no server stores them.
    </p>

    {#each $calendarAccounts as account (account.id)}
      <div class="acct">
        <div class="acct-head">
          <span class="acct-label">{account.label}</span>
          <span class="acct-user">{account.username}</span>
          <button
            type="button"
            class="mini-btn"
            disabled={refreshingId === account.id}
            onclick={() => handleRefresh(account)}
          >
            {refreshingId === account.id ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            class="mini-btn danger"
            onclick={() => handleRemove(account.id)}
            onmouseleave={() => (confirmRemoveId = null)}
          >
            {confirmRemoveId === account.id ? 'Really remove?' : 'Remove'}
          </button>
        </div>
        {#each account.calendars as cal (cal.id)}
          {@const hidden = account.hiddenCalendarIds?.includes(cal.id)}
          <div class="cal-line" class:hidden>
            <span class="dot" style="background: {cal.color || 'var(--accent)'}"></span>
            <span class="cal-name">{cal.name}</span>
            {#if cal.components.includes('task')}
              <span class="tag">tasks</span>
            {/if}
            <span class="line-actions">
              <button
                type="button"
                class="star-btn"
                class:on={account.defaultCalendarId === cal.id}
                title={account.defaultCalendarId === cal.id
                  ? 'Default calendar'
                  : 'Make default'}
                aria-label="Make {cal.name} the default calendar"
                aria-pressed={account.defaultCalendarId === cal.id}
                onclick={() => toggleDefault(account, cal.id)}
              >★</button>
              <label class="vis-label">
                <input
                  type="checkbox"
                  checked={!hidden}
                  aria-label="Show {cal.name} in pickers"
                  onchange={() => toggleHidden(account, cal.id)}
                />
                show
              </label>
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="empty">No accounts connected yet.</p>
    {/each}

    {#if showAdd}
      <form class="add-form" onsubmit={(e) => { e.preventDefault(); void handleConnect(); }}>
        <label class="flabel" for="cal-server">Server</label>
        <input
          id="cal-server"
          type="text"
          bind:value={serverUrl}
          placeholder="caldav.fastmail.com"
          autocomplete="url"
        />
        <label class="flabel" for="cal-user">Username</label>
        <input
          id="cal-user"
          type="text"
          bind:value={username}
          placeholder="you@example.com"
          autocomplete="username"
        />
        <label class="flabel" for="cal-pass">App password</label>
        <input
          id="cal-pass"
          type="password"
          bind:value={password}
          autocomplete="current-password"
        />
        <p class="relay-line" class:custom={isCustomRelay}>
          {#if isCustomRelay}
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            Credentials will be relayed via <strong>{endpointHost}</strong> —
            a custom Sockethub server, not the app default. Make sure you
            trust it.
          {:else}
            Credentials are relayed via <strong>{endpointHost}</strong> and
            never stored there.
          {/if}
        </p>
        {#if connectError}
          <p class="error">{connectError}</p>
        {/if}
        <button type="submit" class="btn-primary" disabled={!canConnect}>
          {connecting ? 'Connecting…' : 'Connect & find calendars'}
        </button>
        <p class="hint">
          Use an app-specific password — most providers (Fastmail, iCloud,
          Nextcloud) issue them under security settings.
        </p>
      </form>
    {:else}
      <button
        type="button"
        class="btn-add"
        onclick={() => {
          showAdd = true;
          connectError = '';
          connectEndpoint = resolveSockethubEndpoint();
        }}
      >
        + Add calendar account
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
    align-items: flex-start;
    justify-content: center;
    padding: 3rem 1rem;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    max-width: 440px;
    width: 100%;
    box-shadow: 0 12px 40px var(--shadow);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .title {
    font-size: 1.05rem;
    font-weight: 650;
  }

  .icon-btn {
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm);
    display: grid;
    place-items: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .sub {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0.35rem 0 0.9rem;
  }

  .acct {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    padding: 0.6rem 0.7rem;
    margin-bottom: 0.6rem;
  }

  .acct-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
    min-width: 0;
  }

  .acct-label {
    font-size: 0.85rem;
    font-weight: 650;
    flex-shrink: 0;
  }

  .acct-user {
    font-size: 0.72rem;
    color: var(--text-muted);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mini-btn {
    border: 1px solid var(--border);
    background: none;
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0.12rem 0.55rem;
    font-size: 0.7rem;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
  }

  .mini-btn:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .mini-btn.danger:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  .mini-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .cal-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.28rem 0.1rem;
    font-size: 0.82rem;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .cal-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cal-line.hidden .cal-name {
    opacity: 0.45;
  }

  .tag {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.02rem 0.4rem;
    font-size: 0.6rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .line-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    flex-shrink: 0;
  }

  .star-btn {
    border: none;
    background: none;
    color: var(--border);
    font-size: 0.9rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: color 0.15s;
  }

  .star-btn:hover {
    color: var(--text-muted);
  }

  .star-btn.on {
    color: #eab308;
  }

  .vis-label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    cursor: pointer;
  }

  .vis-label input {
    accent-color: var(--accent);
  }

  .empty {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }

  .add-form {
    display: flex;
    flex-direction: column;
    margin-top: 0.5rem;
  }

  .flabel {
    font-size: 0.66rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 550;
    margin: 0.6rem 0 0.25rem;
  }

  .add-form input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.45rem 0.6rem;
    color: var(--text);
    /* ≥1rem: iOS Safari focus-zoom floor (AGENTS.md). */
    font-size: 1rem;
    font-family: inherit;
    outline: none;
  }

  .add-form input:focus {
    border-color: var(--accent);
  }

  /* Which relay receives the credentials — always visible pre-Connect. */
  .relay-line {
    margin-top: 0.6rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .relay-line.custom {
    color: #d97706;
    border: 1px solid color-mix(in srgb, #d97706 35%, transparent);
    background: color-mix(in srgb, #d97706 8%, transparent);
    border-radius: var(--radius-sm);
    padding: 0.45rem 0.55rem;
  }

  .relay-line svg {
    display: inline;
    vertical-align: -1px;
    margin-right: 0.2rem;
  }

  .error {
    margin-top: 0.6rem;
    font-size: 0.78rem;
    color: var(--danger);
    line-height: 1.45;
  }

  .btn-primary {
    margin-top: 0.85rem;
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .hint {
    margin-top: 0.6rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .btn-add {
    width: 100%;
    background: none;
    border: 1px dashed var(--border);
    color: var(--text-muted);
    padding: 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .btn-add:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
