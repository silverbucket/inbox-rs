<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { deleteItem, storeItem, blobUrls, connected } from '../lib/stores';
  import rs, { getFileUrl } from '../lib/rs';
  import { transcribeAudio } from '../lib/transcribe';
  import ShareButton from './ShareButton.svelte';
  import DeleteConfirm from './DeleteConfirm.svelte';
  import hljs from 'highlight.js/lib/core';
  import 'highlight.js/styles/github-dark.min.css';

  const langModules: Record<string, () => Promise<any>> = {
    javascript: () => import('highlight.js/lib/languages/javascript'),
    typescript: () => import('highlight.js/lib/languages/typescript'),
    python: () => import('highlight.js/lib/languages/python'),
    rust: () => import('highlight.js/lib/languages/rust'),
    go: () => import('highlight.js/lib/languages/go'),
    bash: () => import('highlight.js/lib/languages/bash'),
    shell: () => import('highlight.js/lib/languages/shell'),
    json: () => import('highlight.js/lib/languages/json'),
    html: () => import('highlight.js/lib/languages/xml'),
    xml: () => import('highlight.js/lib/languages/xml'),
    css: () => import('highlight.js/lib/languages/css'),
    sql: () => import('highlight.js/lib/languages/sql'),
    java: () => import('highlight.js/lib/languages/java'),
    c: () => import('highlight.js/lib/languages/c'),
    cpp: () => import('highlight.js/lib/languages/cpp'),
    csharp: () => import('highlight.js/lib/languages/csharp'),
    ruby: () => import('highlight.js/lib/languages/ruby'),
    php: () => import('highlight.js/lib/languages/php'),
    swift: () => import('highlight.js/lib/languages/swift'),
    kotlin: () => import('highlight.js/lib/languages/kotlin'),
    yaml: () => import('highlight.js/lib/languages/yaml'),
    markdown: () => import('highlight.js/lib/languages/markdown'),
    dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
    svelte: () => import('highlight.js/lib/languages/xml'),
  };

  const langAliases: Record<string, string> = {
    js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
    sh: 'bash', zsh: 'bash', yml: 'yaml', 'c++': 'cpp', 'c#': 'csharp',
    htm: 'html', md: 'markdown',
  };

  let { item, onclose, onedit }: {
    item: InboxItem;
    onclose: () => void;
    onedit: (item: InboxItem) => void;
  } = $props();

  let showDelete = $state(false);
  let deleting = $state(false);

  // Audio playback — use direct URL like images instead of downloading via getFile
  const audioSrc = $derived(
    item.type === 'audio'
      ? ($blobUrls[item.filePath] || ($connected ? getFileUrl(item.filePath) : null))
      : null
  );

  // Audio transcription
  let transcribing = $state(false);
  let transcriptionError = $state(false);

  // Code highlighting
  let highlightedHtml = $state('');

  // Document download
  let docBlobUrl = $state<string | null>(null);
  let docLoading = $state(false);

  $effect(() => {
    // Track only item to trigger reloads when it changes
    const currentItem = item;

    // Reset per-item state
    transcribing = false;
    transcriptionError = false;
    highlightedHtml = '';
    docBlobUrl = null;
    docLoading = false;

    if (currentItem.type === 'code-snippet') {
      highlightCode();
    }
  });

  async function handleTranscribe() {
    if (item.type !== 'audio') return;
    transcribing = true;
    transcriptionError = false;
    try {
      // Fetch audio data for transcription
      const inbox = (rs as any).inbox;
      const file = await inbox.getFile(item.filePath);
      if (!file?.data) throw new Error('Could not load audio file');
      const blob = new Blob([file.data], { type: item.mimeType });
      const text = await transcribeAudio(blob);
      const updated = {
        ...item,
        body: text || undefined,
        title: text && item.title === 'Audio' ? text.slice(0, 50) : item.title,
        transcribed: true,
      };
      await storeItem(updated);
    } catch (e) {
      console.warn('Transcription failed:', e);
      transcriptionError = true;
    } finally {
      transcribing = false;
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
      highlightedHtml = hljs.highlight(item.body, { language: resolved }).value;
    } else if (hljs.getLanguage(resolved)) {
      highlightedHtml = hljs.highlight(item.body, { language: resolved }).value;
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
      ? ((item.filePath ? ($blobUrls[item.filePath] || ($connected ? getFileUrl(item.filePath) : null)) : null) || item.ogImage || null)
      : item.type === 'image'
        ? ($blobUrls[item.filePath] || ($connected ? getFileUrl(item.filePath) : null))
        : null
  );
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
      <img class="view-image" src={imageSrc} alt=""
        onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
    {/if}

    {#if item.type === 'audio'}
      <div class="player">
        {#if audioSrc}
          <audio controls src={audioSrc} preload="metadata"></audio>
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
        <p class="content-text">{body}</p>
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
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 560px;
    max-height: 90vh;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .type-badge {
    background: rgba(99, 102, 241, 0.15);
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

  .view-image {
    width: 100%;
    max-height: 300px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    margin-bottom: 0.75rem;
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
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent);
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: lowercase;
    margin-bottom: 0.5rem;
  }

  .code {
    background: #0d1117;
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
    color: #e6edf3;
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
    background: rgba(99, 102, 241, 0.15);
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
    background: rgba(99, 102, 241, 0.25);
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
    background: rgba(239, 68, 68, 0.1);
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
</style>
