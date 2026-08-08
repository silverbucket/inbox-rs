<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import {
    type BuildItemFn,
    canCaptureTodo,
  } from '../../lib/add-entry-modal';
  import { buildTodoItem } from '../../lib/build-item';
  import MarkdownContentField from './MarkdownContentField.svelte';

  let {
    editItem,
    prefillTitle = '',
    canSubmit = $bindable(false),
    draftTitle = $bindable(''),
    buildItem = $bindable(),
  }: {
    editItem?: InboxItem;
    prefillTitle?: string;
    canSubmit?: boolean;
    draftTitle?: string;
    buildItem?: BuildItemFn;
  } = $props();

  const isEdit = !!editItem;

  // Seed from the Todos quick-add when opened via ⌘/Ctrl-Enter.
  let title = $state(editItem?.title ?? prefillTitle);

  // Mirror the draft title up to the shell so the filing picker can
  // surface name-match suggestions for the not-yet-saved item.
  $effect(() => {
    draftTitle = title;
  });
  let body = $state(editItem && 'body' in editItem ? (editItem.body ?? '') : '');
  let description = $state(editItem?.description ?? '');
  let completed = $state(
    editItem && 'completed' in editItem ? !!editItem.completed : false,
  );

  $effect(() => {
    canSubmit = canCaptureTodo(title);
  });

  buildItem = ({ id, createdAt, editItem: ctxEditItem }) =>
    buildTodoItem(
      { id, createdAt, editItem: ctxEditItem },
      { title, body, description, completed },
    );
</script>

<label class="field">
  <span>Title *</span>
  <input
    use:autofocus
    type="text"
    bind:value={title}
    placeholder="What needs to be done?"
  />
</label>
<MarkdownContentField bind:value={body} label="Details" placeholder="Add details..." />
{#if isEdit}
  <label class="field checkbox-field">
    <input type="checkbox" bind:checked={completed} />
    <span>Completed</span>
  </label>
{/if}
