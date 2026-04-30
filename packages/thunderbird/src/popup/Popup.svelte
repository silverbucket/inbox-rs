<script lang="ts">
  import { DirectRS } from '../lib/rs';
  import { getConfig } from '../lib/storage';
  import { extractTextBody } from '../lib/mime';
  import { runSaveEmail } from './save-orchestrator';

  let connected = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state('');
  let rs: DirectRS | null = null;

  let subject = $state('');
  let author = $state('');
  let bodyText = $state('');
  let notes = $state('');
  let messageUrl = $state('');

  $effect(() => {
    init();
  });

  async function init() {
    const config = await getConfig();
    if (config?.token && config?.href) {
      rs = new DirectRS(config);
      connected = true;

      try {
        const tabs = await messenger.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab?.id) {
          const msg = await messenger.messageDisplay.getDisplayedMessage(tab.id);
          if (msg) {
            subject = msg.subject;
            author = msg.author;
            if (msg.headerMessageId) {
              const msgId = msg.headerMessageId.replace(/^<|>$/g, '');
              messageUrl = `mid:${msgId}`;
            }

            const full = await messenger.messages.getFull(msg.id);
            bodyText = extractTextBody(full);
          }
        }
      } catch {
        // Message not available
      }
    }
  }

  function openSetup() {
    browser.runtime.openOptionsPage();
    window.close();
  }

  async function saveEmail() {
    if (!rs || saving) return;
    saving = true;
    saveError = '';
    try {
      const result = await runSaveEmail({ rs, subject, author, bodyText, notes, messageUrl });
      if (result.ok) {
        saved = true;
        setTimeout(() => window.close(), 800);
      } else {
        saveError = result.error;
      }
    } finally {
      saving = false;
    }
  }
</script>

<div class="popup">
  <header>
    <h1>Inbox <span class="accent">RS</span></h1>
    {#if connected}
      <button type="button" class="btn-text" onclick={openSetup} title="Settings">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    {/if}
  </header>

  {#if !connected}
    <div class="not-connected">
      <p>Connect your remoteStorage to get started.</p>
      <button type="button" class="btn-primary" onclick={openSetup}>Set Up</button>
    </div>
  {:else if saved}
    <div class="saved">
      <span class="check">&#10003;</span> Saved to inbox
    </div>
  {:else}
    <form class="save-form" onsubmit={(e) => { e.preventDefault(); saveEmail(); }}>
      <input type="text" bind:value={subject} placeholder="Subject" />
      {#if author}
        <div class="author">From: {author}</div>
      {/if}
      {#if bodyText}
        <div class="body-preview">{bodyText.length > 500 ? `${bodyText.slice(0, 500)}...` : bodyText}</div>
      {/if}
      <textarea bind:value={notes} placeholder="Add a note (optional)" rows="3"></textarea>
      <button type="submit" class="btn-primary" disabled={saving || !subject.trim()}>
        {saving ? 'Saving...' : 'Save to Inbox'}
      </button>
      {#if saveError}
        <p class="error" role="alert">{saveError}</p>
      {/if}
    </form>
  {/if}
</div>

<style>
  .popup {
    padding: 1rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  h1 {
    font-size: 1rem;
    font-weight: 700;
  }

  .accent {
    color: var(--accent);
  }

  .btn-text {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
  }

  .btn-text:hover {
    color: var(--text);
  }

  .not-connected {
    text-align: center;
    padding: 1rem 0;
  }

  .not-connected p {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
  }

  .save-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  input, textarea {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    color: var(--text);
    font-family: inherit;
    font-size: 0.85rem;
    outline: none;
    resize: vertical;
  }

  input:focus, textarea:focus {
    border-color: var(--accent);
  }

  input::placeholder, textarea::placeholder {
    color: var(--text-muted);
  }

  .author {
    font-size: 0.8rem;
    color: var(--text-muted);
    padding: 0 0.25rem;
  }

  .body-preview {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.4;
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius);
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .saved {
    text-align: center;
    padding: 2rem 0;
    color: var(--success);
    font-size: 1.1rem;
    font-weight: 500;
  }

  .error {
    color: var(--danger);
    font-size: 0.8rem;
    margin: 0.25rem 0 0;
  }

  .check {
    font-size: 1.5rem;
  }
</style>
