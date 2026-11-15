<script lang="ts">
  import {
    pausedCalendarAccounts,
    type CalendarAccount,
  } from '../lib/calendar-accounts';
  import CalendarPasswordSheet from './CalendarPasswordSheet.svelte';

  /**
   * Accounts set up on another device, listed where calendars are chosen:
   * one quiet row each that asks for the password when pressed. Renders
   * nothing when every account is usable here.
   */
  let {
    onconnected,
    sheetOpen = $bindable(false),
  }: {
    onconnected?: () => void;
    /** True while the password sheet is up (hosts defer Escape to it). */
    sheetOpen?: boolean;
  } = $props();

  let asking = $state<CalendarAccount | null>(null);

  $effect(() => {
    sheetOpen = !!asking;
  });
</script>

{#each $pausedCalendarAccounts as account (account.id)}
  <button type="button" class="paused-row" onclick={() => (asking = account)}>
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
    <span class="text">
      <span class="name">{account.label} · {account.username}</span>
      <span class="hint">Set up on another device. Enter its password to use it here.</span>
    </span>
  </button>
{/each}

{#if asking}
  <CalendarPasswordSheet
    account={asking}
    onclose={() => (asking = null)}
    {onconnected}
  />
{/if}

<style>
  .paused-row {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.55rem 0.65rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .paused-row:hover {
    background: var(--surface-hover);
    border-color: var(--accent);
  }

  .paused-row svg {
    flex: none;
    margin-top: 0.15rem;
    color: var(--text-muted);
  }

  .text {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .name {
    font-size: 0.85rem;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
