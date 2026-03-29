<script lang="ts">
  import chromeLogo from '../assets/logos/chrome.svg';
  import braveLogo from '../assets/logos/brave.svg';
  import firefoxLogo from '../assets/logos/firefox.svg';
  import thunderbirdLogo from '../assets/logos/thunderbird.svg';
  import { pluginArtifactVersion, pluginArtifacts } from '../lib/plugin-downloads.generated';

  type PluginCard = {
    browser: string;
    eyebrow: string;
    description: string;
    downloadLabel: string;
    downloadHref: string;
    format: string;
    note: string;
    steps: string[];
    accentClass: string;
    logoSrc: string;
  };

  const pluginCards: PluginCard[] = [
    {
      browser: 'Chrome',
      eyebrow: 'Chromium Build',
      description: 'Manual install for Chrome with the full extension bundle packaged from this release.',
      downloadLabel: 'Download Chrome Bundle',
      downloadHref: pluginArtifacts.chromium,
      format: 'ZIP',
      note: 'Chrome does not support direct installation from an arbitrary website; load this bundle as an unpacked extension after extracting it.',
      steps: [
        'Download and unzip the bundle.',
        'Open chrome://extensions and enable Developer mode.',
        'Choose Load unpacked and select the extracted folder.',
      ],
      accentClass: 'chrome',
      logoSrc: chromeLogo,
    },
    {
      browser: 'Brave',
      eyebrow: 'Chromium Build',
      description: 'Uses the same Chromium package as Chrome, with Brave-specific install steps.',
      downloadLabel: 'Download Brave Bundle',
      downloadHref: pluginArtifacts.chromium,
      format: 'ZIP',
      note: 'Brave installs this as an unpacked Chromium extension; it is not a one-click web install.',
      steps: [
        'Download and unzip the bundle.',
        'Open brave://extensions and enable Developer mode.',
        'Choose Load unpacked and select the extracted folder.',
      ],
      accentClass: 'brave',
      logoSrc: braveLogo,
    },
    {
      browser: 'Firefox',
      eyebrow: 'Signed-Like Package',
      description: 'A packaged Firefox add-on build for temporary/manual installation during self-hosted deployment.',
      downloadLabel: 'Download Firefox Add-on',
      downloadHref: pluginArtifacts.firefox,
      format: 'XPI',
      note: 'Local `.xpi` installation support varies by Firefox context; temporary install via debugging remains the most reliable path for unsigned builds.',
      steps: [
        'Download the `.xpi` package.',
        'Open about:debugging#/runtime/this-firefox.',
        'Choose Load Temporary Add-on and select the downloaded `.xpi`.',
      ],
      accentClass: 'firefox',
      logoSrc: firefoxLogo,
    },
    {
      browser: 'Thunderbird',
      eyebrow: 'MailExtension',
      description: 'Packaged Thunderbird extension for saving the currently viewed email into Inbox RS.',
      downloadLabel: 'Download Thunderbird Add-on',
      downloadHref: pluginArtifacts.thunderbird,
      format: 'XPI',
      note: 'Thunderbird can install the packaged add-on directly from the downloaded file.',
      steps: [
        'Download the `.xpi` package.',
        'Open Thunderbird Add-ons and Themes.',
        'Use the gear menu, choose Install Add-on From File, and select the package.',
      ],
      accentClass: 'thunderbird',
      logoSrc: thunderbirdLogo,
    },
  ];
</script>

