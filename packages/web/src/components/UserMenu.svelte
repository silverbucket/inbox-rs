<script lang="ts">
  import rs from '../lib/rs';
  import { connected, syncing } from '../lib/stores';

  let open = $state(false);
  let userAddress = $state('');
  let connecting = $state(false);
  let theme = $state<'system' | 'light' | 'dark'>(getStoredTheme());

  function getStoredTheme(): 'system' | 'light' | 'dark' {
    if (typeof localStorage === 'undefined') return 'system';
    return (localStorage.getItem('inbox-rs-theme') as 'system' | 'light' | 'dark') || 'system';
  }

  function applyTheme(t: 'system' | 'light' | 'dark') {
    theme = t;
    localStorage.setItem('inbox-rs-theme', t);
    const root = document.documentElement;
    if (t === 'system') {
      root.removeAttribute('data-theme');
      root.style.colorScheme = '';
    } else {
      root.setAttribute('data-theme', t);
      root.style.colorScheme = t;
    }
  }

  // Apply stored theme on mount
  $effect(() => {
    applyTheme(theme);
  });

  function toggle() {
    open = !open;
  }

  function closeMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.user-menu')) {
      open = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  $effect(() => {
    if (open) {
      document.addEventListener('click', closeMenu, true);
      document.addEventListener('keydown', handleKeydown, true);
    }
    return () => {
      document.removeEventListener('click', closeMenu, true);
      document.removeEventListener('keydown', handleKeydown, true);
    };
  });

  async function handleConnect() {
    if (!userAddress.trim()) return;
    connecting = true;
    try {
      rs.connect(userAddress.trim());
    } catch {
      connecting = false;
    }
  }

  function handleDisconnect() {
    rs.disconnect();
    open = false;
  }

  $effect(() => {
    if ($connected) connecting = false;
  });
</script>

<div class="user-menu">
  <button
    class="trigger"
    onclick={toggle}
    aria-expanded={open}
    aria-haspopup="true"
    aria-label={$connected ? 'User menu — connected' : 'User menu — disconnected'}
  >
    <svg class="trigger-sync" class:spinning={$syncing} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"></path>
    </svg>
    <span class="trigger-dot" class:connected={$connected}></span>
    <svg class="trigger-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  </button>

  {#if open}
    <div class="dropdown" role="menu">
      <!-- Connection status -->
      <div class="section-label">Connection</div>
      {#if $connected}
        <div class="status-row">
          <span class="status-dot connected"></span>
          <span class="status-label">Connected</span>
        </div>
        <button class="menu-item danger" role="menuitem" onclick={handleDisconnect}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Disconnect
        </button>
      {:else}
        <div class="status-row">
          <span class="status-dot"></span>
          <span class="status-label">Not connected</span>
        </div>
        <form class="connect-form" onsubmit={(e) => { e.preventDefault(); handleConnect(); }}>
          <input
            type="text"
            bind:value={userAddress}
            placeholder="user@storage.example"
            disabled={connecting}
          />
          <button type="submit" class="btn-connect" disabled={connecting || !userAddress.trim()}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      {/if}

      <div class="divider"></div>

      <!-- Theme -->
      <div class="section-label">Theme</div>
      <div class="theme-switcher" role="radiogroup" aria-label="Theme">
        <button
          class="theme-option"
          class:active={theme === 'system'}
          role="radio"
          aria-checked={theme === 'system'}
          onclick={() => applyTheme('system')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          System
        </button>
        <button
          class="theme-option"
          class:active={theme === 'light'}
          role="radio"
          aria-checked={theme === 'light'}
          onclick={() => applyTheme('light')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
          Light
        </button>
        <button
          class="theme-option"
          class:active={theme === 'dark'}
          role="radio"
          aria-checked={theme === 'dark'}
          onclick={() => applyTheme('dark')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
          Dark
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .user-menu {
    position: relative;
  }

  /* ── Trigger button ──────────────────────── */
  .trigger {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition: border-color 150ms, background 150ms;
  }

  .trigger:hover {
    border-color: var(--accent);
    background: var(--surface-hover);
  }

  .trigger-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.4;
    flex-shrink: 0;
    transition: background 200ms, opacity 200ms;
  }

  .trigger-dot.connected {
    background: #22c55e;
    opacity: 1;
  }

  .trigger-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .trigger-sync {
    color: var(--accent);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 150ms;
  }

  .trigger-sync.spinning {
    opacity: 1;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Dropdown ────────────────────────────── */
  .dropdown {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    width: 260px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem;
    box-shadow: 0 8px 24px var(--shadow), 0 2px 8px var(--shadow);
    z-index: 200;
    animation: dropdown-in 120ms ease-out;
  }

  @keyframes dropdown-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .section-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 0.35rem 0.5rem 0.2rem;
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 0.4rem 0;
  }

  /* ── Status row ──────────────────────────── */
  .status-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.35;
    flex-shrink: 0;
  }

  .status-dot.connected {
    background: #22c55e;
    opacity: 1;
  }

  .status-label {
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  /* ── Menu items ──────────────────────────── */
  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.5rem;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 120ms;
  }

  .menu-item:hover {
    background: var(--surface-hover);
  }

  .menu-item.danger {
    color: var(--danger);
  }

  .menu-item.danger:hover {
    background: color-mix(in srgb, var(--danger) 10%, var(--surface) 90%);
  }

  /* ── Connect form ────────────────────────── */
  .connect-form {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.25rem 0.5rem 0.35rem;
  }

  .connect-form input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.6rem;
    color: var(--text);
    font-size: 0.82rem;
    outline: none;
    transition: border-color 150ms;
    width: 100%;
  }

  .connect-form input:focus {
    border-color: var(--accent);
  }

  .connect-form input::placeholder {
    color: var(--text-muted);
  }

  .btn-connect {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.75rem;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 150ms;
  }

  .btn-connect:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-connect:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Theme switcher ──────────────────────── */
  .theme-switcher {
    display: flex;
    gap: 2px;
    padding: 0.25rem 0.5rem 0.35rem;
  }

  .theme-option {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.35rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 150ms;
  }

  .theme-option:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .theme-option.active {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  /* ── Mobile ──────────────────────────────── */
  @media (max-width: 768px) {
    .dropdown {
      width: 240px;
    }
  }
</style>
