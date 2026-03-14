<script lang="ts">
  import type { DocumentItem } from '@inbox-rs/rs-module';
  import rs from '../lib/rs';

  let { item }: { item: DocumentItem } = $props();
  let blobUrl = $state<string | null>(null);
  let loading = $state(false);

  function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function download() {
    if (blobUrl) {
      open(blobUrl);
      return;
    }
    loading = true;
    try {
      const inbox = (rs as any).inbox;
      const file = await inbox.getFile(item.filePath);
      if (file?.data) {
        blobUrl = URL.createObjectURL(new Blob([file.data], { type: item.mimeType }));
        open(blobUrl);
      }
    } finally {
      loading = false;
    }
  }

  function open(url: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName || item.title;
    a.click();
  }
</script>

<div class="document">
  <h3 class="title">{item.title}</h3>
  {#if item.fileName}
    <p class="filename">{item.fileName}</p>
  {/if}
  {#if item.fileSize}
    <span class="size">{formatSize(item.fileSize)}</span>
  {/if}
  <button class="download-btn" onclick={download} disabled={loading}>
    {loading ? 'Loading...' : 'Download'}
  </button>
</div>

<style>
  .title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .filename {
    font-size: 0.8rem;
    color: var(--text-muted);
    word-break: break-all;
  }

  .size {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .download-btn {
    margin-top: 0.5rem;
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent);
    border: none;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .download-btn:hover {
    background: rgba(99, 102, 241, 0.25);
  }

  .download-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
