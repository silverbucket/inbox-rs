<script lang="ts">
  import browser from 'webextension-polyfill';
  import { DirectRS } from '../lib/rs';
  import { getConfig } from '../lib/storage';
  import type { BookmarkItem, NoteItem } from '@inbox-rs/rs-module';

  type Mode = 'page' | 'note';

  let connected = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let rs: DirectRS | null = null;
  let tabId: number | null = null;
  let mode = $state<Mode>('page');

  // Page mode fields
  let pageTitle = $state('');
  let pageUrl = $state('');
  let ogImage = $state('');
  let favicon = $state('');
  let siteName = $state('');
  let pageDescription = $state('');
  let embeddedContent = $state('');
  let tweetImages = $state<string[]>([]);
  let pageNote = $state('');

  // Note mode fields
  let noteTitle = $state('');
  let noteBody = $state('');

  $effect(() => {
    init();
  });

  async function init() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      pageUrl = tabs[0].url || '';
      pageTitle = tabs[0].title || '';
      tabId = tabs[0].id ?? null;
    }

    const config = await getConfig();
    if (config?.token && config?.href) {
      rs = new DirectRS(config);
      connected = true;

      if (tabId) {
        try {
          const meta = await browser.tabs.sendMessage(tabId, { type: 'get-metadata' });
          if (meta) {
            if (meta.title) pageTitle = meta.title;
            if (meta.description) pageDescription = meta.description;
            if (meta.ogImage) ogImage = meta.ogImage;
            if (meta.favicon) favicon = meta.favicon;
            if (meta.siteName) siteName = meta.siteName;
            if (meta.embeddedContent) embeddedContent = meta.embeddedContent;
            if (meta.tweetImages?.length) tweetImages = meta.tweetImages;
          }
        } catch {
          // Content script not available on this page
        }
      }
    }
  }

  function openSetup() {
    browser.runtime.openOptionsPage();
    window.close();
  }

  async function savePage() {
    if (!rs || saving || !pageUrl) return;
    saving = true;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Build description from user note + og:description (body handles embedded content)
    const desc = [pageNote, pageDescription].filter(Boolean).join('\n\n') || undefined;

    // Download + store image via service worker (avoids binary message passing).
    // For tweets: only save actual tweet images, not the generic Twitter og:image.
    // For other sites: save the og:image.
    const isTweetPage = embeddedContent || tweetImages.length > 0;
    const imageToSave = isTweetPage ? (tweetImages[0] || '') : (ogImage || '');
    let filePath: string | undefined;
    let mimeType: string | undefined;

    if (imageToSave) {
      // Guess extension from URL or default to jpg
      const guessedExt = imageToSave.match(/\.(png|jpg|jpeg|gif|webp|avif)/i)?.[1] || 'jpg';
      const candidatePath = `files/${id}.${guessedExt}`;
      try {
        const result = await browser.runtime.sendMessage({
          type: 'download-and-store-image',
          url: imageToSave,
          filePath: candidatePath
        });
        if (result?.ok) {
          filePath = candidatePath;
          mimeType = result.mimeType || `image/${guessedExt}`;
        }
      } catch {
        // Image save failed, bookmark will still be saved without local image
      }
    }

    // Skip generic/default og:image URLs (Twitter's default card, etc.)
    const isUsefulOgImage = ogImage && !ogImage.includes('/default/') && !ogImage.includes('placeholder');

    const item: BookmarkItem = {
      id, type: 'bookmark', title: pageTitle || pageUrl, url: pageUrl, createdAt,
      ...(desc ? { description: desc } : {}),
      ...(embeddedContent ? { body: embeddedContent } : {}),
      ...(filePath ? { filePath, mimeType } : {}),
      ...(isUsefulOgImage ? { ogImage } : {}),
      ...(favicon ? { favicon } : {}),
      ...(siteName ? { siteName } : {})
    };
    await rs.store(item);

    saving = false;
    saved = true;
    setTimeout(() => window.close(), 800);
  }

  async function saveNote() {
    if (!rs || saving || !noteBody.trim()) return;
    saving = true;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const item: NoteItem = {
      id, type: 'note',
      title: noteTitle.trim() || noteBody.trim().slice(0, 50),
      body: noteBody.trim(),
      createdAt
    };
    await rs.store(item);

    saving = false;
    saved = true;
    setTimeout(() => window.close(), 800);
  }
