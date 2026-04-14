<script lang="ts">
  import rs from '../lib/rs';
  import { connected, syncing, userAddress } from '../lib/stores';

  let open = $state(false);
  let inputAddress = $state('');
  let connecting = $state(false);
  let theme = $state<'system' | 'light' | 'dark'>(getStoredTheme());
  let customAbbrev = $state(localStorage.getItem('inbox-rs:userAbbrev') ?? '');
  let editingAbbrev = $state(false);
  let abbrevInput = $state('');

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
    if (!inputAddress.trim()) return;
    connecting = true;
    try {
      localStorage.setItem('inbox-rs:userAddress', inputAddress.trim());
      rs.connect(inputAddress.trim());
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

  const atIdx = $derived($userAddress.indexOf('@'));
  const userPart = $derived(atIdx >= 0 ? $userAddress.slice(0, atIdx) : $userAddress);
  const hostPart = $derived(atIdx >= 0 ? $userAddress.slice(atIdx) : '');
  const autoInitials = $derived(
    userPart.length >= 2
      ? (userPart[0] + userPart[userPart.length - 1]).toUpperCase()
      : userPart.length === 1
        ? userPart.toUpperCase()
        : '?'
  );
  const initials = $derived(customAbbrev || autoInitials);

  function startEditAbbrev() {
    abbrevInput = customAbbrev;
    editingAbbrev = true;
  }

  function saveAbbrev() {
    const val = abbrevInput.trim().toUpperCase().slice(0, 3);
    customAbbrev = val;
    if (val) {
      localStorage.setItem('inbox-rs:userAbbrev', val);
    } else {
      localStorage.removeItem('inbox-rs:userAbbrev');
    }
    editingAbbrev = false;
  }

  function cancelEditAbbrev() {
    editingAbbrev = false;
  }
</script>

<div class="user-menu">
  <button
    class="trigger"
    class:open
    onclick={toggle}
    aria-expanded={open}
    aria-haspopup="true"
    aria-label={$connected ? 'User menu — connected' : 'User menu — disconnected'}
  >
    {#if $connected && $userAddress}
      <span class="avatar" aria-hidden="true">{initials}</span>
    {:else}
      <svg class="trigger-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
    {/if}
    <span class="status-indicator">
      <span class="status-dot" class:connected={$connected} class:syncing={$syncing}></span>
    </span>
    <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </button>

  {#if open}
    <div class="dropdown" role="menu">
      <!-- Connection status -->
      {#if $connected}
        <div class="user-info">
          {#if editingAbbrev}
            <form class="abbrev-form" onsubmit={(e) => { e.preventDefault(); saveAbbrev(); }}>
              <input
                class="abbrev-input"
                type="text"
                bind:value={abbrevInput}
                maxlength="3"
                placeholder={autoInitials}
                onkeydown={(e) => { if (e.key === 'Escape') cancelEditAbbrev(); }}
                autofocus
              />
              <button type="submit" class="abbrev-btn save" aria-label="Save">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
              <button type="button" class="abbrev-btn cancel" onclick={cancelEditAbbrev} aria-label="Cancel">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </form>
          {:else}
            <button class="avatar avatar-lg avatar-editable" onclick={startEditAbbrev} title="Click to set custom abbreviation" aria-label="Edit abbreviation">{initials}</button>
          {/if}
          <div class="user-text">
            <span class="user-name">{userPart || $userAddress}</span>
            <span class="user-host">{hostPart}</span>
          </div>
          {#if $syncing}
            <svg class="sync-icon spinning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Syncing">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
              <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"></path>
            </svg>
          {:else}
            <span class="connected-badge" aria-label="Connected">
              <span class="status-dot connected"></span>
            </span>
          {/if}
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
        <div class="section-label">Connection</div>
        <div class="status-row">
          <span class="status-dot"></span>
          <span class="status-label">Not connected</span>
        </div>
        <form class="connect-form" onsubmit={(e) => { e.preventDefault(); handleConnect(); }}>
          <input
            type="text"
            bind:value={inputAddress}
            placeholder="user@storage.example"
            disabled={connecting}
          />
          <button type="submit" class="btn-connect" disabled={connecting || !inputAddress.trim()}>
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
    gap: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.25rem 0.5rem 0.25rem 0.25rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    position: relative;
  }

  .trigger:hover,
  .trigger.open {
    border-color: var(--accent);
    background: var(--accent-subtler);
  }

  /* ── Avatar ──────────────────────────────── */
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent-subtle);
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1;
    flex-shrink: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    user-select: none;
  }

  .avatar-lg {
    width: 36px;
    height: 36px;
    font-size: 1rem;
  }

  .avatar-editable {
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .avatar-editable:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-subtle);
  }

  /* ── Abbreviation editor ─────────────────── */
  .abbrev-form {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .abbrev-input {
    width: 42px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--accent);
    background: var(--accent-subtle);
    color: var(--accent);
    font-size: 0.85rem;
    font-weight: 700;
    text-align: center;
    text-transform: uppercase;
    outline: none;
    padding: 0;
    box-shadow: 0 0 0 2px var(--accent-subtle);
  }

  .abbrev-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
    color: var(--text-muted);
    transition: color 0.12s, background 0.12s;
  }

  .abbrev-btn.save:hover {
    color: #22c55e;
    background: color-mix(in srgb, #22c55e 10%, var(--surface));
  }

  .abbrev-btn.cancel:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, var(--surface));
  }

  /* ── Trigger icon (disconnected state) ──── */
  .trigger-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  /* ── Status indicator dot ────────────────── */
  .status-indicator {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .status-indicator .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.35;
    transition: background 0.3s, opacity 0.3s, box-shadow 0.3s;
  }

  .status-indicator .status-dot.connected {
    background: #22c55e;
    opacity: 1;
  }

  .status-indicator .status-dot.syncing {
    background: var(--accent);
    opacity: 1;
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 40%, transparent); }
    50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 0%, transparent); }
  }

  /* ── Chevron ─────────────────────────────── */
  .chevron {
    color: var(--text-muted);
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }

  .trigger.open .chevron {
    transform: rotate(180deg);
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

  /* ── User info row ─────────────────────── */
  .user-info {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem;
  }

  .user-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;
  }

  .user-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .user-host {
    font-size: 0.75rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connected-badge {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .connected-badge .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 0 2px color-mix(in srgb, #22c55e 20%, transparent);
    opacity: 1;
  }

  .sync-icon {
    color: var(--accent);
    flex-shrink: 0;
  }

  .sync-icon.spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
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
