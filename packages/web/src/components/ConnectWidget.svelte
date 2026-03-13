<script lang="ts">
  import rs from '../lib/rs';
  import { connected } from '../lib/stores';

  let userAddress = $state('');
  let connecting = $state(false);

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
  }

  $effect(() => {
    if ($connected) connecting = false;
  });
</script>

{#if $connected}
  <div class="widget connected">
    <span class="status-dot"></span>
    <span class="status-text">Connected</span>
    <button class="btn-disconnect" onclick={handleDisconnect}>Disconnect</button>
  </div>
{:else}
  <form class="widget" onsubmit={(e) => { e.preventDefault(); handleConnect(); }}>
    <input
      type="text"
      bind:value={userAddress}
      placeholder="user@storage.example.com"
      disabled={connecting}
    />
    <button type="submit" class="btn-connect" disabled={connecting || !userAddress.trim()}>
      {connecting ? 'Connecting...' : 'Connect'}
    </button>
  </form>
{/if}

<style>
  .widget {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .connected {
    font-size: 0.875rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    flex-shrink: 0;
  }

  .status-text {
    color: var(--text-muted);
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

  .btn-disconnect {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    transition: all 0.15s;
  }

  .btn-disconnect:hover {
    color: var(--danger);
    border-color: var(--danger);
  }
</style>
