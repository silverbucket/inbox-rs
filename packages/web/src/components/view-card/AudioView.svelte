<script lang="ts">
  import type { AudioItem } from '@inbox-rs/rs-module';
  import 'highlight.js/styles/github-dark.min.css';
  import { renderMarkdown } from '../../lib/markdown';
  import {
    blobUrls,
    browserOnline,
    connected,
    loadFileBlobUrl,
    updateItem,
  } from '../../lib/stores';
  import {
    describeTranscriptionError,
    type TranscriptionProgress,
    transcribeAudio,
    transcriberLoaded,
  } from '../../lib/transcribe';
  import {
    TRANSCRIPTION_MODEL_SIZE_LABEL,
    refreshTranscriptionModelStatus,
    transcriptionModel,
  } from '../../lib/transcription-store';

  let {
    item,
    titleId,
    showTitle = true,
    showBody = true,
    beforeAction = async () => {},
  }: {
    item: AudioItem;
    titleId: string;
    showTitle?: boolean;
    showBody?: boolean;
    beforeAction?: () => Promise<void>;
  } = $props();

  let audioError = $state(false);
  let transcribing = $state(false);
  let transcriptionError = $state('');
  let progress = $state<TranscriptionProgress | null>(null);
  let renderedBody = $state('');
  // Bumped on Cancel so a late result from an abandoned run is ignored.
  let runId = 0;

  const audioSrc = $derived($blobUrls[item.filePath] || null);
  const hasTranscript = $derived(!!item.body || !!item.transcribed);
  // The model downloads on demand, so the only blocking case is being
  // offline with neither a cached copy nor a pipeline already in memory.
  const needsModelButOffline = $derived(
    $transcriptionModel.checked &&
      !$transcriptionModel.ready &&
      !$transcriberLoaded &&
      !$browserOnline,
  );
  const progressLabel = $derived(
    progress?.phase === 'downloading'
      ? `Downloading transcription model ${progress.percent}%`
      : 'Transcribing...',
  );

  $effect(() => {
    void refreshTranscriptionModelStatus();
  });

  // The parent shell wraps the per-type view in `{#key item.id}`, so
  // navigating between audios remounts this component — `audioError` and
  // friends initialise fresh without explicit reset effects.

  // Pass mimeType so the blob is tagged with the clean type from item
  // metadata; see BookmarkView for the longer note.
  $effect(() => {
    // Load from the remote when connected, otherwise the local cache, so
    // offline-captured files still render; retries on reconnect.
    void $connected;
    if (item.filePath) loadFileBlobUrl(item.filePath, item.mimeType);
  });

  $effect(() => {
    const currentItem = item;
    renderedBody = '';
    if (!currentItem.body) return;
    const currentBody = currentItem.body;
    renderMarkdown(currentBody).then((html) => {
      if (item.id === currentItem.id && item.body === currentBody) {
        renderedBody = html;
      }
    });
  });

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async function handleTranscribe() {
    try {
      await beforeAction();
    } catch {
      return;
    }
    // The parent's `{#key item.id}` block destroys this component if the
    // user navigates to a different audio mid-transcription, which cancels
    // any UI updates from the in-flight promise — Svelte simply stops
    // applying state writes from a destroyed component. So we don't need
    // an explicit id-guard around the finally block.
    const myRun = ++runId;
    transcribing = true;
    transcriptionError = '';
    progress = null;
    try {
      // Read the bytes from the player's blob URL rather than
      // `rs.inbox.getFile`. On any device other than the one that captured
      // the recording, the local remoteStorage cache holds a copy that the
      // sync layer ran through a lossy UTF-8 decode (see resolveFileBlobUrl
      // in stores.ts), and decodeAudioData rejects it with EncodingError.
      // The blob URL was built from the raw HTTP response (or, offline,
      // from the bytes we wrote ourselves), so it is always faithful.
      if (!audioSrc) throw new Error('Could not load audio file');
      const resp = await fetch(audioSrc);
      if (!resp.ok) throw new Error('Could not load audio file');
      const blob = new Blob([await resp.arrayBuffer()], {
        type: item.mimeType,
      });
      const text = await transcribeAudio(blob, {
        onProgress: (p) => {
          if (myRun === runId) progress = p;
        },
      });
      if (myRun !== runId) return;
      // Whisper returns an empty string for silence or noise. Writing that
      // would wipe an existing transcript or note on "Transcribe again", so
      // say what happened and leave the item untouched.
      if (!text) {
        transcriptionError = 'No speech detected. Nothing was changed.';
        return;
      }
      // Merge into the live item inside its write queue: a delete that
      // landed while inference ran returns undefined and nothing is written,
      // so transcription can never resurrect a removed card. Edits made
      // meanwhile are kept; only the transcript fields change.
      await updateItem(item.id, (current) => {
        if (!current || current.type !== 'audio') return null;
        const updated: AudioItem = {
          ...current,
          body: text,
          title:
            text && current.title === 'Audio'
              ? text.slice(0, 50)
              : current.title,
          transcribed: true,
        };
        return updated;
      });
      void refreshTranscriptionModelStatus();
    } catch (e) {
      if (myRun !== runId) return;
      console.warn('Transcription failed:', e);
      transcriptionError = describeTranscriptionError(e, {
        online: $browserOnline,
        modelReady: $transcriptionModel.ready,
      });
    } finally {
      if (myRun === runId) {
        transcribing = false;
        progress = null;
      }
    }
  }

  // Cancel stops waiting and resets the UI. A model download already in
  // flight keeps streaming into the local cache, so the next attempt is
  // faster rather than starting over.
  function cancelTranscribe() {
    runId++;
    transcribing = false;
    progress = null;
    transcriptionError = '';
  }
</script>

{#if showTitle}<h2 class="title" id={titleId}>{item.title}</h2>{/if}

<div class="player">
  {#if audioError}
    <p class="status-text">Failed to load audio</p>
  {:else if audioSrc}
    <audio
      controls
      src={audioSrc}
      preload="metadata"
      onerror={() => (audioError = true)}
    >
      <!-- See AudioCard.svelte for why an empty captions track is OK here. -->
      <track kind="captions" />
    </audio>
  {:else}
    <p class="status-text">Connect to load audio</p>
  {/if}
  {#if item.duration}
    <span class="duration">{formatDuration(item.duration)}</span>
  {/if}
  {#if transcribing}
    <p class="status-text" role="status">{progressLabel}</p>
    <button type="button" class="btn-action" onclick={cancelTranscribe}
      >Cancel</button
    >
  {:else if transcriptionError}
    <p class="status-text" role="alert">{transcriptionError}</p>
    <button type="button" class="btn-action" onclick={handleTranscribe}
      >Retry</button
    >
  {:else if audioSrc && needsModelButOffline}
    <p class="status-text">
      Transcription needs a one-time {TRANSCRIPTION_MODEL_SIZE_LABEL} download.
      Connect to the internet to transcribe.
    </p>
  {:else if audioSrc && !hasTranscript}
    <button type="button" class="btn-action" onclick={handleTranscribe}
      >Transcribe</button
    >
  {:else if audioSrc}
    <button type="button" class="btn-link" onclick={handleTranscribe}
      >Transcribe again</button
    >
  {/if}
</div>

{#if showBody && item.body}
  <div class="content-block">
    <span class="content-label">Transcription</span>
    {#if renderedBody}
      <div class="markdown-body">{@html renderedBody}</div>
    {:else}
      <p class="content-text">{item.body}</p>
    {/if}
  </div>
{/if}
