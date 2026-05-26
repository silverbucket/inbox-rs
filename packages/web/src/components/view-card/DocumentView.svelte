<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DocumentItem } from '@inbox-rs/rs-module';
  import rs from '../../lib/rs';

  let { item, titleId }: { item: DocumentItem; titleId: string } = $props();

  let docBlobUrl = $state<string | null>(null);
  let docLoading = $state(false);
  let docError = $state(false);

  // The parent shell wraps the per-type view in `{#key item.id}`, so
  // navigating between documents fully remounts this component and
  // `onDestroy` runs on the way out — that's where the cached blob URL
  // gets revoked. No per-id reset effect needed.
  onDestroy(() => {
    if (docBlobUrl) URL.revokeObjectURL(docBlobUrl);
  });

  function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function downloadDoc() {
    // Reuse the cached blob URL when we already pulled the file once —
    // re-fetching on every Download click would waste bandwidth on
    // metered connections.
    if (docBlobUrl) {
      openDownload(docBlobUrl);
      return;
    }
    docLoading = true;
    docError = false;
    try {
      const file = await rs.inbox.getFile(item.filePath);
      if (file?.data) {
        docBlobUrl = URL.createObjectURL(
          new Blob([file.data], { type: item.mimeType }),
        );
        openDownload(docBlobUrl);
      } else {
        console.error('Document file data is missing or empty', item.filePath);
        docError = true;
      }
    } catch (e) {
      console.error('Failed to download document:', e);
      docError = true;
    } finally {
      docLoading = false;
    }
  }

  function openDownload(url: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName || item.title;
    a.click();
  }
</script>

<h2 class="title" id={titleId}>{item.title}</h2>

{#if item.fileName}
  <p class="meta-text">{item.fileName}</p>
{/if}
{#if item.fileSize}
  <span class="meta-text">{formatSize(item.fileSize)}</span>
{/if}
<button
  type="button"
  class="btn-action"
  onclick={(e) => {
    e.stopPropagation();
    downloadDoc();
  }}
  disabled={docLoading}
>
  {docLoading ? 'Loading...' : 'Download'}
</button>
{#if docError}
  <p class="status-text" role="alert">Failed to load document</p>
{/if}