</script>

<div class="popup">
  <header>
    <h1>Inbox <span class="accent">RS</span></h1>
    {#if connected}
      <button class="btn-text" onclick={openSetup} title="Settings">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    {/if}
  </header>

  {#if !connected}
    <div class="not-connected">
      <p>Connect your remoteStorage to get started.</p>
      <button class="btn-primary" onclick={openSetup}>Set Up</button>
    </div>
  {:else if saved}
    <div class="saved">
      <span class="check">&#10003;</span> Saved to inbox
    </div>
  {:else}
    <div class="tabs">
      <button class="tab" class:active={mode === 'page'} onclick={() => mode = 'page'}>
        Save Page
      </button>
      <button class="tab" class:active={mode === 'note'} onclick={() => mode = 'note'}>
        Quick Note
      </button>
    </div>

    {#if mode === 'page'}
      <form class="save-form" onsubmit={(e) => { e.preventDefault(); savePage(); }}>
        {#if tweetImages[0]}
          <img class="preview-image" src={tweetImages[0]} alt="" />
        {:else if ogImage && !ogImage.includes('/default/') && !ogImage.includes('placeholder')}
          <img class="preview-image" src={ogImage} alt="" />
        {/if}
        <input type="text" bind:value={pageTitle} placeholder="Title" />
        <input type="url" bind:value={pageUrl} placeholder="URL" />
        {#if embeddedContent}
          <div class="embedded-preview">{embeddedContent.length > 200 ? embeddedContent.slice(0, 200) + '...' : embeddedContent}</div>
        {/if}
        {#if tweetImages.length > 0}
          <div class="tweet-images-note">{tweetImages.length} image{tweetImages.length > 1 ? 's' : ''} will be saved</div>
        {/if}
        <textarea bind:value={pageNote} placeholder="Add a note (optional)" rows="2"></textarea>
        <button type="submit" class="btn-primary" disabled={saving || !pageUrl}>
          {saving ? 'Saving...' : 'Save Page'}
        </button>
      </form>
    {:else}
      <form class="save-form" onsubmit={(e) => { e.preventDefault(); saveNote(); }}>
        <input type="text" bind:value={noteTitle} placeholder="Title (optional)" />
        <textarea bind:value={noteBody} placeholder="What's on your mind?" rows="5"></textarea>
        <button type="submit" class="btn-primary" disabled={saving || !noteBody.trim()}>
          {saving ? 'Saving...' : 'Save Note'}
        </button>
      </form>
    {/if}
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

  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 0.75rem;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .tab {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-muted);
    padding: 0.4rem 0.5rem;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .tab:first-child {
    border-right: 1px solid var(--border);
  }

  .tab.active {
    background: var(--accent);
    color: white;
  }

  .tab:hover:not(.active) {
    color: var(--text);
    background: var(--surface);
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

  .embedded-preview {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.4;
    white-space: pre-wrap;
    max-height: 80px;
    overflow: hidden;
  }

  .tweet-images-note {
    font-size: 0.75rem;
    color: var(--accent);
    font-weight: 500;
  }

  .preview-image {
    width: 100%;
    max-height: 120px;
    object-fit: cover;
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }

  .saved {
    text-align: center;
    padding: 2rem 0;
    color: var(--success);
    font-size: 1.1rem;
    font-weight: 500;
  }

  .check {
    font-size: 1.5rem;
  }
</style>
