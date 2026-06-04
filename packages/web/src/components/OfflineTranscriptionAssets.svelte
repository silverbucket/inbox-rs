<script lang="ts">
  import { onMount } from 'svelte';
  import {
    downloadTranscriptionAssets,
    formatTranscriptionAssetBytes,
    getTranscriptionAssetStatus,
    type TranscriptionAssetStatus,
  } from '../lib/transcription-assets';

  let status = $state<TranscriptionAssetStatus | null>(null);
  let downloading = $state(false);
  let error = $state('');

  const percent = $derived(
    status && status.totalBytes > 0
      ? Math.round((status.storedBytes / status.totalBytes) * 100)
      : 0,
  );

  onMount(() => {
    void refreshStatus();
  });

  async function refreshStatus() {
    status = await getTranscriptionAssetStatus();
  }

  async function downloadAssets() {
    downloading = true;
    error = '';
    try {
      status = await downloadTranscriptionAssets((progress) => {
        status = progress;
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Download failed';
    } finally {
      downloading = false;
    }
  }
</script>

<div class="offline-transcription">
  {#if status?.ready}
    <p>Transcription model saved for offline use.</p>
  {:else if status}
    <p>
      Download transcription model for offline use ({formatTranscriptionAssetBytes(
        status.totalBytes,
      )}).
    </p>
    <button type="button" onclick={downloadAssets} disabled={downloading}>
      {downloading ? `Downloading ${percent}%` : 'Download offline transcription'}
    </button>
    {#if downloading}
      <progress max="100" value={percent}>{percent}%</progress>
    {/if}
  {/if}
  {#if error}
    <p class="error">{error}</p>
  {/if}
</div>

<style>
  .offline-transcription {
    display: grid;
    gap: 0.45rem;
    margin-top: 0.65rem;
    color: var(--text-muted);
    font-size: 0.86rem;
  }

  .offline-transcription p {
    margin: 0;
  }

  .offline-transcription button {
    justify-self: start;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    padding: 0.42rem 0.75rem;
    font: inherit;
    cursor: pointer;
  }

  .offline-transcription button:disabled {
    cursor: default;
    opacity: 0.65;
  }

  .offline-transcription progress {
    width: min(18rem, 100%);
  }

  .offline-transcription .error {
    color: var(--danger);
  }
</style>
