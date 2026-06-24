<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import type { BuildItemFn } from '../../lib/add-entry-modal';
  import { buildDocumentItem } from '../../lib/build-item';

  let {
    editItem,
    prefillFile = undefined,
    canSubmit = $bindable(false),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
    prefillFile?: File;
    canSubmit?: boolean;
    buildItem?: BuildItemFn;
  } = $props();

  const hasExistingFile = !!(
    editItem &&
    'filePath' in editItem &&
    editItem.filePath
  );

  let title = $state(editItem?.title ?? '');
  let description = $state(editItem?.description ?? '');
  // Seed from a file already chosen in the capture bar's picker (the native
  // input can't be set programmatically — the name is shown below instead).
  let file = $state<File | null>(prefillFile ?? null);

  $effect(() => {
    canSubmit = !!file || hasExistingFile;
  });

  function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
  }

  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildDocumentItem(
      { id, createdAt, editItem: ctxEditItem },
      { title, description, file },
    );
</script>

<label class="field">
  <span>{file || hasExistingFile ? 'Replace file' : 'File *'}</span>
  {#if file}
    <span class="picked">{file.name}</span>
  {/if}
  <input type="file" onchange={handleFileChange} />
</label>
<label class="field">
  <span>Title</span>
  <input
    use:autofocus
    type="text"
    bind:value={title}
    placeholder="Document title"
  />
</label>
<label class="field">
  <span>Description</span>
  <textarea
    bind:value={description}
    rows="2"
    placeholder="Optional description..."
  ></textarea>
</label>
