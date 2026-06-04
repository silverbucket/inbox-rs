<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import {
    type BuildItemFn,
    formatRecordingTimer,
  } from '../../lib/add-entry-modal';
  import { buildAudioItem } from '../../lib/build-item';
  import { transcribeAudio } from '../../lib/transcribe';
  import OfflineTranscriptionAssets from '../OfflineTranscriptionAssets.svelte';

  let {
    editItem,
    canSubmit = $bindable(false),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
    canSubmit?: boolean;
    buildItem?: BuildItemFn;
  } = $props();

  const isEdit = !!editItem;
  const hasExistingFile = !!(
    editItem &&
    'filePath' in editItem &&
    editItem.filePath
  );

  let title = $state(editItem?.title ?? '');
  let body = $state(editItem && 'body' in editItem ? (editItem.body ?? '') : '');
  let description = $state(editItem?.description ?? '');
  let file = $state<File | null>(null);

  // Voice recording state — owned entirely by this form so the modal shell
  // doesn't need to know recording exists.
  let recording = $state(false);
  let recordingDuration = $state(0);
  let recordedBlob = $state<Blob | null>(null);
  let recordedUrl = $state<string | null>(null);
  let transcript = $state('');
  let transcribing = $state(false);
  // `transcriptionId` increments each time we kick off a transcription so a
  // late-arriving result from a previous recording can't clobber a fresher
  // capture's transcript.
  let transcriptionId = 0;
  let mediaRecorder: MediaRecorder | null = null;
  let recordingInterval: ReturnType<typeof setInterval> | null = null;
  let recordingError = $state('');

  $effect(() => {
    if (recording) {
      canSubmit = false;
      return;
    }
    canSubmit = !!(file || recordedBlob || hasExistingFile);
  });

  function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
  }

  async function runTranscription(blob: Blob) {
    const myId = ++transcriptionId;
    transcribing = true;
    try {
      const result = await transcribeAudio(blob);
      if (myId !== transcriptionId) return; // discarded
      transcript = result;
      if (transcript && !body) body = transcript;
      if (transcript && !title) title = transcript.slice(0, 50);
    } catch (e) {
      if (myId !== transcriptionId) return;
      console.warn('Transcription failed:', e);
    } finally {
      if (myId === transcriptionId) transcribing = false;
    }
  }

  async function startRecording() {
    recordingError = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        const mimeType = mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        recordedBlob = blob;
        recordedUrl = URL.createObjectURL(blob);
        file = null;
        runTranscription(blob);
      };
      mediaRecorder.start();
      recording = true;
      recordingDuration = 0;
      recordingInterval = setInterval(() => {
        recordingDuration++;
      }, 1000);
    } catch (error) {
      recordingError = 'Microphone access denied or unavailable';
      console.warn('Failed to start recording:', error);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recording = false;
    if (recordingInterval) {
      clearInterval(recordingInterval);
      recordingInterval = null;
    }
  }

  function discardRecording() {
    transcriptionId++; // cancel in-flight transcription
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    recordedBlob = null;
    recordedUrl = null;
    recordingDuration = 0;
    transcript = '';
    transcribing = false;
  }

  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildAudioItem(
      { id, createdAt, editItem: ctxEditItem },
      {
        title,
        body,
        description,
        file,
        recordedBlob,
        recordingDuration,
        transcript,
      },
    );

  onDestroy(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (recordingInterval) clearInterval(recordingInterval);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  });
</script>

{#if !isEdit}
  <div class="field">
    <span>Record</span>
    <div class="recorder">
      {#if recording}
        <span class="rec-indicator"></span>
        <span class="rec-timer">{formatRecordingTimer(recordingDuration)}</span>
        <button type="button" class="rec-btn rec-stop" onclick={stopRecording}
          >Stop</button
        >
      {:else if recordedBlob}
        <!-- See AudioCard.svelte for why an empty captions track is OK here. -->
        <audio controls src={recordedUrl} preload="metadata">
          <track kind="captions" />
        </audio>
        <button
          type="button"
          class="rec-btn rec-discard"
          onclick={discardRecording}>Discard</button
        >
      {:else}
        <button type="button" class="rec-btn rec-start" onclick={startRecording}
          >Start Recording</button
        >
        {#if recordingError}
          <p class="status-text">{recordingError}</p>
        {/if}
      {/if}
    </div>
  </div>
  {#if transcribing}
    <p class="transcript-status">Transcribing...</p>
  {/if}
  <OfflineTranscriptionAssets />
  {#if transcript}
    <div class="field">
      <span>Transcript</span>
      <p class="transcript">{transcript}</p>
    </div>
  {/if}
  {#if !recordedBlob && !recording}
    <label class="field">
      <span>Or upload audio file</span>
      <input type="file" accept="audio/*" onchange={handleFileChange} />
    </label>
  {/if}
{/if}
<label class="field">
  <span>Title</span>
  <input use:autofocus type="text" bind:value={title} placeholder="Memo title" />
</label>
<label class="field">
  <span>Body</span>
  <textarea
    class="auto-expand"
    bind:value={body}
    rows="3"
    placeholder="Transcription or notes..."
  ></textarea>
</label>
