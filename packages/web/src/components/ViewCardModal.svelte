<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { deleteItem, storeItem, blobUrls, connected, sortedGroups, groupCollections, moveItemToCollection, loadFileBlobUrl } from '../lib/stores';
  import rs from '../lib/rs';
  import { transcribeAudio } from '../lib/transcribe';
  import ShareButton from './ShareButton.svelte';
  import Lightbox from './Lightbox.svelte';
  import DeleteConfirm from './DeleteConfirm.svelte';
  import hljs from 'highlight.js/lib/core';
  import DOMPurify from 'dompurify';
  import 'highlight.js/styles/github-dark.min.css';
  import { langModules, langAliases, renderMarkdown } from '../lib/markdown';

  let { item, onclose, onedit }: {
    item: InboxItem;
    onclose: () => void;
    onedit: (item: InboxItem) => void;
  } = $props();

  let showDelete = $state(false);
  let deleting = $state(false);
  let showLightbox = $state(false);
  let showMoveMenu = $state(false);
  let moveButtonEl = $state<HTMLButtonElement | null>(null);
  let dropdownStyle = $state('');

  // Audio playback
  const audioSrc = $derived(
    item.type === 'audio'
      ? ($blobUrls[item.filePath] || null)
      : null
  );

  // Audio state
  let audioError = $state(false);
  let transcribing = $state(false);
  let transcriptionError = $state(false);

  // Code highlighting
  let highlightedHtml = $state('');

  // Markdown rendering for notes
  let renderedBody = $state('');

  // Document download
  let docBlobUrl = $state<string | null>(null);
  let docLoading = $state(false);

  $effect(() => {
    // Track only item to trigger reloads when it changes
    const currentItem = item;

    // Reset per-item state
    audioError = false;
    transcribing = false;
    transcriptionError = false;
    highlightedHtml = '';
    renderedBody = '';
    showLightbox = false;
    untrack(() => { if (docBlobUrl) URL.revokeObjectURL(docBlobUrl); });
    docBlobUrl = null;
    docLoading = false;

    if (currentItem.type === 'code-snippet') {
      highlightCode();
    }
    if (currentItem.type === 'note' && (currentItem as any).body) {
      renderMarkdown((currentItem as any).body).then((html) => {
        if (item.id === currentItem.id) renderedBody = html;
      });
    }
  });

  onDestroy(() => {
    if (docBlobUrl) URL.revokeObjectURL(docBlobUrl);
    removeMoveMenuListeners();
  });

  async function handleTranscribe() {
    if (item.type !== 'audio') return;
    const target = item; // snapshot to guard against item changing mid-transcription
    transcribing = true;
    transcriptionError = false;
    try {
      const inbox = (rs as any).inbox;
      const file = await inbox.getFile(target.filePath);
      if (!file?.data) throw new Error('Could not load audio file');
      const blob = new Blob([file.data], { type: target.mimeType });
      const text = await transcribeAudio(blob);
      const updated = {
        ...target,
        body: text || undefined,
        title: text && target.title === 'Audio' ? text.slice(0, 50) : target.title,
        transcribed: true,
      };
      await storeItem(updated);
    } catch (e) {
      console.warn('Transcription failed:', e);
      if (item.id === target.id) transcriptionError = true;
    } finally {
      if (item.id === target.id) transcribing = false;
    }
  }

  async function highlightCode() {
    if (item.type !== 'code-snippet') return;
    const lang = item.language?.toLowerCase() || '';
    const resolved = langAliases[lang] || lang;
    const loader = langModules[resolved];
    if (loader && !hljs.getLanguage(resolved)) {
      const mod = await loader();
      hljs.registerLanguage(resolved, mod.default);
      highlightedHtml = DOMPurify.sanitize(
        hljs.highlight(item.body, { language: resolved }).value,
        { USE_PROFILES: { html: true } },
      );
    } else if (hljs.getLanguage(resolved)) {
      highlightedHtml = DOMPurify.sanitize(
        hljs.highlight(item.body, { language: resolved }).value,
        { USE_PROFILES: { html: true } },
      );
    }
  }

  async function downloadDoc() {
    if (item.type !== 'document') return;
    if (docBlobUrl) { openDownload(docBlobUrl); return; }
    docLoading = true;
    try {
      const inbox = (rs as any).inbox;
      const file = await inbox.getFile(item.filePath);
      if (file?.data) {
        docBlobUrl = URL.createObjectURL(new Blob([file.data], { type: item.mimeType }));
        openDownload(docBlobUrl);
      }
    } finally {
      docLoading = false;
    }
  }

  function openDownload(url: string) {
    if (item.type !== 'document') return;
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName || item.title;
    a.click();
  }

  async function handleDelete() {
    deleting = true;
    await deleteItem(item.id, item);
    showDelete = false;
    deleting = false;
    onclose();
  }

  let convertingTodo = $state(false);

  async function convertToTodo() {
    convertingTodo = true;
    try {
      const { completedAt: _, ...rest } = item;
      const updated = { ...rest, isTodo: true, completed: false };
      await storeItem(updated as InboxItem);
      onclose();
    } finally {
      convertingTodo = false;
    }
  }

  const canMakeTodo = $derived(item.type !== 'todo' && !item.isTodo);
  const canMakeRef = $derived(item.isTodo || item.type === 'todo');

  function toggleMoveMenu() {
    showMoveMenu = !showMoveMenu;
    if (showMoveMenu) {
      updateDropdownPosition();
      window.addEventListener('scroll', handleMoveMenuScroll, true);
      window.addEventListener('resize', closeMoveMenu);
      window.addEventListener('keydown', handleMoveMenuKeydown);
    } else {
      removeMoveMenuListeners();
    }
  }

  function handleMoveMenuScroll(event: Event) {
    const target = event.target;
    if (target instanceof Element && target.closest('.move-dropdown')) return;
    closeMoveMenu();
  }

  function handleMoveMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeMoveMenu();
  }

  function closeMoveMenu() {
    showMoveMenu = false;
    removeMoveMenuListeners();
  }

  function removeMoveMenuListeners() {
    window.removeEventListener('scroll', handleMoveMenuScroll, true);
    window.removeEventListener('resize', closeMoveMenu);
    window.removeEventListener('keydown', handleMoveMenuKeydown);
  }

  function updateDropdownPosition() {
    if (!moveButtonEl) return;
    const rect = moveButtonEl.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownMaxHeight = 240;
    const viewportPadding = 16;
    const gap = 4;

    const openUpward = spaceAbove > spaceBelow;
    const available = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(0, Math.min(available - viewportPadding, dropdownMaxHeight));

    // Clamp horizontal position using max possible rendered width
    const dropdownWidth = Math.min(280, window.innerWidth - viewportPadding * 2);
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - dropdownWidth - viewportPadding));

    if (openUpward) {
      dropdownStyle = `bottom: ${window.innerHeight - rect.top + gap}px; left: ${left}px; max-height: ${maxHeight}px;`;
    } else {
      dropdownStyle = `top: ${rect.bottom + gap}px; left: ${left}px; max-height: ${maxHeight}px;`;
    }
  }

  let convertingRef = $state(false);

  async function convertToReference() {
    convertingRef = true;
    try {
      const updated = { ...item };
      delete (updated as any).isTodo;
      delete (updated as any).completed;
      delete (updated as any).completedAt;
      // type: 'todo' items require `completed` in the schema — convert to note
      if (updated.type === 'todo') {
        (updated as any).type = 'note';
        if (!(updated as any).body) (updated as any).body = '';
      }
      await storeItem(updated as InboxItem);
      onclose();
    } finally {
      convertingRef = false;
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  }

  // Notes and body helpers
  const notes = $derived(
    'notes' in item ? (item as any).notes : undefined
  );
  const body = $derived(
    'body' in item ? (item as any).body : undefined
  );
  const description = $derived(item.description);

  const hasFile = $derived('filePath' in item && !!(item as any).filePath);

  const imageSrc = $derived(
    item.type === 'bookmark'
      ? ((item.filePath ? ($blobUrls[item.filePath] || null) : null) || item.ogImage || null)
      : item.type === 'image'
        ? ($blobUrls[item.filePath] || null)
        : null
  );

  // Fetch file-backed items via Authorization header (works on all RS servers)
  $effect(() => {
    if (!$connected) return;
    if (item.type === 'image' && item.filePath) loadFileBlobUrl(item.filePath);
    if (item.type === 'audio' && item.filePath) loadFileBlobUrl(item.filePath);
    if (item.type === 'bookmark' && 'filePath' in item && item.filePath) loadFileBlobUrl(item.filePath);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="view-modal-title" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <span class="type-badge">{item.type}</span>
      <time class="date">{formatDate(item.createdAt)}</time>
      {#if canMakeTodo}
        <button class="btn-todo btn-todo-top" disabled={convertingTodo} onclick={convertToTodo}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          Make Todo
        </button>
      {/if}
      {#if canMakeRef}
        <button class="btn-todo btn-todo-top" disabled={convertingRef} onclick={convertToReference}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          Make Reference
        </button>
      {/if}
    </div>

    <h2 class="title" id="view-modal-title">
      {#if item.type === 'bookmark'}
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}<svg class="link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>
      {:else if item.type === 'email' && 'messageUrl' in item && item.messageUrl}
        <a href={item.messageUrl}>{item.title}<svg class="link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>
      {:else}
        {item.title}
      {/if}
    </h2>

    {#if item.type === 'bookmark'}
      <div class="meta-row">
        {#if item.favicon}
          <img class="favicon" src={item.favicon} alt="" width="16" height="16"
            onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
        {/if}
        <span class="domain">{item.siteName || getDomain(item.url)}</span>
      </div>
    {/if}

    {#if item.type === 'email' && 'from' in item && item.from}
      <p class="meta-text">From: {item.from}</p>
    {/if}

    {#if imageSrc}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="view-image-link" onclick={() => showLightbox = true}>
        <img class="view-image" src={imageSrc} alt=""
          onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
      </div>
    {/if}
    {#if showLightbox && imageSrc}
      <Lightbox
        src={imageSrc}
        alt={item.title}
        onclose={() => showLightbox = false}
        filePath={'filePath' in item ? (item as any).filePath : undefined}
        mimeType={'mimeType' in item ? (item as any).mimeType : undefined}
        filename={item.title || undefined}
      />
    {/if}

    {#if item.type === 'audio'}
      <div class="player">
        {#if audioError}
          <p class="status-text">Failed to load audio</p>
        {:else if audioSrc}
          <audio controls src={audioSrc} preload="metadata"
            onerror={() => audioError = true}></audio>
        {:else}
          <p class="status-text">Connect to load audio</p>
        {/if}
        {#if item.duration}
          <span class="duration">{formatDuration(item.duration)}</span>
        {/if}
        {#if transcribing}
          <p class="status-text">Transcribing...</p>
        {:else if transcriptionError}
          <p class="status-text">Transcription failed</p>
          <button class="btn-action" onclick={handleTranscribe}>Retry</button>
        {:else if audioSrc && !item.transcribed && !item.body}
          <button class="btn-action" onclick={handleTranscribe}>Transcribe</button>
        {/if}
      </div>
    {/if}

    {#if item.type === 'code-snippet'}
      {#if item.language}
        <span class="language-badge">{item.language}</span>
      {/if}
      <pre class="code"><code>{#if highlightedHtml}{@html highlightedHtml}{:else}{item.body}{/if}</code></pre>
    {/if}

    {#if item.type === 'document'}
      {#if item.fileName}
        <p class="meta-text">{item.fileName}</p>
      {/if}
      {#if item.fileSize}
        <span class="meta-text">{formatSize(item.fileSize)}</span>
      {/if}
      <button class="btn-action" onclick={(e) => { e.stopPropagation(); downloadDoc(); }} disabled={docLoading}>
        {docLoading ? 'Loading...' : 'Download'}
      </button>
    {/if}

    <!-- Notes prioritized over body -->
    {#if notes}
      <div class="content-block notes-block">
        <span class="content-label">Notes</span>
        <p class="content-text">{notes}</p>
      </div>
    {/if}

    {#if body && item.type !== 'code-snippet'}
      <div class="content-block">
        <span class="content-label">{item.type === 'audio' ? 'Transcription' : 'Body'}</span>
        {#if item.type === 'note' && renderedBody}
          <div class="markdown-body">{@html renderedBody}</div>
        {:else}
          <p class="content-text">{body}</p>
        {/if}
      </div>
    {/if}

    {#if description}
      <div class="content-block">
        <span class="content-label">Description</span>
        <p class="content-text">{description}</p>
      </div>
    {/if}

    {#if hasFile}
      <div class="share-row">
        <ShareButton filePath={(item as any).filePath} mimeType={(item as any).mimeType} filename={item.title || undefined} />
      </div>
    {/if}

    <div class="actions">
      <button class="btn-delete" onclick={() => showDelete = true}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        Delete
      </button>
      <div class="move-container">
        <button class="btn-move" bind:this={moveButtonEl} onclick={toggleMoveMenu}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
          </svg>
          {item.collectionId ? 'Move' : 'Collect'}
        </button>
      </div>
      <button class="btn-cancel" onclick={onclose}>Close</button>
      <button class="btn-edit" onclick={() => onedit(item)}>Edit</button>
    </div>

    {#if showDelete}
      <DeleteConfirm
        onConfirm={handleDelete}
        onCancel={() => showDelete = false}
        {deleting}
      />
    {/if}

    {#if showMoveMenu}
      <button
        type="button"
        class="move-backdrop"
        tabindex="-1"
        aria-label="Close move menu"
        onclick={() => closeMoveMenu()}
      ></button>
      <div class="move-dropdown" style={dropdownStyle}>
        {#if item.collectionId}
          <button class="move-option" onclick={() => { moveItemToCollection(item.id, undefined).catch(e => console.error('Move failed:', e)); closeMoveMenu(); onclose(); }}>
            Return to Inbox
          </button>
          <div class="move-divider"></div>
        {/if}
        {#each $sortedGroups as group (group.id)}
          {#each ($groupCollections[group.id] ?? []) as col (col.id)}
            {#if col.id !== item.collectionId}
              <button class="move-option" onclick={() => { moveItemToCollection(item.id, col.id).catch(e => console.error('Move failed:', e)); closeMoveMenu(); onclose(); }}>
                <span class="move-dot" style="background: {col.color || '#6366f1'}"></span>
                <span class="move-group-prefix" style="color: {group.color || 'var(--accent)'}">{group.name}</span> : {col.name}
              </button>
            {/if}
          {/each}
        {/each}
        {#if $sortedGroups.length === 0}
          <div class="move-empty">No collections</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--overlay);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 3rem 1rem;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 560px;
    padding: 1.5rem;
    margin-left: auto;
    margin-right: auto;
  }

  @media (max-width: 600px), (display-mode: standalone) {
    .overlay {
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
      background: var(--bg);
    }

    .modal {
      max-width: none;
      min-height: 100%;
      border: none;
      border-radius: 0;
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .type-badge {
    background: var(--accent-subtle);
    color: var(--accent);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .date {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .title {
    font-size: 1.15rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    line-height: 1.3;
  }

  .title a {
    color: var(--text);
    transition: color 0.15s;
  }

  .title a:hover {
    color: var(--accent);
  }

  .title :global(.link-icon) {
    display: inline;
    vertical-align: middle;
    margin-left: 0.35rem;
    opacity: 0.5;
  }

  .title a:hover :global(.link-icon) {
    opacity: 1;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .favicon {
    border-radius: 2px;
    flex-shrink: 0;
  }

  .domain {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .meta-text {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }

  .view-image-link {
    cursor: zoom-in;
    margin-bottom: 0.75rem;
  }

  .view-image {
    width: 100%;
    max-height: 300px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }

  .player {
    margin-bottom: 0.75rem;
  }

  .player audio {
    width: 100%;
    height: 36px;
  }

  .duration {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .status-text {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .language-badge {
    display: inline-block;
    background: var(--accent-subtle);
    color: var(--accent);
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: lowercase;
    margin-bottom: 0.5rem;
  }

  .code {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    font-size: 0.8rem;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0 0 0.75rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .code code {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    color: var(--text);
  }

  :global(.code .hljs) {
    background: transparent;
    padding: 0;
  }

  .content-block {
    margin-bottom: 0.75rem;
  }

  .content-label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.25rem;
  }

  .content-text {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown-body {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    word-break: break-word;
  }

  .markdown-body :global(h1) { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
  .markdown-body :global(h2) { font-size: 1rem; font-weight: 600; margin: 0.6rem 0 0.35rem; }
  .markdown-body :global(h3) { font-size: 0.95rem; font-weight: 600; margin: 0.5rem 0 0.3rem; }
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) { font-size: 0.9rem; font-weight: 600; margin: 0.4rem 0 0.25rem; }

  .markdown-body :global(p) { margin: 0 0 0.5rem; }
  .markdown-body :global(p:last-child) { margin-bottom: 0; }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    padding-left: 1.5rem;
    margin: 0 0 0.5rem;
  }
  .markdown-body :global(ul) { list-style: disc; }
  .markdown-body :global(ol) { list-style: decimal; }
  .markdown-body :global(li) { margin-bottom: 0.15rem; }
  .markdown-body :global(li > ul),
  .markdown-body :global(li > ol) { margin-top: 0.15rem; margin-bottom: 0; }

  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 0.75rem;
    margin: 0 0 0.5rem;
    color: var(--text-muted);
  }

  .markdown-body :global(a) {
    color: var(--accent);
    text-decoration: none;
  }
  .markdown-body :global(a:hover) { text-decoration: underline; }

  .markdown-body :global(code) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }

  .markdown-body :global(pre) {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin: 0 0 0.5rem;
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  .markdown-body :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #e6edf3;
  }

  .markdown-body :global(pre .hljs) {
    background: transparent;
    padding: 0;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.75rem 0;
  }

  .markdown-body :global(strong) { font-weight: 600; }
  .markdown-body :global(em) { font-style: italic; }

  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
  }
  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--border);
    padding: 0.35rem 0.6rem;
    text-align: left;
  }
  .markdown-body :global(th) {
    font-weight: 600;
    background: rgba(255, 255, 255, 0.03);
  }

  .notes-block .content-text {
    color: var(--accent);
    font-style: italic;
  }

  .share-row {
    margin-bottom: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .btn-action {
    background: var(--accent-subtle);
    color: var(--accent);
    border: none;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s;
    margin-bottom: 0.75rem;
  }

  .btn-action:hover {
    background: var(--accent-subtle-strong);
  }

  .btn-action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .btn-delete {
    margin-right: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--danger, #ef4444);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: background 0.15s, border-color 0.15s;
  }

  .btn-delete:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent 90%);
    border-color: var(--danger, #ef4444);
  }

  .btn-todo {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-todo:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .btn-todo:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-todo-top {
    margin-left: auto;
  }

  .btn-cancel {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn-cancel:hover {
    border-color: var(--text-muted);
  }

  .btn-edit {
    background: var(--accent);
    border: none;
    color: white;
    padding: 0.45rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-edit:hover {
    opacity: 0.9;
  }

  .move-container {
    position: relative;
  }

  .btn-move {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-move:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .move-dropdown {
    position: fixed;
    min-width: 200px;
    max-width: 280px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.3rem;
    z-index: 300;
    box-shadow: 0 8px 24px var(--shadow);
    overflow-y: auto;
  }

  .move-backdrop {
    position: fixed;
    inset: 0;
    z-index: 250;
    background: none;
    border: none;
    padding: 0;
    cursor: default;
  }

  .move-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.8rem;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
  }

  .move-option:hover {
    background: var(--accent-subtler);
  }

  .move-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .move-group-prefix {
    font-weight: 600;
    font-size: 0.78rem;
  }

  .move-divider {
    height: 1px;
    background: var(--border);
    margin: 0.2rem 0;
  }

  .move-empty {
    padding: 0.4rem 0.5rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
</style>
