<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import type { BuildItemFn } from '../../lib/add-entry-modal';
  import { buildDocumentItem } from '../../lib/build-item';

  let {
    editItem,
    canSubmit = $bindable(false),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
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
  let file = $state<File | null>(null);

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
  <span>{hasExistingFile ? 'Replace file' : 'File *'}</span>
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
