<script lang="ts">
  import { onMount } from 'svelte';
  import {
    clearConfig,
    enqueueCapture,
    finishConnectFromRedirect,
    flushQueue,
    getConfig,
    getQueue,
    startConnect,
    type CaptureType,
  } from './store';

  type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };

  let type = $state<CaptureType>('note');
  let input = $state('');
  let userAddress = $state('');
  let connectedAddress = $state('');
  let queueCount = $state(0);
  let status = $state('Ready');
  let syncing = $state(false);
  let installPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let isIos = $state(false);

  onMount(() => {
    const config = finishConnectFromRedirect() ?? getConfig();
    connectedAddress = config?.userAddress ?? '';
    userAddress = connectedAddress;
    queueCount = getQueue().length;
    isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    void syncNow();

    const onOnline = () => void syncNow();
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      installPrompt = event as BeforeInstallPromptEvent;
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
    };
  });

  async function saveCapture() {
    const value = input.trim();
    if (!value) return;
    if (type === 'bookmark' && !value.includes('.')) {
      status = 'Enter a URL for bookmarks';
      return;
    }
    enqueueCapture(type, value);
    input = '';
    queueCount = getQueue().length;
    status = navigator.onLine ? 'Saved. Syncing...' : 'Saved offline';
    await syncNow();
  }

  async function syncNow() {
    if (syncing) return;
    const config = getConfig();
    if (!config?.href || !config.token) {
      queueCount = getQueue().length;
      status = queueCount ? 'Saved locally. Connect to sync.' : 'Ready';
      return;
    }
    syncing = true;
    try {
      const remaining = await flushQueue(config);
      queueCount = remaining.length;
      connectedAddress = config.userAddress;
      status = queueCount ? `${queueCount} waiting to sync` : 'Synced';
    } finally {
      syncing = false;
    }
  }

  async function connect() {
    const address = userAddress.trim();
    if (!address) return;
    status = 'Opening remoteStorage login...';
    try {
      await startConnect(address);
    } catch (error) {
      status = error instanceof Error ? error.message : 'Could not connect';
    }
  }

  function disconnect() {
    clearConfig();
    connectedAddress = '';
    status = queueCount ? 'Saved locally. Connect to sync.' : 'Disconnected';
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
  }
</script>

<main class="capture-shell">
  <section class="hero" aria-label="Quick capture">
    <div class="hero-top">
      <div>
        <p class="eyebrow">Inbox RS</p>
        <h1>Quick Capture</h1>
      </div>
      <a class="main-link" href="/">Full app</a>
    </div>

    <div class="type-tabs" role="radiogroup" aria-label="Capture type">
      <button type="button" class:active={type === 'note'} onclick={() => type = 'note'}>Note</button>
      <button type="button" class:active={type === 'todo'} onclick={() => type = 'todo'}>Todo</button>
      <button type="button" class:active={type === 'bookmark'} onclick={() => type = 'bookmark'}>Bookmark</button>
    </div>

    <form class="capture-form" onsubmit={(event) => { event.preventDefault(); void saveCapture(); }}>
      <textarea
        bind:value={input}
        rows="7"
        placeholder={type === 'bookmark' ? 'https://example.com' : type === 'todo' ? 'What needs doing?' : 'Jot something down...'}
      ></textarea>
      <button type="submit" disabled={!input.trim()}>Save</button>
    </form>

    <p class="status" aria-live="polite">
      {status}
      {#if queueCount > 0}
        <span>{queueCount} queued</span>
      {/if}
    </p>
  </section>

  <section class="panel" aria-label="Connection">
    {#if connectedAddress}
      <div>
        <p class="panel-label">Connected</p>
        <p class="address">{connectedAddress}</p>
      </div>
      <div class="panel-actions">
        <button type="button" class="secondary" onclick={() => void syncNow()} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync now'}</button>
        <button type="button" class="ghost" onclick={disconnect}>Disconnect</button>
      </div>
    {:else}
      <p class="panel-label">Connect remoteStorage</p>
      <form class="connect-form" onsubmit={(event) => { event.preventDefault(); void connect(); }}>
        <input bind:value={userAddress} type="text" placeholder="user@storage.example" />
        <button type="submit" class="secondary" disabled={!userAddress.trim()}>Connect</button>
      </form>
    {/if}
  </section>

  <section class="panel install" aria-label="Install">
    <div>
      <p class="panel-label">Home screen icon</p>
      <p>Install this page for the fastest input-only launcher.</p>
    </div>
    {#if installPrompt}
      <button type="button" class="secondary" onclick={() => void install()}>Install</button>
    {:else if isIos}
      <p class="hint">Use Share, then Add to Home Screen.</p>
    {:else}
      <p class="hint">Use your browser's install option if it is available.</p>
    {/if}
  </section>
</main>
