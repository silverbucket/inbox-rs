<script lang="ts">
  import type { InboxItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import {
    type BuildItemFn,
    canCaptureTodo,
  } from '../../lib/add-entry-modal';
  import { buildTodoItem } from '../../lib/build-item';
  import { createCodeKeydownHandler } from '../../lib/code-indent';

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

  let title = $state(editItem?.title ?? '');
  let body = $state(editItem && 'body' in editItem ? (editItem.body ?? '') : '');
  let description = $state(editItem?.description ?? '');
  let completed = $state(
    editItem && 'completed' in editItem ? !!editItem.completed : false,
  );

  const handleCodeKeydown = createCodeKeydownHandler();

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
<label class="field">
  <span>Details</span>
  <textarea
    bind:value={body}
    rows="3"
    placeholder="Optional details..."
    onkeydown={handleCodeKeydown}
  ></textarea>
</label>
{#if isEdit}
  <label class="field checkbox-field">
    <input type="checkbox" bind:checked={completed} />
    <span>Completed</span>
  </label>
{/if}
