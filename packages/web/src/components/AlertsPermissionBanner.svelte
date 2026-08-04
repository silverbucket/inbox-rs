<script lang="ts">
  import { alertPermission, requestAlertPermission } from '../lib/alerts';
  import { eligibleForAlert } from '../lib/alerts-core';
  import { allTodos } from '../lib/stores';

  /**
   * One-time nudge to enable OS notifications for due items. Shown only when
   * permission hasn't been decided, something schedulable actually exists,
   * and the user hasn't dismissed it — never requested on app load; the
   * browser prompt fires from the button's user gesture. In-app toasts work
   * regardless, so dismissing this loses nothing essential.
   */

  const DISMISSED_KEY = 'inbox-rs:alerts:banner-dismissed';

  function loadDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return true; // storage unavailable — can't persist a dismissal, don't nag
    }
  }

  let dismissed = $state(loadDismissed());
  let requesting = $state(false);

  const hasSchedulable = $derived($allTodos.some(eligibleForAlert));
  const visible = $derived(
    !dismissed && $alertPermission === 'default' && hasSchedulable,
  );

  async function enable() {
    requesting = true;
    try {
      await requestAlertPermission();
    } finally {
      requesting = false;
    }
  }

  function dismiss() {
    dismissed = true;
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // session-only dismissal is fine
    }
  }
</script>

{#if visible}
  <div class="alerts-banner" role="status">
    <div class="banner-content">
      <strong>Get notified when items are due</strong>
      <p>Allow notifications and scheduled todos alert you at their deadline.</p>
    </div>
    <div class="banner-actions">
      <button type="button" class="btn-enable" onclick={enable} disabled={requesting}>
        {requesting ? 'Asking…' : 'Enable alerts'}
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

<style>
  .alerts-banner {
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

  .btn-enable:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-enable:disabled {
    opacity: 0.4;
    cursor: default;
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
