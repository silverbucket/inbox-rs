<script lang="ts">
  import { connectViaOAuth } from '../lib/rs';
  import { getConfig, saveConfig, clearConfig } from '../lib/storage';

  let userAddress = $state('');
  let connected = $state(false);
  let connecting = $state(false);
  let error = $state('');
  let savedAddress = $state('');

  $effect(() => {
    init();
  });

  async function init() {
    const config = await getConfig();
    if (config?.token && config?.href) {
      connected = true;
      savedAddress = config.userAddress;
      userAddress = config.userAddress;
    }
  }

  async function connect() {
    if (!userAddress.trim()) return;
    connecting = true;
    error = '';
    try {
      const config = await connectViaOAuth(userAddress.trim());
      await saveConfig(config);
      connected = true;
      savedAddress = config.userAddress;
    } catch (e: any) {
      error = e.message || 'Connection failed';
    } finally {
      connecting = false;
    }
  }

  async function disconnect() {
    await clearConfig();
    connected = false;
    savedAddress = '';
  }
</script>

<div class="page">
  <div class="card">
    <div class="logo">
      <h1>Inbox <span class="accent">RS</span></h1>
      <p class="subtitle">Browser Extension Setup</p>
    </div>

    {#if connected}
      <div class="status-card connected">
        <div class="status-icon">&#10003;</div>
        <div>
          <p class="status-label">Connected</p>
          <p class="status-detail">{savedAddress}</p>
        </div>
      </div>
      <p class="help-text">
        You're all set. Click the extension icon in your toolbar to save links and notes.
        You can also right-click on any link or selected text to send it to your inbox.
      </p>
      <button class="btn-disconnect" onclick={disconnect}>Disconnect</button>
    {:else}
      <div class="steps">
        <div class="step">
          <span class="step-num">1</span>
          <div>
            <p class="step-title">Get a remoteStorage account</p>
            <p class="step-detail">
              Sign up with a remoteStorage provider, or run your own server.
              For local development, visit <a href="http://localhost:8000/signup" target="_blank">localhost:8000/signup</a>.
            </p>
          </div>
        </div>
        <div class="step">
          <span class="step-num">2</span>
          <div>
            <p class="step-title">Connect your storage</p>
            <p class="step-detail">Enter your remoteStorage address below to authorize the extension.</p>
          </div>
        </div>
      </div>

      <form class="connect-form" onsubmit={(e) => { e.preventDefault(); connect(); }}>
        <label for="address">remoteStorage address</label>
        <input
          id="address"
          type="text"
          bind:value={userAddress}
          placeholder="user@provider.example"
          disabled={connecting}
          autofocus
        />
        <button type="submit" class="btn-primary" disabled={connecting || !userAddress.trim()}>
          {connecting ? 'Connecting...' : 'Connect & Authorize'}
        </button>
        {#if error}
          <p class="error">{error}</p>
        {/if}
      </form>
    {/if}
  </div>
</div>

<style>
  .page {
    width: 100%;
    max-width: 480px;
    padding: 2rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2rem;
  }

  .logo {
    text-align: center;
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .accent {
    color: var(--accent);
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-top: 0.25rem;
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .step {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .step-num {
    background: var(--accent);
    color: white;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .step-title {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .step-detail {
    color: var(--text-muted);
    font-size: 0.8rem;
    margin-top: 0.2rem;
    line-height: 1.4;
  }

  .step-detail a {
    color: var(--accent);
    text-decoration: none;
  }

  .step-detail a:hover {
    text-decoration: underline;
  }

  .connect-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.75rem 1rem;
    color: var(--text);
    font-size: 1rem;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus {
    border-color: var(--accent);
  }

  input::placeholder {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.75rem 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 0.5rem;
    transition: background 0.15s;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    color: var(--danger);
    font-size: 0.8rem;
  }

  .status-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: var(--radius-sm);
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    margin-bottom: 1rem;
  }

  .status-icon {
    font-size: 1.25rem;
    color: var(--success);
  }

  .status-label {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--success);
  }

  .status-detail {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .help-text {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: 1.5rem;
  }

  .btn-disconnect {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    cursor: pointer;
    width: 100%;
    transition: all 0.15s;
  }

  .btn-disconnect:hover {
    color: var(--danger);
    border-color: var(--danger);
  }
</style>
