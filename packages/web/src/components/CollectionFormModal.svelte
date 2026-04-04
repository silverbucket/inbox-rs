<script lang="ts">
  import type { Collection } from '@inbox-rs/rs-module';
  import EntityFormModal from './EntityFormModal.svelte';

  let { collection = undefined, groupId = undefined, onclose, onsave, ondelete = undefined }: {
    collection?: Collection;
    groupId?: string;
    onclose: () => void;
    onsave: (col: Collection) => void;
    ondelete?: () => void;
  } = $props();

  let name = $state(collection?.name ?? '');
  let description = $state(collection?.description ?? '');
  let color = $state(collection?.color ?? '#6366f1');

  function handleSubmit() {
    if (!name.trim()) return;
    onsave({
      id: collection?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      itemIds: collection?.itemIds ?? [],
      createdAt: collection?.createdAt ?? new Date().toISOString(),
      color,
      groupId: collection?.groupId ?? groupId,
    });
  }
</script>

<EntityFormModal
  entityName="Collection"
  isEdit={!!collection}
  bind:name
  bind:color
  showDescription
  bind:description
  namePlaceholder="e.g. Sockethub Bugs"
  descriptionPlaceholder="What's this collection for?"
  maxWidth="440px"
  {onclose}
  onsubmit={handleSubmit}
  {ondelete}
/>
