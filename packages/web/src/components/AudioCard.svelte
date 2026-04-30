<script lang="ts">
  import type { AudioItem } from '@inbox-rs/rs-module';
  import rs from '../lib/rs';
  let { item }: { item: AudioItem } = $props();
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
      const file = await rs.inbox.getFile(item.filePath);
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

<div class="audio">
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
      <!-- User-recorded audio has no separate captions track; the
           transcription text (when present) is rendered alongside the player
           in ViewCardModal. The empty <track> just satisfies the lint rule. -->
      <audio controls src={blobUrl} preload="metadata">
        <track kind="captions" />
      </audio>
    {/if}
  </div>
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


</style>
