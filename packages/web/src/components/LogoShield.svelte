<script lang="ts">
  import { onMount } from 'svelte';

  let isLight = $state(false);

  function checkLight() {
    const dt = document.documentElement.getAttribute('data-theme');
    if (dt === 'light') { isLight = true; return; }
    if (dt === 'dark') { isLight = false; return; }
    // system
    isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  }

  onMount(() => {
    checkLight();
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onMq = () => checkLight();
    mq.addEventListener('change', onMq);

    const observer = new MutationObserver(() => checkLight());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      mq.removeEventListener('change', onMq);
      observer.disconnect();
    };
  });
</script>

<svg aria-hidden="true" viewBox="0 0 155 40" xmlns="http://www.w3.org/2000/svg" class="logo-shield">
  <!-- Icon -->
  <g transform="translate(4, 2) scale(1.15)">
    <path d="M16 2 L28 7 L28 16 Q28 26 16 30 Q4 26 4 16 L4 7 Z" fill="#6366f1"/>
    <path d="M8 15 L10.5 23 L13 23 L13 20 Q13 19 14.5 19 L17.5 19 Q19 19 19 20 L19 23 L21.5 23 L24 15 Z" fill="#818cf8"/>
    <rect x="14.8" y="7" width="2.4" height="7" rx="1.2" fill="#e4e6eb"/>
    <polygon points="16,16 12,12 13.5,10.8 16,13.5 18.5,10.8 20,12" fill="#e4e6eb"/>
  </g>
  <!-- Wordmark -->
  <text x="44" y="27" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-weight="700" font-size="22" letter-spacing="-0.02em"
    fill={isLight ? '#1a1d27' : '#e4e6eb'}>Inbox <tspan fill={isLight ? '#4f46e5' : '#6366f1'}>RS</tspan></text>
</svg>

<style>
  .logo-shield {
    display: block;
  }
</style>
