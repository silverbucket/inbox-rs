<script lang="ts">
  // Test stand-in for ScheduleSheet: a dialog that reports its item.
  let { item, onclose }: { item?: { title?: string }; onclose: () => void } = $props();
</script>

<div role="dialog" aria-label="When?" data-title={item?.title}>
  <button type="button" onclick={onclose}>Close</button>
</div>
