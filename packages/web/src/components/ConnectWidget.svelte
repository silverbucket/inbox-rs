<script lang="ts">
  import rs from '../lib/rs';
  import { connected, syncing } from '../lib/stores';

  let inputAddress = $state('');
  let connecting = $state(false);
  let menuOpen = $state(false);
  let address = $state('');

  // Read the address whenever the connected state changes
  $effect(() => {
    if ($connected) {
      connecting = false;
      address = resolveAddress();
    } else {
      address = '';
      menuOpen = false;
    }
  });

  function handleConnect() {
    if (!inputAddress.trim()) return;
    connecting = true;
    localStorage.setItem('inbox-rs:userAddress', inputAddress.trim());
    rs.connect(inputAddress.trim());
  }

  function handleDisconnect() {
    menuOpen = false;
    rs.disconnect();
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  let wrapperEl = $state<HTMLDivElement | null>(null);

  function resolveAddress(): string {
    // 1. RS sets this on remote after connecting
    const fromRemote = (rs as any).remote?.userAddress as string | undefined;
    if (fromRemote) return fromRemote;
    // 2. We stash it before OAuth redirect
    const fromOurs = localStorage.getItem('inbox-rs:userAddress');
    if (fromOurs) return fromOurs;
    // 3. RS always writes this key — reliable for existing/restored sessions
    try {
      const rsSettings = JSON.parse(localStorage.getItem('remotestorage:wireclient') ?? '{}');
      if (rsSettings?.userAddress) return rsSettings.userAddress;
    } catch { /* ignore */ }
    return '';
  }

  function handleClickOutside(e: MouseEvent) {
    if (!menuOpen) return;
    if (wrapperEl && !wrapperEl.contains(e.target as Node)) menuOpen = false;
  }

  const initials = $derived(address ? address[0].toUpperCase() : '?');
  const atIdx = $derived(address.indexOf('@'));
  const userPart = $derived(atIdx >= 0 ? address.slice(0, atIdx) : address);
  const hostPart = $derived(atIdx >= 0 ? address.slice(atIdx) : '');
</script>

<svelte:window onclick={handleClickOutside} />

{#if $connected}
  <div class="user-menu-wrapper" bind:this={wrapperEl}>
    <button
      class="user-trigger"
      class:open={menuOpen}
      onclick={toggleMenu}
      aria-haspopup="true"
      aria-expanded={menuOpen}
      aria-label="User menu"
    >
      <span class="avatar" aria-hidden="true">{initials}</span>
      {#if $syncing}
        <span class="sync-ring" aria-hidden="true"></span>
      {/if}
      <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>

    {#if menuOpen}
      <div class="dropdown" role="menu">
        <div class="user-info">
          <span class="avatar avatar-lg" aria-hidden="true">{initials}</span>
          <div class="user-text">
            <span class="user-name">{userPart || address}</span>
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
              <span class="status-dot"></span>
            </span>
          {/if}
        </div>

        <hr class="divider" />

        <button class="menu-item danger" onclick={handleDisconnect} role="menuitem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Disconnect
        </button>
      </div>
    {/if}
  </div>
{:else}
  <form class="widget" onsubmit={(e) => { e.preventDefault(); void handleConnect(); }}>
    <input
      type="text"
      bind:value={inputAddress}
      placeholder="user@storage.example.com"
      disabled={connecting}
    />
    <button type="submit" class="btn-connect" disabled={connecting || !inputAddress.trim()}>
      {connecting ? 'Connecting…' : 'Connect'}
    </button>
  </form>
{/if}

<style>
  /* ── Connect form ── */
  .widget {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  input {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    color: var(--text);
    font-size: 0.875rem;
    width: 240px;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus {
    border-color: var(--accent);
  }

  input::placeholder {
    color: var(--text-muted);
  }

  .btn-connect {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    transition: background 0.15s;
  }

  .btn-connect:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-connect:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── User menu wrapper ── */
  .user-menu-wrapper {
    position: relative;
  }

  /* ── Trigger button ── */
  .user-trigger {
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

  .user-trigger:hover,
  .user-trigger.open {
    border-color: var(--accent);
    background: var(--accent-subtler);
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }

  .user-trigger.open .chevron {
    transform: rotate(180deg);
  }

  /* ── Avatar ── */
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

  /* ── Sync ring on trigger ── */
  .sync-ring {
    position: absolute;
    inset: -2px;
    border-radius: 999px;
    border: 2px solid transparent;
    border-top-color: var(--accent);
    animation: spin 1s linear infinite;
    pointer-events: none;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Dropdown panel ── */
  .dropdown {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    min-width: 220px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px var(--shadow);
    z-index: 200;
    animation: dropdown-in 0.15s ease-out;
    overflow: hidden;
  }

  @keyframes dropdown-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── User info row ── */
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

  /* ── Status indicators in dropdown ── */
  .connected-badge {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 0 2px color-mix(in srgb, #22c55e 20%, transparent);
  }

  .sync-icon {
    color: var(--accent);
    flex-shrink: 0;
  }

  .sync-icon.spinning {
    animation: spin 1s linear infinite;
  }

  /* ── Divider ── */
  .divider {
    margin: 0;
    border: none;
    border-top: 1px solid var(--border);
  }

  /* ── Menu items ── */
  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: none;
    border: none;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
    color: var(--text-muted);
  }

  .menu-item:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .menu-item.danger:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, var(--surface));
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    form.widget {
      flex-direction: column;
      align-items: stretch;
      width: 100%;
      gap: 0.35rem;
    }

    form.widget input {
      width: 100%;
      font-size: 0.82rem;
      padding: 0.4rem 0.6rem;
    }

    form.widget .btn-connect {
      width: 100%;
      font-size: 0.82rem;
      padding: 0.4rem 0.75rem;
    }

    .dropdown {
      right: 0;
      left: auto;
      min-width: 200px;
    }
  }
</style>
