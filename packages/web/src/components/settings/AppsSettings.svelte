<script lang="ts">
  import chromeLogo from '../../assets/logos/chrome.svg';
  import captureLogo from '../../assets/logos/favicon-shield.svg';
  import firefoxLogo from '../../assets/logos/firefox.svg';
  import thunderbirdLogo from '../../assets/logos/thunderbird.svg';
  import { pluginArtifacts } from '../../lib/plugin-downloads.generated';
  import OfflineTranscriptionAssets from '../OfflineTranscriptionAssets.svelte';
</script>

<div class="settings-section">
  <div class="row">
    <div class="capture-logo app-logo" aria-hidden="true">
      <img src={captureLogo} alt="" />
    </div>
    <div class="row-main">
      <div class="row-label">Quick capture app</div>
      <div class="row-desc">
        A single-field window for saving something without opening the inbox.
      </div>
    </div>
    <div class="row-ctl"><a class="btn" href="/capture/">Open</a></div>
  </div>

  <div class="row wide browser-row">
    <div class="browser-logos" aria-hidden="true">
      <span class="capture-logo chrome"><img src={chromeLogo} alt="" /></span>
      <span class="capture-logo firefox"><img src={firefoxLogo} alt="" /></span>
    </div>
    <div class="row-main">
      <div class="row-label">Browser extension</div>
      <div class="row-desc">Save the page you're on with one click. Chrome and Firefox.</div>
    </div>
    <div class="row-ctl">
      <a class="btn" href={pluginArtifacts.chromium.url} download>Get for Chrome</a>
      <a class="btn" href={pluginArtifacts.firefox.url}>Firefox</a>
    </div>
  </div>

  <div class="row">
    <div class="capture-logo thunderbird" aria-hidden="true">
      <img src={thunderbirdLogo} alt="" />
    </div>
    <div class="row-main">
      <div class="row-label">Thunderbird add-on</div>
      <div class="row-desc">Send an email straight to your inbox as a card.</div>
    </div>
    <div class="row-ctl">
      <a class="btn" href={pluginArtifacts.thunderbird.url}>Get add-on</a>
    </div>
  </div>

  <div class="row wide transcription-row">
    <div class="row-main">
      <div class="row-label">Transcribe voice notes offline</div>
      <div class="row-desc"><OfflineTranscriptionAssets /></div>
    </div>
  </div>
</div>

<style>
  .capture-logo {
    display: grid;
    width: var(--capture-logo-size, 2.25rem);
    height: var(--capture-logo-size, 2.25rem);
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    border-radius: 0.7rem;
    background: var(--surface-hover);
    overflow: hidden;
  }

  .capture-logo img {
    display: block;
    width: 1.3rem;
    height: 1.3rem;
  }

  .capture-logo.app-logo img {
    width: 1.85rem;
    height: 1.85rem;
  }

  .capture-logo.chrome {
    background: #4285f4;
  }

  .capture-logo.firefox {
    background: #ff7139;
  }

  .capture-logo.thunderbird {
    background: #5865f2;
  }

  .capture-logo.chrome img,
  .capture-logo.firefox img,
  .capture-logo.thunderbird img {
    filter: brightness(0) invert(1);
  }

  .browser-row {
    --capture-logo-size: 2.25rem;
    --browser-logo-overlap: 0.55rem;
    --browser-logo-column: calc(
      var(--capture-logo-size) + var(--capture-logo-size) - var(--browser-logo-overlap)
    );
  }

  .browser-logos {
    display: flex;
    flex: none;
    width: var(--browser-logo-column);
  }

  .browser-logos .capture-logo + .capture-logo {
    margin-left: calc(-1 * var(--browser-logo-overlap));
    box-shadow: 0 0 0 2px var(--surface);
  }

  @media (max-width: 767px) {
    .settings-section .browser-row .row-main {
      flex: 1 1 calc(100% - var(--browser-logo-column) - 1rem);
    }

    .settings-section .browser-row .row-ctl {
      margin-left: calc(var(--browser-logo-column) + 1rem);
      width: calc(100% - var(--browser-logo-column) - 1rem);
    }
  }
</style>
