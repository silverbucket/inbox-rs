<script lang="ts">
  import {
    accountsAwaitingPassword,
    dismissPasswordPrompt,
    type CalendarAccount,
  } from '../lib/calendar-accounts';
  import CalendarPasswordSheet from './CalendarPasswordSheet.svelte';

  /**
   * One-time note that a calendar account set up on another device needs
   * its password here before this device syncs it. Without it a linked
   * collection would simply never sync, with nothing to say why. Dismissing
   * is remembered on this device; the account stays reachable from
   * Settings → Calendars and the calendar pickers.
   */

  let asking = $state<CalendarAccount | null>(null);

  const first = $derived($accountsAwaitingPassword[0]);
  const names = $derived(
    $accountsAwaitingPassword.map((a) => a.label).join(', '),
  );

  function dismiss() {
    dismissPasswordPrompt($accountsAwaitingPassword.map((a) => a.id));
  }
</script>

{#if first}
  <div class="calendar-banner" role="status">
    <div class="banner-content">
      <strong>Finish connecting {names} on this device</strong>
      <p>
        {$accountsAwaitingPassword.length === 1 ? 'This calendar account was' : 'These calendar accounts were'}
        set up on another device. Enter the password once to sync
        {$accountsAwaitingPassword.length === 1 ? 'it' : 'them'} from here too.
      </p>
    </div>
    <div class="banner-actions">
      <button type="button" class="btn-enable" onclick={() => (asking = first)}>
        Enter password
      </button>
      <button type="button" class="btn-dismiss" onclick={dismiss} aria-label="Dismiss">
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  </div>
{/if}

{#if asking}
  <CalendarPasswordSheet account={asking} onclose={() => (asking = null)} />
{/if}

<style>
  .calendar-banner {
    background: var(--accent-subtler);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .banner-content {
    flex: 1;
    min-width: 200px;
  }

  .banner-content strong {
    font-size: 0.85rem;
  }

  .banner-content p {
    margin: 0.2rem 0 0;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .banner-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .btn-enable {
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-enable:hover {
    opacity: 0.9;
  }

  .btn-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }

  .btn-dismiss:hover {
    color: var(--text);
    background: var(--surface-hover);
  }
</style>
