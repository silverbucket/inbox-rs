<script lang="ts">
  import type { InboxItem, TodoItem } from '@inbox-rs/rs-module';
  import { autofocus } from '../../lib/actions';
  import {
    type BuildItemContext,
    type BuildItemFn,
    type BuildItemResult,
    canCaptureTodo,
  } from '../../lib/add-entry-modal';
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

  buildItem = ({ id, createdAt }: BuildItemContext): BuildItemResult => {
    // Stamp `completedAt` only on the false→true transition. Otherwise we
    // pass the editItem's existing value through untouched — including the
    // case where the user *unchecks* a previously-completed todo, where we
    // intentionally retain the historical timestamp instead of clearing it.
    // This matches the pre-refactor behaviour and means the schema can
    // surface "last completed at <time>" hints even on re-opened todos.
    const wasCompleted =
      editItem && 'completed' in editItem && !!editItem.completed;
    const previousCompletedAt =
      editItem && 'completedAt' in editItem ? editItem.completedAt : undefined;
    const completedAt =
      completed && !wasCompleted
        ? new Date().toISOString()
        : previousCompletedAt;
    const item: TodoItem = {
      id,
      type: 'todo',
      title,
      body: body || undefined,
      completed,
      completedAt,
      description: description || undefined,
      createdAt,
      isTodo: true,
    };
    return { item };
  };
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
