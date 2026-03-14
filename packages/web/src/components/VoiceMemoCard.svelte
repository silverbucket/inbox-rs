<script lang="ts">
  import type { VoiceMemoItem } from '@inbox-rs/rs-module';
  import rs from '../lib/rs';

  let { item }: { item: VoiceMemoItem } = $props();
  let blobUrl = $state<string | null>(null);
  let loading = $state(true);
  let error = $state(false);

  $effect(() => {
    loadAudio();
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  });

  async function loadAudio() {
    try {
      const inbox = (rs as any).inbox;
      const file = await inbox.getFile(item.filePath);
      if (file?.data) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(new Blob([file.data], { type: item.mimeType }));
      } else {
        error = true;
      }
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  }

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<div class="voice-memo">
  <h3 class="title">{item.title}</h3>
  {#if item.duration}
    <span class="duration">{formatDuration(item.duration)}</span>
  {/if}
  <div class="player">
    {#if loading}
      <p class="status">Loading audio...</p>
    {:else if error}
      <p class="status">Failed to load audio</p>
    {:else if blobUrl}
      <audio controls src={blobUrl} preload="metadata"></audio>
    {/if}
  </div>
  {#if item.body}
    <p class="body">{item.body}</p>
  {/if}
</div>

<style>
  .title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .duration {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .player {
    margin-top: 0.5rem;
  }

  audio {
    width: 100%;
    height: 36px;
  }

  .status {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .body {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin-top: 0.5rem;
    white-space: pre-wrap;
    max-height: 8em;
    overflow-y: auto;
  }
</style>
