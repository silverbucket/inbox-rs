<script lang="ts">
  import { onMount } from 'svelte';
  import {
    captureImage,
    captureNote,
    captureVoice,
    type CaptureMode,
    type CaptureRecord,
    clearConfig,
    type DeliveryStatus,
    finishConnectFromRedirect,
    flushQueue,
    formatDuration,
    getConfig,
    getHistory,
    pendingCount,
    removeRecord,
    startConnect,
  } from './store';
  import {
    type Accent,
    ACCENT_LABELS,
    ACCENT_SWATCHES,
    ACCENTS,
    applyTheme,
    initTheme,
    type Mode,
  } from './theme';

  type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };

  let mode = $state<CaptureMode>('note');
  let noteText = $state('');
  let history = $state<CaptureRecord[]>([]);
  let status = $state('');
  let syncing = $state(false);

  let connectedAddress = $state('');
  let userAddress = $state('');

  let showHistory = $state(false);
  let showSettings = $state(false);

  // voice
  let recording = $state(false);
  let recordedBlob = $state<Blob | null>(null);
  let recordedUrl = $state<string | null>(null);
  let recordDuration = $state(0);
  let recordError = $state('');
  let mediaRecorder: MediaRecorder | null = null;
  let recordTimer: ReturnType<typeof setInterval> | null = null;

  // image
  let selectedFile = $state<File | null>(null);
  let imageUrl = $state<string | null>(null);

  // theme + install
  let accent = $state<Accent>('indigo');
  let themeMode = $state<Mode>('system');
  let installPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let isIos = $state(false);

  const pending = $derived(pendingCount(history));
  const canSend = $derived(
    mode === 'note'
      ? noteText.trim() !== ''
      : mode === 'voice'
        ? recordedBlob !== null
        : selectedFile !== null,
  );

  onMount(() => {
    const theme = initTheme();
    accent = theme.accent;
    themeMode = theme.mode;

    const config = finishConnectFromRedirect() ?? getConfig();
    connectedAddress = config?.userAddress ?? '';
    userAddress = connectedAddress;
    history = getHistory();
    isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    status = idleStatus();
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
      if (recordTimer) clearInterval(recordTimer);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  });

  function idleStatus(): string {
    if (!connectedAddress) return 'Not connected';
    const p = pendingCount();
    return p ? `${p} waiting to sync` : 'Ready';
  }

  async function send() {
    if (!canSend) return;
    if (mode === 'note') {
      captureNote(noteText);
      noteText = '';
    } else if (mode === 'voice' && recordedBlob) {
      await captureVoice(recordedBlob, recordDuration);
      clearVoice();
    } else if (mode === 'image' && selectedFile) {
      await captureImage(selectedFile);
      clearImage();
    }
    history = getHistory();
    status = navigator.onLine ? 'Saved ✓' : 'Saved offline';
    await syncNow();
  }

  async function syncNow() {
    if (syncing) return;
    const config = getConfig();
    if (!config?.href || !config.token) {
      history = getHistory();
      status = pending ? 'Saved · connect to sync' : idleStatus();
      return;
    }
    syncing = true;
    try {
      history = await flushQueue(config);
      connectedAddress = config.userAddress;
      const p = pendingCount(history);
      status = p ? `${p} waiting to sync` : 'All synced ✓';
    } finally {
      syncing = false;
    }
  }

  // --- voice ---
  async function startRecording() {
    recordError = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        const mimeType = mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        recordedBlob = blob;
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        recordedUrl = URL.createObjectURL(blob);
      };
      mediaRecorder.start();
      recording = true;
      recordDuration = 0;
      recordTimer = setInterval(() => {
        recordDuration += 1;
      }, 1000);
    } catch {
      recordError = 'Microphone unavailable';
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recording = false;
    if (recordTimer) {
      clearInterval(recordTimer);
      recordTimer = null;
    }
  }

  function clearVoice() {
    recordedBlob = null;
    recordDuration = 0;
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      recordedUrl = null;
    }
  }

  // --- image ---
  function onFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    selectedFile = file;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = URL.createObjectURL(file);
  }
  function clearImage() {
    selectedFile = null;
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
      imageUrl = null;
    }
  }

  // --- connection ---
  async function connect() {
    const address = userAddress.trim();
    if (!address) return;
    status = 'Opening remoteStorage login…';
    try {
      await startConnect(address);
    } catch (error) {
      status = error instanceof Error ? error.message : 'Could not connect';
    }
  }
  function disconnect() {
    clearConfig();
    connectedAddress = '';
    status = 'Disconnected';
  }

  // --- theme ---
  function setAccent(value: Accent) {
    accent = value;
    applyTheme(accent, themeMode);
  }
  function setMode(value: Mode) {
    themeMode = value;
    applyTheme(accent, value);
  }

  // --- history ---
  async function remove(id: string) {
    history = await removeRecord(id);
    status = idleStatus();
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
  }

  // biome-ignore lint/correctness/noUnusedVariables: used as a Svelte action (use:autofocus)
  function autofocus(node: HTMLTextAreaElement) {
    node.focus();
  }

  function onNoteKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  }

  const STATUS_LABEL: Record<DeliveryStatus, string> = {
    queued: 'Queued',
    sending: 'Sending…',
    synced: 'Sent',
    failed: 'Failed',
  };
  function recordTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<main class="screen">
  <header class="topbar">
    <div class="brand">
      <span class="name">Quick Capture</span>
      <span class="status" aria-live="polite">{status}</span>
    </div>
    <div class="top-actions">
      <button
        class="icon-btn"
        type="button"
        onclick={() => (showSettings = true)}
        aria-label="Settings"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <title>Settings</title>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11h.1a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5.9Z" />
        </svg>
      </button>
      <button
        class="icon-btn"
        type="button"
        onclick={() => (showHistory = true)}
        aria-label="History and delivery status"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <title>History</title>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {#if pending > 0}<span class="badge">{pending}</span>{/if}
      </button>
    </div>
  </header>

  <div class="modes" role="group" aria-label="Capture mode">
    <button class="seg" type="button" aria-pressed={mode === 'note'} onclick={() => (mode = 'note')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <title>Note</title>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
      Note
    </button>
    <button class="seg" type="button" aria-pressed={mode === 'voice'} onclick={() => (mode = 'voice')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <title>Voice</title>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      Voice
    </button>
    <button class="seg" type="button" aria-pressed={mode === 'image'} onclick={() => (mode = 'image')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <title>Image</title>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <circle cx="9" cy="11" r="2" />
        <path d="M3 17l5-4 4 3 3-2 6 5" />
      </svg>
      Image
    </button>
  </div>

  <section class="surface">
    {#if mode === 'note'}
      <textarea
        class="field"
        bind:value={noteText}
        use:autofocus
        onkeydown={onNoteKey}
        placeholder="Jot it down…"
        aria-label="Note text"
      ></textarea>
    {:else if mode === 'voice'}
      <div class="pad">
        {#if recording}
          <button class="record recording" type="button" onclick={stopRecording} aria-label="Stop recording">
            <span class="rec-dot"></span>
          </button>
          <p class="pad-line big">{formatDuration(recordDuration)}</p>
          <p class="pad-line">Recording… tap to stop</p>
        {:else if recordedBlob}
          <p class="pad-line big">Voice memo · {formatDuration(recordDuration)}</p>
          {#if recordedUrl}
            <!-- svelte-ignore a11y_media_has_caption -->
            <!-- biome-ignore lint/a11y/useMediaCaption: user's own voice memo preview, no caption track exists -->
            <audio class="preview-audio" controls src={recordedUrl}></audio>
          {/if}
          <button class="ghost" type="button" onclick={() => { clearVoice(); startRecording(); }}>
            Re-record
          </button>
        {:else}
          <button class="record" type="button" onclick={startRecording} aria-label="Start recording">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <title>Record</title>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <p class="pad-line">Tap to record</p>
          {#if recordError}<p class="pad-line error">{recordError}</p>{/if}
        {/if}
      </div>
    {:else}
      <!--
        A <label> opening a visually-hidden (not display:none) input is the only
        approach that reliably triggers the native picker in every browser —
        Safari/iOS refuse a programmatic .click() on a hidden file input.
      -->
      <input
        id="capture-image-file"
        class="visually-hidden"
        type="file"
        accept="image/*"
        onchange={onFile}
      />
      <div class="pad">
        {#if imageUrl}
          <img class="preview-image" src={imageUrl} alt="Selected" />
          <label class="ghost" for="capture-image-file">Choose another</label>
        {:else}
          <label class="record" for="capture-image-file" aria-label="Choose a photo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <title>Photo</title>
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <circle cx="9" cy="11" r="2" />
              <path d="M3 17l5-4 4 3 3-2 6 5" />
            </svg>
          </label>
          <p class="pad-line">Take or choose a photo</p>
        {/if}
      </div>
    {/if}

    <button class="send" type="button" onclick={send} disabled={!canSend}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <title>Send</title>
        <path d="M5 12h13M13 6l6 6-6 6" />
      </svg>
      Send to inbox
    </button>
  </section>
</main>

{#if showHistory}
  <div class="sheet" role="dialog" aria-label="History">
    <header class="sheet-head">
      <h2>History</h2>
      <div class="sheet-head-actions">
        <button class="ghost small" type="button" onclick={syncNow} disabled={syncing || !connectedAddress}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button class="icon-btn" type="button" onclick={() => (showHistory = false)} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Close</title><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </header>
    {#if history.length === 0}
      <p class="empty">Nothing captured yet.</p>
    {:else}
      <ul class="rec-list">
        {#each history as rec (rec.id)}
          <li class="rec rec-{rec.status}">
            <span class="rec-mode">{rec.mode === 'note' ? 'Note' : rec.mode === 'voice' ? 'Voice' : 'Image'}</span>
            <div class="rec-main">
              <p class="rec-preview">{rec.preview}</p>
              <p class="rec-meta">
                {recordTime(rec.createdAt)} · <span class="chip chip-{rec.status}">{STATUS_LABEL[rec.status]}</span>
                {#if rec.lastError}<span class="rec-err"> — {rec.lastError}</span>{/if}
              </p>
            </div>
            <button class="icon-btn tiny" type="button" onclick={() => remove(rec.id)} aria-label="Remove">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Remove</title><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" /></svg>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

{#if showSettings}
  <div class="sheet" role="dialog" aria-label="Settings">
    <header class="sheet-head">
      <h2>Settings</h2>
      <button class="icon-btn" type="button" onclick={() => (showSettings = false)} aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Close</title><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <section class="settings-block">
      <h3>remoteStorage</h3>
      {#if connectedAddress}
        <p class="connected">Connected as <strong>{connectedAddress}</strong></p>
        <button class="ghost" type="button" onclick={disconnect}>Disconnect</button>
      {:else}
        <form class="connect-form" onsubmit={(e) => { e.preventDefault(); void connect(); }}>
          <input bind:value={userAddress} type="text" placeholder="user@storage.example" aria-label="remoteStorage address" />
          <button class="ghost" type="submit" disabled={!userAddress.trim()}>Connect</button>
        </form>
      {/if}
    </section>

    <section class="settings-block">
      <h3>Theme</h3>
      <div class="swatches" role="group" aria-label="Accent colour">
        {#each ACCENTS as a (a)}
          <button
            class="swatch"
            class:active={accent === a}
            type="button"
            style="--sw: {ACCENT_SWATCHES[a]}"
            onclick={() => setAccent(a)}
            aria-label={ACCENT_LABELS[a]}
            aria-pressed={accent === a}
          ></button>
        {/each}
      </div>
      <div class="mode-toggle" role="group" aria-label="Light or dark">
        <button class="mode" class:active={themeMode === 'light'} type="button" onclick={() => setMode('light')}>Light</button>
        <button class="mode" class:active={themeMode === 'dark'} type="button" onclick={() => setMode('dark')}>Dark</button>
        <button class="mode" class:active={themeMode === 'system'} type="button" onclick={() => setMode('system')}>System</button>
      </div>
    </section>

    <section class="settings-block">
      <h3>Install</h3>
      {#if installPrompt}
        <button class="ghost" type="button" onclick={install}>Add to home screen</button>
      {:else if isIos}
        <p class="hint">Use Share, then Add to Home Screen.</p>
      {:else}
        <p class="hint">Use your browser's install option if available.</p>
      {/if}
    </section>
  </div>
{/if}

<style>
  .screen {
    height: 100%;
    width: min(100%, 30rem);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    padding: max(1.5rem, env(safe-area-inset-top)) 1.25rem
      max(1.5rem, env(safe-area-inset-bottom));
    gap: 1.25rem;
  }

  .topbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  .brand {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-size: 1.05rem;
    font-weight: 800;
  }
  .status {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-faint);
  }
  .top-actions {
    display: flex;
    gap: 0.5rem;
  }

  .icon-btn {
    position: relative;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.9rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn svg {
    width: 1.4rem;
    height: 1.4rem;
  }
  .icon-btn.tiny {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.7rem;
  }
  .icon-btn:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .badge {
    position: absolute;
    top: -0.4rem;
    right: -0.4rem;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    border: 2px solid var(--bg);
    font-size: 0.7rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
    background: var(--seg);
    border: 1px solid var(--line);
    border-radius: 1.25rem;
    padding: 0.5rem;
  }
  .seg {
    min-height: 4.25rem;
    border-radius: 0.9rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    color: var(--ink-soft);
    font-size: 0.9rem;
    font-weight: 700;
  }
  .seg svg {
    width: 1.4rem;
    height: 1.4rem;
  }
  .seg:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .seg[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: 0 4px 12px var(--accent-shadow);
  }

  .surface {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .field {
    flex: 1;
    width: 100%;
    border: 2px solid var(--line);
    border-radius: 1.5rem;
    background: var(--surface);
    padding: 1.25rem;
    font-size: 1.3rem;
    font-weight: 500;
    line-height: 1.45;
    resize: none;
    min-height: 0;
  }
  .field::placeholder {
    color: var(--ink-faint);
  }
  .field:focus,
  .field:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-tint);
  }

  .pad {
    flex: 1;
    border: 2px solid var(--line);
    border-radius: 1.5rem;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1.5rem;
    min-height: 0;
  }
  .pad-line {
    color: var(--ink-soft);
    font-weight: 600;
  }
  .pad-line.big {
    font-size: 1.4rem;
    font-weight: 800;
    color: var(--ink);
  }
  .pad-line.error {
    color: #b3402f;
  }
  .record {
    width: 6rem;
    height: 6rem;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 20px var(--accent-shadow);
    cursor: pointer;
  }
  .record svg {
    width: 2.4rem;
    height: 2.4rem;
  }
  .record:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }
  .record.recording {
    background: #b3402f;
  }
  .rec-dot {
    width: 2rem;
    height: 2rem;
    border-radius: 0.4rem;
    background: var(--on-accent);
  }
  .preview-image {
    max-width: 100%;
    max-height: 60%;
    border-radius: 1rem;
    object-fit: contain;
  }
  .preview-audio {
    width: 100%;
  }

  .send {
    margin-top: 1.1rem;
    min-height: 4rem;
    border-radius: 1.25rem;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 1.25rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    box-shadow: 0 8px 20px var(--accent-shadow);
  }
  .send svg {
    width: 1.4rem;
    height: 1.4rem;
  }
  .send:active {
    background: var(--accent-deep);
  }
  .send:disabled {
    opacity: 0.45;
    box-shadow: none;
  }
  .send:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: 3px;
  }

  .ghost {
    min-height: 2.9rem;
    padding: 0 1.1rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .ghost.small {
    min-height: 2.4rem;
    font-size: 0.85rem;
  }
  .ghost:disabled {
    opacity: 0.5;
  }

  /* Sheets */
  .sheet {
    position: fixed;
    inset: 0;
    background: var(--bg);
    padding: max(1.5rem, env(safe-area-inset-top)) 1.25rem
      max(1.5rem, env(safe-area-inset-bottom));
    width: min(100%, 30rem);
    margin: 0 auto;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sheet-head-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .sheet h2 {
    font-size: 1.4rem;
  }
  .empty {
    color: var(--ink-faint);
    padding: 2rem 0;
    text-align: center;
  }

  .rec-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .rec {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 1rem;
    background: var(--surface);
  }
  .rec-mode {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-faint);
    width: 3rem;
    flex: none;
  }
  .rec-main {
    flex: 1;
    min-width: 0;
  }
  .rec-preview {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rec-meta {
    font-size: 0.8rem;
    color: var(--ink-faint);
    margin-top: 2px;
  }
  .rec-err {
    color: #b3402f;
  }
  .chip {
    font-weight: 700;
  }
  .chip-synced {
    color: var(--accent);
  }
  .chip-failed {
    color: #b3402f;
  }

  .settings-block {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .settings-block h3 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-faint);
  }
  .connected {
    color: var(--ink-soft);
  }
  .connect-form {
    display: flex;
    gap: 0.5rem;
  }
  .connect-form input {
    flex: 1;
    min-height: 2.9rem;
    padding: 0 0.85rem;
    border-radius: 0.9rem;
    border: 1px solid var(--line);
    background: var(--surface);
  }
  .connect-form input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-tint);
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 0.6rem;
  }
  .swatch {
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--sw);
    border: 2px solid var(--line);
  }
  .swatch.active {
    border-color: var(--ink);
    box-shadow: 0 0 0 3px var(--accent-tint);
  }
  .mode-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
    background: var(--seg);
    border-radius: 0.9rem;
    padding: 0.35rem;
  }
  .mode {
    min-height: 2.6rem;
    border-radius: 0.6rem;
    color: var(--ink-soft);
    font-weight: 700;
  }
  .mode.active {
    background: var(--accent);
    color: var(--on-accent);
  }
  .hint {
    color: var(--ink-faint);
  }
</style>
