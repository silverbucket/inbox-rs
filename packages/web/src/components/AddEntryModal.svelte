<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { InboxItemType, InboxItem } from '@inbox-rs/rs-module';
  import { storeItem } from '../lib/stores';
  import { transcribeAudio } from '../lib/transcribe';

  let { type, editItem = undefined, onclose }: {
    type: InboxItemType;
    editItem?: InboxItem;
    onclose: () => void;
  } = $props();

  const isEdit = !!editItem;
  let saving = $state(false);

  // Form fields — pre-populate from editItem if editing
  let title = $state(editItem?.title ?? '');
  let url = $state(editItem && 'url' in editItem ? editItem.url : '');
  let body = $state(editItem && 'body' in editItem ? editItem.body ?? '' : '');
  let description = $state(editItem?.description ?? '');
  let language = $state(editItem && 'language' in editItem ? editItem.language ?? '' : '');
  let completed = $state(editItem && 'completed' in editItem ? editItem.completed : false);
  let file = $state<File | null>(null);

  // Voice recording state
  let recording = $state(false);
  let recordingDuration = $state(0);
  let recordedBlob = $state<Blob | null>(null);
  let recordedUrl = $state<string | null>(null);
  let transcript = $state('');
  let transcribing = $state(false);
  let transcriptionId = 0;
  let mediaRecorder: MediaRecorder | null = null;
  let recordingInterval: ReturnType<typeof setInterval> | null = null;

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
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
      recordingInterval = setInterval(() => { recordingDuration++; }, 1000);
    } catch {
      // Mic permission denied or unavailable
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

  function formatTimer(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const addLabels: Record<InboxItemType, string> = {
    'bookmark': 'Add Bookmark',
    'note': 'Add Note',
    'image': 'Add Image',
    'voice-memo': 'Add Voice Memo',
    'document': 'Add File',
    'code-snippet': 'Add Code Snippet',
    'todo': 'Add Todo',
  };

  const editLabels: Record<InboxItemType, string> = {
    'bookmark': 'Edit Bookmark',
    'note': 'Edit Note',
    'image': 'Edit Image',
    'voice-memo': 'Edit Voice Memo',
    'document': 'Edit File',
    'code-snippet': 'Edit Code Snippet',
    'todo': 'Edit Todo',
  };

  function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
  }

  function getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot) : '';
  }

  let error = $state('');

  // For edit mode, check if the item already has a file
  const hasExistingFile = isEdit && 'filePath' in editItem! && !!editItem!.filePath;

  async function handleSubmit() {
    saving = true;
    error = '';
    try {
      const id = isEdit ? editItem!.id : crypto.randomUUID();
      const createdAt = isEdit ? editItem!.createdAt : new Date().toISOString();
      let item: InboxItem;
      let fileData: ArrayBuffer | undefined;

      if (type === 'bookmark') {
        item = { id, type: 'bookmark', title: title || url, url, description: description || undefined, createdAt };
        // Preserve existing bookmark metadata when editing
        if (isEdit && editItem!.type === 'bookmark') {
          const e = editItem!;
          if (e.favicon) (item as any).favicon = e.favicon;
          if (e.ogImage) (item as any).ogImage = e.ogImage;
          if (e.siteName) (item as any).siteName = e.siteName;
          if (e.body) (item as any).body = e.body;
          if (e.filePath) (item as any).filePath = e.filePath;
          if (e.mimeType) (item as any).mimeType = e.mimeType;
        }
      } else if (type === 'note') {
        item = { id, type: 'note', title: title || body.slice(0, 50), body, description: description || undefined, createdAt };
      } else if (type === 'image') {
        if (file) {
          const existingPath = isEdit && editItem!.type === 'image' ? editItem!.filePath : undefined;
          const ext = getExtension(file.name);
          const filePath = existingPath || `files/${id}${ext}`;
          fileData = await file.arrayBuffer();
          item = { id, type: 'image', title: title || file.name, filePath, mimeType: file.type, description: description || undefined, createdAt };
        } else if (isEdit && editItem!.type === 'image') {
          item = { ...editItem!, title: title || editItem!.title, description: description || undefined };
        } else {
          return;
        }
      } else if (type === 'voice-memo') {
        if (recordedBlob || file) {
          const existingPath = isEdit && editItem!.type === 'voice-memo' ? editItem!.filePath : undefined;
          let filePath: string;
          let mimeType: string;
          let duration: number | undefined;
          if (recordedBlob) {
            const ext = recordedBlob.type.includes('webm') ? '.webm' : recordedBlob.type.includes('mp4') ? '.mp4' : '.ogg';
            filePath = existingPath || `files/${id}${ext}`;
            mimeType = recordedBlob.type || 'audio/webm';
            fileData = await recordedBlob.arrayBuffer();
            duration = recordingDuration || undefined;
          } else if (file) {
            const ext = getExtension(file.name);
            filePath = existingPath || `files/${id}${ext}`;
            mimeType = file.type;
            fileData = await file.arrayBuffer();
          } else {
            return;
          }
          const memoBody = body || transcript || undefined;
          const autoTitle = title || transcript || 'Voice memo';
          item = { id, type: 'voice-memo', title: autoTitle, filePath, mimeType, duration, body: memoBody, description: description || undefined, createdAt };
        } else if (isEdit && editItem!.type === 'voice-memo') {
          item = { ...editItem!, title: title || editItem!.title, body: body || undefined, description: description || undefined };
        } else {
          return;
        }
      } else if (type === 'document') {
        if (file) {
          const existingPath = isEdit && editItem!.type === 'document' ? editItem!.filePath : undefined;
          const ext = getExtension(file.name);
          const filePath = existingPath || `files/${id}${ext}`;
          fileData = await file.arrayBuffer();
          item = { id, type: 'document', title: title || file.name, filePath, mimeType: file.type, fileSize: file.size, fileName: file.name, description: description || undefined, createdAt };
        } else if (isEdit && editItem!.type === 'document') {
          item = { ...editItem!, title: title || editItem!.title, description: description || undefined };
        } else {
          return;
        }
      } else if (type === 'code-snippet') {
        item = { id, type: 'code-snippet', title: title || 'Untitled snippet', body, language: language || undefined, description: description || undefined, createdAt };
      } else if (type === 'todo') {
        item = { id, type: 'todo', title, body: body || undefined, completed, completedAt: completed && !(editItem && 'completed' in editItem && editItem.completed) ? new Date().toISOString() : (editItem && 'completedAt' in editItem ? editItem.completedAt : undefined), description: description || undefined, createdAt, isTodo: true };
      } else {
        return;
      }

      // Preserve todo fields when editing
      if (isEdit) {
        if (editItem!.isTodo) item.isTodo = true;
        if (editItem!.completed) item.completed = editItem!.completed;
        if (editItem!.completedAt) item.completedAt = editItem!.completedAt;
      }

      // Remove undefined values — remoteStorage schema validator rejects them
      const cleanItem = JSON.parse(JSON.stringify(item!));
      await storeItem(cleanItem, fileData);
      onclose();
    } catch (e) {
      console.error('Save failed:', e);
      error = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e) || 'Failed to save';
    } finally {
      saving = false;
    }
  }

  async function convertToTodo() {
    saving = true;
    error = '';
    try {
      const updated = { ...editItem!, isTodo: true, completed: false, completedAt: undefined };
      const clean = JSON.parse(JSON.stringify(updated));
      await storeItem(clean);
      onclose();
    } catch (e) {
      console.error('Convert failed:', e);
      error = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e) || 'Failed to convert';
    } finally {
      saving = false;
    }
  }

  function autofocus(node: HTMLElement) {
    requestAnimationFrame(() => node.focus());
  }

  onDestroy(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (recordingInterval) clearInterval(recordingInterval);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  });

  const needsFile = $derived(type === 'image' || type === 'document');
  const canSubmit = $derived(
    saving || recording ? false
    : type === 'voice-memo' ? !!(file || recordedBlob || hasExistingFile)
    : needsFile ? !!(file || hasExistingFile)
    : type === 'bookmark' ? !!url
    : type === 'note' || type === 'code-snippet' ? !!body
    : type === 'todo' ? !!title
    : true
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose}>
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <h2 class="modal-title">{isEdit ? editLabels[type] : addLabels[type]}</h2>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="form" onkeydown={(e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && canSubmit) { e.preventDefault(); handleSubmit(); } }}>
      {#if type === 'bookmark'}
        <label class="field">
          <span>URL *</span>
          <input use:autofocus type="url" bind:value={url} placeholder="https://..." />
        </label>
        <label class="field">
          <span>Title</span>
          <input type="text" bind:value={title} placeholder="Page title" />
        </label>
        <label class="field">
          <span>Note</span>
          <textarea bind:value={description} rows="2" placeholder="Optional note..."></textarea>
        </label>

      {:else if type === 'note'}
        <label class="field">
          <span>Title</span>
          <input type="text" bind:value={title} placeholder="Note title" />
        </label>
        <label class="field">
          <span>Content *</span>
          <textarea use:autofocus bind:value={body} rows="6" placeholder="Write your note..."></textarea>
        </label>

      {:else if type === 'image'}
        <label class="field">
          <span>{hasExistingFile ? 'Replace image' : 'Image *'}</span>
          <input type="file" accept="image/*" onchange={handleFileChange} />
        </label>
        <label class="field">
          <span>Title</span>
          <input use:autofocus type="text" bind:value={title} placeholder="Image title" />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea bind:value={description} rows="2" placeholder="Optional description..."></textarea>
        </label>

      {:else if type === 'voice-memo'}
        {#if !isEdit}
          <div class="field">
            <span>Record</span>
            <div class="recorder">
              {#if recording}
                <span class="rec-indicator"></span>
                <span class="rec-timer">{formatTimer(recordingDuration)}</span>
                <button type="button" class="rec-btn rec-stop" onclick={stopRecording}>Stop</button>
              {:else if recordedBlob}
                <audio controls src={recordedUrl} preload="metadata"></audio>
                <button type="button" class="rec-btn rec-discard" onclick={discardRecording}>Discard</button>
              {:else}
                <button type="button" class="rec-btn rec-start" onclick={startRecording}>Start Recording</button>
              {/if}
            </div>
          </div>
          {#if transcribing}
            <p class="transcript-status">Transcribing...</p>
          {/if}
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
          <textarea class="auto-expand" bind:value={body} rows="3" placeholder="Transcription or notes..."></textarea>
        </label>

      {:else if type === 'document'}
        <label class="field">
          <span>{hasExistingFile ? 'Replace file' : 'File *'}</span>
          <input type="file" onchange={handleFileChange} />
        </label>
        <label class="field">
          <span>Title</span>
          <input use:autofocus type="text" bind:value={title} placeholder="Document title" />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea bind:value={description} rows="2" placeholder="Optional description..."></textarea>
        </label>

      {:else if type === 'code-snippet'}
        <label class="field">
          <span>Title</span>
          <input use:autofocus type="text" bind:value={title} placeholder="Snippet title" />
        </label>
        <label class="field">
          <span>Language</span>
          <input type="text" bind:value={language} placeholder="e.g. javascript, python, rust" />
        </label>
        <label class="field">
          <span>Code *</span>
          <textarea class="code-input" bind:value={body} rows="8" placeholder="Paste your code..."></textarea>
        </label>

      {:else if type === 'todo'}
        <label class="field">
          <span>Title *</span>
          <input use:autofocus type="text" bind:value={title} placeholder="What needs to be done?" />
        </label>
        <label class="field">
          <span>Details</span>
          <textarea bind:value={body} rows="3" placeholder="Optional details..."></textarea>
        </label>
        {#if isEdit}
          <label class="field checkbox-field">
            <input type="checkbox" bind:checked={completed} />
            <span>Completed</span>
          </label>
        {/if}
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        {#if isEdit && type !== 'todo' && !editItem?.isTodo}
          <button class="btn-todo" disabled={saving} onclick={convertToTodo}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
            Make Todo
          </button>
        {/if}
        <button class="btn-cancel" onclick={onclose}>Cancel</button>
        <button class="btn-save" disabled={!canSubmit} onclick={handleSubmit}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
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
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .modal-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.75rem;
  }

  .field span {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .checkbox-field {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  .checkbox-field input[type="checkbox"] {
    accent-color: var(--accent);
  }

  input[type="text"],
  input[type="url"],
  textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    color: var(--text);
    font-family: inherit;
    resize: vertical;
  }

  input[type="text"]:focus,
  input[type="url"]:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  input[type="file"] {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .auto-expand {
    resize: vertical;
    min-height: 4.5em;
    max-height: 50vh;
    overflow-y: auto;
    field-sizing: content;
  }

  .code-input {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    tab-size: 2;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .btn-todo {
    margin-right: auto;
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

  .btn-save {
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

  .btn-save:hover {
    opacity: 0.9;
  }

  .btn-save:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .error {
    color: #ef4444;
    font-size: 0.8rem;
    margin: 0;
  }

  .recorder {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .recorder audio {
    flex: 1;
    height: 36px;
  }

  .rec-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ef4444;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .rec-timer {
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  .rec-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .rec-btn:hover {
    border-color: var(--accent);
  }

  .rec-start {
    border-color: var(--accent);
    color: var(--accent);
  }

  .rec-stop {
    border-color: #ef4444;
    color: #ef4444;
  }

  .rec-discard {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .transcript-status {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
    font-style: italic;
  }

  .transcript {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    white-space: pre-wrap;
    margin: 0;
  }
</style>
