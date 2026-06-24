<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import type { BuildItemFn } from '../../lib/add-entry-modal';
  import { buildImageItem } from '../../lib/build-item';

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
  // Seed from a file already chosen in the capture bar's picker, so the modal
  // opens with it attached (the native input can't be set programmatically —
  // the selected name is shown below instead).
  let file = $state<File | null>(prefillFile ?? null);

  // Save needs either a freshly picked file or, in edit mode, an already-
  // stored image whose metadata we're updating without replacing the bytes.
  $effect(() => {
    canSubmit = !!file || hasExistingFile;
  });

  function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
  }

  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildImageItem(
      { id, createdAt, editItem: ctxEditItem },
      { title, description, file },
    );
</script>

<label class="field">
  <span>{file ? 'Replace image' : hasExistingFile ? 'Replace image' : 'Image *'}</span>
  {#if file}
    <span class="picked">{file.name}</span>
  {/if}
  <input type="file" accept="image/*" onchange={handleFileChange} />
</label>
<label class="field">
  <span>Title</span>
  <input use:autofocus type="text" bind:value={title} placeholder="Image title" />
</label>
<label class="field">
  <span>Description</span>
  <textarea bind:value={description} rows="2" placeholder="Optional description..."
  ></textarea>
</label>
