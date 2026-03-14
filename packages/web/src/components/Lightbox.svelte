<script lang="ts">
  import rs from '../lib/rs';

  let { src, alt = '', onclose, filePath, mimeType, filename, ondelete }: {
    src: string;
    alt?: string;
    onclose: () => void;
    filePath?: string;
    mimeType?: string;
    filename?: string;
    ondelete?: () => void;
  } = $props();

  const STORAGE_KEY = 'inbox-rs-shared';

  function getSharedMap(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function storageKey(): string {
    // Use filePath if available (stable across reconnects), otherwise strip query params from src
    if (filePath) return filePath;
    try { const u = new URL(src); return u.origin + u.pathname; }
    catch { return src; }
  }

  function saveSharedUrl(key: string, url: string) {
    const map = getSharedMap();
    map[key] = url;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  }

  // Check if already saved — use stable key (no tokens)
  const existingUrl = $derived(getSharedMap()[storageKey()]);
  let shareState = $state<'idle' | 'sharing' | 'done' | 'error'>('idle');
  let publicUrl = $state('');

  $effect(() => {
    if (existingUrl && shareState === 'idle') {
      publicUrl = existingUrl;
      shareState = 'done';
    }
  });
  let copied = $state(false);
  let deleting = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  async function share() {
    if (shareState === 'sharing') return;
    shareState = 'sharing';

    try {
      const shares = (rs as any).shares;
      if (!shares) throw new Error('Shares module not available');

      // Fetch image data — works for both RS file URLs and external URLs
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
      const data = await resp.arrayBuffer();

      const resolvedMime = mimeType || resp.headers.get('content-type') || 'application/octet-stream';
      const name = filename || filePath?.split('/').pop() || 'image.jpg';

      const shareUrl = await shares.storeFile(resolvedMime, name, data);
      publicUrl = shareUrl;
      shareState = 'done';
      saveSharedUrl(storageKey(), shareUrl);
    } catch {
      shareState = 'error';
      setTimeout(() => { shareState = 'idle'; }, 2000);
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(publicUrl);
    copied = true;
    setTimeout(() => { copied = false; }, 1500);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lightbox-overlay" onclick={onclose}>
  <img
    class="lightbox-img"
    {src}
    {alt}
    onclick={(e) => e.stopPropagation()}
  />
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="lightbox-toolbar" onclick={(e) => e.stopPropagation()}>
    {#if shareState === 'done'}
      <span class="saved-indicator">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Sharesome
      </span>
      <button class="toolbar-btn" onclick={copyUrl}>
        {copied ? 'Copied!' : 'Copy link'}
      </button>
      {#if ondelete}
        <button class="toolbar-btn toolbar-btn-danger" onclick={async () => { deleting = true; try { await ondelete?.(); } catch { deleting = false; } }} disabled={deleting}>
          {#if deleting}
            Deleting...
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Delete from inbox
          {/if}
        </button>
      {/if}
    {:else}
      <span class="save-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save to
      </span>
      <button class="toolbar-btn" onclick={share} disabled={shareState === 'sharing'}>
        {#if shareState === 'sharing'}
          Saving...
        {:else if shareState === 'error'}
          Failed
        {:else}
          Sharesome
        {/if}
      </button>
    {/if}
  </div>
  <button class="lightbox-close" onclick={onclose} aria-label="Close">&times;</button>
</div>

<style>
  .lightbox-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    cursor: zoom-out;
  }

  .lightbox-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 8px;
    cursor: default;
  }

  .lightbox-toolbar {
    position: fixed;
    bottom: 1.5rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 6px;
    color: white;
    font-size: 0.85rem;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .toolbar-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.25);
  }

  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toolbar-btn-danger {
    border-color: rgba(239, 68, 68, 0.4);
    color: #fca5a5;
  }

  .toolbar-btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.25);
  }

  .save-label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
  }

  .saved-indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: #4ade80;
  }

  .lightbox-close {
    position: fixed;
    top: 1rem;
    right: 1.5rem;
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
    opacity: 0.7;
    line-height: 1;
  }

  .lightbox-close:hover {
    opacity: 1;
  }
</style>