<section class="plugins-page">
  <div class="hero-panel">
    <div class="hero-copy">
      <p class="eyebrow">Installers</p>
      <h2>Take Inbox RS beyond the browser tab.</h2>
      <p class="lede">
        Download the current plugin builds directly from this deployment. Every installer on this page ships inside the web app output, so a copied `dist` folder still gives users everything they need.
      </p>
    </div>
    <div class="hero-meta">
      <div class="meta-card">
        <span class="meta-label">Release</span>
        <strong>{pluginArtifactVersion}</strong>
      </div>
      <div class="meta-card">
        <span class="meta-label">Included Assets</span>
        <strong>Chromium ZIP + 2 XPIs</strong>
      </div>
    </div>
  </div>

  <div class="cards-grid">
    {#each pluginCards as plugin}
      <article class={`plugin-card ${plugin.accentClass}`}>
        <div class="card-topline">
          <div class="card-heading">
            <div class={`logo-badge ${plugin.accentClass}`} aria-hidden="true">
              <img src={plugin.logoSrc} alt="" />
            </div>
            <span class="card-eyebrow">{plugin.eyebrow}</span>
          </div>
          <span class="file-pill">{plugin.format}</span>
        </div>

        <div class="card-copy">
          <h3>{plugin.browser}</h3>
          <p>{plugin.description}</p>
        </div>

        <a class="download-button" href={plugin.downloadHref} download>
          {plugin.downloadLabel}
        </a>

        <p class="install-note">{plugin.note}</p>

        <ol class="steps">
          {#each plugin.steps as step}
            <li>{step}</li>
          {/each}
        </ol>
      </article>
    {/each}
  </div>
</section>

<style>
  .plugins-page {
    display: grid;
    gap: clamp(1.5rem, 3vw, 2.5rem);
  }

  .hero-panel {
    position: relative;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1.8fr) minmax(260px, 0.9fr);
    gap: clamp(1.25rem, 3vw, 2rem);
    padding: clamp(1.4rem, 3vw, 2.2rem);
    border: 1px solid color-mix(in srgb, var(--border) 70%, var(--accent) 30%);
    border-radius: calc(var(--radius) * 1.5);
    background:
      radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 20%, transparent), transparent 38%),
      linear-gradient(135deg, color-mix(in srgb, var(--surface) 82%, black 18%), color-mix(in srgb, var(--surface) 94%, var(--accent) 6%));
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
  }

  .hero-panel::after {
    content: '';
    position: absolute;
    inset: auto -10% -35% auto;
    width: 240px;
    height: 240px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 24%, transparent);
    filter: blur(60px);
    pointer-events: none;
  }

  .hero-copy {
    display: grid;
    gap: 0.85rem;
    max-width: 42rem;
  }

  .eyebrow,
  .card-eyebrow,
  .meta-label {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .hero-copy h2 {
    font-size: clamp(2rem, 4vw, 3.35rem);
    line-height: 0.96;
    letter-spacing: -0.05em;
    max-width: 12ch;
  }

  .lede {
    max-width: 50rem;
    color: color-mix(in srgb, var(--text) 88%, var(--text-muted) 12%);
    font-size: 1.02rem;
  }

  .hero-meta {
    display: grid;
    gap: 1rem;
    align-content: end;
  }

  .meta-card {
    display: grid;
    gap: 0.35rem;
    padding: 1rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--border) 78%, white 22%);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--surface) 88%, black 12%);
  }

  .meta-card strong {
    font-size: 1.05rem;
    letter-spacing: -0.02em;
  }

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .plugin-card {
    position: relative;
    display: grid;
    gap: 1rem;
    padding: 1.2rem;
    border-radius: calc(var(--radius) * 1.25);
    border: 1px solid var(--border);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--surface) 88%, black 12%), color-mix(in srgb, var(--surface) 96%, black 4%));
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.16);
    transition: transform 180ms ease, border-color 180ms ease;
  }

  .plugin-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    opacity: 0.45;
    pointer-events: none;
  }

  .plugin-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent) 36%, var(--border) 64%);
  }

  .plugin-card.chrome::before {
    background: linear-gradient(135deg, rgba(66, 133, 244, 0.16), transparent 46%);
  }

  .plugin-card.brave::before {
    background: linear-gradient(135deg, rgba(251, 84, 43, 0.18), transparent 48%);
  }

  .plugin-card.firefox::before {
    background: linear-gradient(135deg, rgba(255, 113, 57, 0.18), transparent 48%);
  }

  .plugin-card.thunderbird::before {
    background: linear-gradient(135deg, rgba(89, 116, 242, 0.2), transparent 48%);
  }

  .card-topline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .card-heading {
    display: flex;
    align-items: center;
    gap: 0.95rem;
    min-width: 0;
  }

  .logo-badge {
    position: relative;
    width: 3.4rem;
    height: 3.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 1.15rem;
    border: 1px solid color-mix(in srgb, var(--border) 58%, white 42%);
    background: color-mix(in srgb, var(--surface) 58%, black 42%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 16px 34px rgba(0, 0, 0, 0.18);
    overflow: hidden;
  }

  .logo-badge::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    opacity: 1;
    pointer-events: none;
  }

  .logo-badge::after {
    content: '';
    position: absolute;
    inset: 1px;
    border-radius: calc(1.15rem - 1px);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 38%);
    pointer-events: none;
  }

  .logo-badge img {
    position: relative;
    z-index: 1;
    width: 2.25rem;
    height: 2.25rem;
    display: block;
    object-fit: contain;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.22));
  }

  .logo-badge.chrome {
    border-color: rgba(66, 133, 244, 0.42);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 18px 34px rgba(66, 133, 244, 0.2);
  }

  .logo-badge.chrome::before {
    background:
      radial-gradient(circle at 26% 24%, rgba(234, 67, 53, 0.78), transparent 34%),
      radial-gradient(circle at 80% 26%, rgba(251, 188, 5, 0.72), transparent 38%),
      radial-gradient(circle at 52% 82%, rgba(52, 168, 83, 0.76), transparent 40%),
      linear-gradient(180deg, rgba(66, 133, 244, 0.56), rgba(20, 22, 30, 0.2));
  }

  .logo-badge.brave {
    border-color: rgba(251, 84, 43, 0.44);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 18px 34px rgba(251, 84, 43, 0.22);
  }

  .logo-badge.brave::before {
    background:
      radial-gradient(circle at 50% 24%, rgba(255, 204, 133, 0.44), transparent 28%),
      radial-gradient(circle at 50% 72%, rgba(255, 117, 72, 0.32), transparent 34%),
      linear-gradient(180deg, rgba(251, 84, 43, 0.78), rgba(123, 39, 18, 0.48) 58%, rgba(20, 22, 30, 0.18));
  }

  .logo-badge.firefox {
    border-color: rgba(255, 113, 57, 0.44);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 18px 34px rgba(255, 113, 57, 0.22);
  }

  .logo-badge.firefox::before {
    background:
      radial-gradient(circle at 74% 24%, rgba(255, 211, 111, 0.7), transparent 28%),
      radial-gradient(circle at 34% 74%, rgba(255, 113, 57, 0.58), transparent 36%),
      linear-gradient(180deg, rgba(255, 113, 57, 0.72), rgba(97, 38, 125, 0.42) 64%, rgba(20, 22, 30, 0.18));
  }

  .logo-badge.thunderbird {
    border-color: rgba(89, 116, 242, 0.4);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 18px 34px rgba(89, 116, 242, 0.2);
  }

  .logo-badge.thunderbird::before {
    background:
      radial-gradient(circle at 50% 18%, rgba(219, 228, 255, 0.44), transparent 24%),
      radial-gradient(circle at 50% 80%, rgba(89, 116, 242, 0.28), transparent 34%),
      linear-gradient(180deg, rgba(89, 116, 242, 0.7), rgba(37, 52, 140, 0.42) 58%, rgba(20, 22, 30, 0.18));
  }

  .file-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 3.75rem;
    padding: 0.35rem 0.55rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 75%, white 25%);
    background: color-mix(in srgb, var(--surface) 86%, black 14%);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .card-copy {
    display: grid;
    gap: 0.55rem;
  }

  .card-copy h3 {
    font-size: 1.45rem;
    letter-spacing: -0.03em;
  }

  .card-copy p,
  .install-note {
    color: color-mix(in srgb, var(--text) 86%, var(--text-muted) 14%);
  }

  .download-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-height: 2.75rem;
    padding: 0 1rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, var(--surface) 82%);
    color: var(--text);
    font-weight: 600;
    letter-spacing: -0.01em;
    transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;
  }

  .download-button:hover {
    transform: translateY(-1px);
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 24%, var(--surface) 76%);
    border-color: color-mix(in srgb, var(--accent) 70%, transparent);
  }

  .steps {
    display: grid;
    gap: 0.65rem;
    margin: 0;
    padding-left: 1.25rem;
    color: var(--text);
  }

  .steps li::marker {
    color: var(--accent);
    font-weight: 700;
  }

  @media (max-width: 860px) {
    .hero-panel,
    .cards-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
