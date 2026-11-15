<script lang="ts">
  import { trapFocus } from '../lib/actions';
  import { CaldavError, fetchCalendars } from '../lib/caldav';
  import {
    accountEndpoint,
    setCalendarAccountPassword,
    type CalendarAccount,
  } from '../lib/calendar-accounts';
  import { showToast } from '../lib/toast';

  /**
   * Asks for the app password of an account that was set up on another
   * device. Everything else about the account arrived through sync; the
   * password is the one thing each device keeps to itself.
   */
  let {
    account,
    onclose,
    onconnected,
  }: {
    account: CalendarAccount;
    onclose: () => void;
    onconnected?: () => void;
  } = $props();

  let password = $state('');
  let connecting = $state(false);
  let error = $state('');

  const endpoint = $derived(accountEndpoint(account));
  const relayHost = $derived.by(() => {
    try {
      return new URL(endpoint).host;
    } catch {
      return endpoint;
    }
  });
  const serverHost = $derived.by(() => {
    try {
      return new URL(account.url).host;
    } catch {
      return account.url;
    }
  });

  async function connect() {
    if (!password || connecting) return;
    connecting = true;
    error = '';
    try {
      // Check it against the server first, so a typo fails here and not as
      // a sync error later.
      await fetchCalendars(
        { url: account.url, username: account.username, password },
        endpoint,
      );
      setCalendarAccountPassword(account.id, password);
      showToast(`${account.label} now syncs from this device`);
      onconnected?.();
      onclose();
    } catch (err) {
      console.error('Calendar sign-in failed', err);
      error =
        err instanceof CaldavError
          ? err.message
          : 'Could not reach the calendar relay — are you offline?';
    } finally {
      connecting = false;
    }
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    // On top of whatever opened it: that must not close too.
    e.stopPropagation();
    if (!connecting) onclose();
  }
</script>

<svelte:window onkeydowncapture={handleEscape} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={() => { if (!connecting) onclose(); }}>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-label="Connect {account.label} on this device"
    tabindex="-1"
    use:trapFocus
    onclick={(e) => e.stopPropagation()}
  >
  <form onsubmit={(e) => { e.preventDefault(); void connect(); }}>
    <h3 class="title">Connect {account.label} on this device</h3>
    <p class="why">
      Your calendar setup follows you between devices. The password doesn't:
      it is kept only on each device and never saved to your synced storage.
    </p>

    <dl class="known">
      <div><dt>Server</dt><dd>{serverHost}</dd></div>
      <div><dt>Username</dt><dd>{account.username}</dd></div>
    </dl>

    <!-- Lets a password manager match the saved login. -->
    <input class="pm-hint" type="text" autocomplete="username" value={account.username} readonly tabindex="-1" aria-hidden="true" />
    <label class="flabel" for="cal-device-pass">App password</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="cal-device-pass"
      type="password"
      bind:value={password}
      autocomplete="current-password"
      autofocus
    />

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <p class="relay">Sent through <strong>{relayHost}</strong>, a Sockethub server, and never stored there.</p>

    <div class="footer">
      <button type="button" class="btn ghost" onclick={onclose} disabled={connecting}>Not now</button>
      <button type="submit" class="btn primary" disabled={!password || connecting}>
        {connecting ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  </form>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    overflow-y: auto;
    overscroll-behavior: contain;
    z-index: 230;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .sheet {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.1rem;
    max-width: 380px;
    width: 100%;
    box-shadow: 0 12px 40px var(--shadow);
  }

  .title {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.4rem;
  }

  .why {
    margin: 0 0 0.8rem;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .known {
    margin: 0 0 0.8rem;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    display: grid;
    gap: 0.25rem;
  }

  .known div {
    display: flex;
    gap: 0.6rem;
    min-width: 0;
  }

  .known dt {
    flex: none;
    width: 5rem;
    color: var(--text-muted);
  }

  .known dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .pm-hint {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .flabel {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.25rem;
  }

  input[type='password'] {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
    /* 16px keeps iOS from zooming the page on focus. */
    font-size: 1rem;
  }

  input[type='password']:focus {
    outline: none;
    border-color: var(--accent);
  }

  .error {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    color: var(--danger, #c0392b);
  }

  .relay {
    margin: 0.6rem 0 0;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .btn {
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    font-weight: 500;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
