<script lang="ts">
  import rs from '../lib/rs';
  import { getSharedUrl, saveSharedUrl } from '../lib/shared-state';

  let { filePath, mimeType, filename }: {
    filePath: string;
    mimeType?: string;
    filename?: string;
  } = $props();

  const existingUrl = $derived(getSharedUrl(filePath));
  let state = $state<'idle' | 'sharing' | 'done' | 'error'>('idle');
  let publicUrl = $state('');
  let copied = $state(false);

  $effect(() => {
    if (existingUrl && state === 'idle') {
      publicUrl = existingUrl;
      state = 'done';
    }
  });

  async function share() {
    if (state === 'sharing') return;
    state = 'sharing';

    try {
      const shares = (rs as any).shares;
      if (!shares) throw new Error('Shares module not available');

      // Read file via RS inbox module (no token-in-URL)
      const inbox = (rs as any).inbox;
      if (!inbox) throw new Error('Not connected');
      const file = await inbox.getFile(filePath);
      if (!file?.data) throw new Error('File not found');

      const resolvedMime = mimeType || file.mimeType || 'application/octet-stream';
      const name = filename || filePath.split('/').pop() || 'file';

      const shareUrl = await shares.storeFile(resolvedMime, name, file.data);
      publicUrl = shareUrl;
      state = 'done';
      saveSharedUrl(filePath, shareUrl);
    } catch {
      state = 'error';
      setTimeout(() => { state = 'idle'; }, 2000);
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(publicUrl);
    copied = true;
    setTimeout(() => { copied = false; }, 1500);
  }
</script>

{#if state === 'done'}
  <div class="share-result">
    <span class="saved-indicator">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Sharesome
    </span>
    <button class="btn-copy" onclick={copyUrl}>
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  </div>
{:else}
  <div class="share-action">
    <span class="save-label">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Save to
    </span>
    <button
      class="btn-share"
      onclick={share}
      disabled={state === 'sharing'}
    >
      {#if state === 'sharing'}
        Saving...
      {:else if state === 'error'}
        Failed
      {:else}
        Sharesome
      {/if}
    </button>
  </div>
{/if}

<style>
  .btn-share {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-share:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }

  .btn-share:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .share-action {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .save-label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .share-result {
    display: inline-flex;
    gap: 0.3rem;
    align-items: center;
  }

  .saved-indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: #4ade80;
  }

  .btn-copy {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn-copy:hover {
    background: var(--accent-hover);
  }
</style>
