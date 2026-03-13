<script lang="ts">
  let { src, alt = '', onclose }: { src: string; alt?: string; onclose: () => void } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lightbox-overlay" onclick={onclose}>
  <img
    class="lightbox-img"
    {src}
    {alt}
    onclick={(e) => e.stopPropagation()}
  />
  <button class="lightbox-close" onclick={onclose}>&times;</button>
</div>

<style>
  .lightbox-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    cursor: zoom-out;
  }

  .lightbox-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 8px;
    cursor: default;
  }

  .lightbox-close {
    position: fixed;
    top: 1rem;
    right: 1.5rem;
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
    opacity: 0.7;
    line-height: 1;
  }

  .lightbox-close:hover {
    opacity: 1;
  }
</style>
