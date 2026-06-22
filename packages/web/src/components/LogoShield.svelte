<!--
  Inbox RS logo. Fully theme-aware via CSS variables: the shield follows the
  active --accent (so it recolours with the chosen theme), the wordmark follows
  --text (so it adapts to light/dark). No script needed.
-->
<svg aria-hidden="true" viewBox="0 0 155 40" xmlns="http://www.w3.org/2000/svg" class="logo-shield">
  <g transform="translate(4, 2) scale(1.15)">
    <path class="shield" d="M16 2 L28 7 L28 16 Q28 26 16 30 Q4 26 4 16 L4 7 Z" />
    <path class="tray" d="M8 15 L10.5 23 L13 23 L13 20 Q13 19 14.5 19 L17.5 19 Q19 19 19 20 L19 23 L21.5 23 L24 15 Z" />
    <rect class="mark" x="14.8" y="7" width="2.4" height="7" rx="1.2" />
    <polygon class="mark" points="16,16 12,12 13.5,10.8 16,13.5 18.5,10.8 20,12" />
  </g>
  <text
    class="wordmark"
    x="44"
    y="27"
    font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    font-weight="700"
    font-size="22"
    letter-spacing="-0.02em"
  >Inbox <tspan class="rs">RS</tspan></text>
</svg>

<style>
  .logo-shield {
    display: block;
  }
  .shield {
    fill: var(--accent);
  }
  .tray {
    fill: color-mix(in srgb, var(--accent) 52%, white);
  }
  .mark {
    fill: #f3f4f8;
  }
  .wordmark {
    fill: var(--text);
  }
  .rs {
    fill: var(--accent);
  }
</style>
