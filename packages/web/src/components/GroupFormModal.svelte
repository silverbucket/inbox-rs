<script lang="ts">
  import type { CollectionGroup } from '@inbox-rs/rs-module';
  import EntityFormModal from './EntityFormModal.svelte';
  import { randomPresetColor } from '../lib/constants';

  let { group = undefined, onclose, onsave, ondelete = undefined }: {
    group?: CollectionGroup;
    onclose: () => void;
    onsave: (group: CollectionGroup) => void;
    ondelete?: () => void;
  } = $props();

  let name = $state(group?.name ?? '');
  let color = $state(group?.color ?? randomPresetColor());

  function handleSubmit() {
    if (!name.trim()) return;
    onsave({
      id: group?.id ?? crypto.randomUUID(),
      name: name.trim(),
      collectionIds: group?.collectionIds ?? [],
      createdAt: group?.createdAt ?? new Date().toISOString(),
      color,
    });
  }
</script>

<EntityFormModal
  entityName="Group"
  isEdit={!!group}
  bind:name
  bind:color
  namePlaceholder="e.g. Work, Bands, Research"
  maxWidth="400px"
  {onclose}
  onsubmit={handleSubmit}
  {ondelete}
/>
