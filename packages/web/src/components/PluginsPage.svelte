<script lang="ts">
  import chromeLogo from '../assets/logos/chrome.svg';
  import firefoxLogo from '../assets/logos/firefox.svg';
  import thunderbirdLogo from '../assets/logos/thunderbird.svg';
  import mobileLogo from '../assets/logos/mobile.svg';
  import { pluginArtifactVersion, pluginArtifacts } from '../lib/plugin-downloads.generated';

  type DownloadOption = {
    name: string;
    compatibility: string;
    downloadLabel: string;
    downloadHref: string;
    format: string;
    note: string;
    steps: string[];
    accentClass: string;
    logoSrc: string;
  };

  const browserDownloads: DownloadOption[] = [
    {
      name: 'Chromium',
      compatibility: 'Chrome, Brave, Edge, and other Chromium browsers',
      downloadLabel: 'Download Chromium Bundle',
      downloadHref: pluginArtifacts.chromium,
      format: 'ZIP',
      note: 'Chromium browsers require loading this as an unpacked extension.',
      steps: [
        'Download and extract the ZIP.',
        'Open your browser\'s extensions page and enable Developer mode.',
        'Click Load unpacked and select the extracted folder.',
      ],
      accentClass: 'chrome',
      logoSrc: chromeLogo,
    },
    {
      name: 'Firefox',
      compatibility: 'Firefox 109+',
      downloadLabel: 'Download Firefox Add-on',
      downloadHref: pluginArtifacts.firefox,
      format: 'XPI',
      note: 'Unsigned builds require temporary installation via the debugging page.',
      steps: [
        'Download the .xpi file.',
        'Open about:debugging#/runtime/this-firefox.',
        'Click Load Temporary Add-on and select the file.',
      ],
      accentClass: 'firefox',
      logoSrc: firefoxLogo,
    },
  ];

  type MobileDownload = {
    name: string;
    compatibility: string;
    repoUrl: string;
    accentClass: string;
    logoSrc: string;
  };

  const mobileDownload: MobileDownload = {
    name: 'Mobile App',
    compatibility: 'iOS & Android',
    repoUrl: 'https://github.com/silverbucket/inbox-rs-mobile',
    accentClass: 'mobile',
    logoSrc: mobileLogo,
  };

  const thunderbirdDownload: DownloadOption = {
    name: 'Thunderbird',
    compatibility: 'Thunderbird 128+',
    downloadLabel: 'Download Thunderbird Add-on',
    downloadHref: pluginArtifacts.thunderbird,
    format: 'XPI',
    note: 'Thunderbird installs the add-on directly from the downloaded file.',
    steps: [
      'Download the .xpi file.',
      'Open Add-ons and Themes from the Thunderbird menu.',
      'Use the gear menu and choose Install Add-on From File.',
    ],
    accentClass: 'thunderbird',
    logoSrc: thunderbirdLogo,
  };
</script>

<section class="plugins-page">
  <div class="hero-panel">
    <div class="hero-copy">
      <p class="eyebrow">Extensions</p>
      <h2>Clip anything to your inbox.</h2>
      <p class="lede">
        Save web pages, emails, and quick notes to your remoteStorage account
        from wherever you're reading — on desktop, mobile, or in your
        email client.
      </p>
    </div>
  </div>

  <section class="extension-section">
    <div class="section-header">
      <h2>Browser Extension</h2>
      <p class="section-lede">
        Save pages, jot quick notes, and right-click any link, image, or
        selected text to send it to your inbox. The extension captures titles,
        URLs, descriptions, and preview images automatically — with
        site-aware extraction for Twitter/X, Reddit, Hacker News, and
        Mastodon posts.
      </p>
      <ul class="feature-list">
        <li><strong>Save Page</strong> — title, URL, description, and preview image</li>
        <li><strong>Quick Note</strong> — free-form text, no URL required</li>
        <li><strong>Context Menu</strong> — right-click to save links, images, or selected text</li>
        <li><strong>Site-Aware</strong> — extracts tweets, Reddit posts, HN stories, and fediverse statuses</li>
      </ul>
    </div>

    <div class="download-grid">
      <p class="grid-label">Choose your browser</p>
      {#each browserDownloads as dl}
        <article class={`download-card ${dl.accentClass}`}>
          <div class="card-topline">
            <div class="card-heading">
              <div class={`logo-badge ${dl.accentClass}`} aria-hidden="true">
                <img src={dl.logoSrc} alt="" />
              </div>
              <div class="card-title-group">
                <h3>{dl.name}</h3>
                <span class="compatibility">{dl.compatibility}</span>
              </div>
            </div>
            <span class="file-pill">{dl.format}</span>
          </div>

          <a class="download-button" href={dl.downloadHref} download>
            {dl.downloadLabel}
          </a>

          <details class="install-details">
            <summary>Installation steps</summary>
            <p class="install-note">{dl.note}</p>
            <ol class="steps">
              {#each dl.steps as step}
                <li>{step}</li>
              {/each}
            </ol>
          </details>
        </article>
      {/each}
    </div>
  </section>

  <section class="extension-section compact">
    <div class="section-header">
      <h2>Thunderbird Add-on</h2>
      <p class="section-lede">
        A toolbar button in the message view for saving emails. Captures the
        subject, author, and body text, and lets you add your own notes before
        saving.
      </p>
    </div>

    <ul class="feature-list">
      <li>
        <strong>One-Click Save</strong> — button appears in the message
        toolbar whenever you're reading an email
      </li>
      <li>
        <strong>Full Extraction</strong> — pulls subject, sender, and the
        plain-text message body
      </li>
      <li>
        <strong>Add Notes</strong> — attach your own context before saving to
        help with future triage
      </li>
    </ul>

    <div class="download-grid single">
      <article class={`download-card ${thunderbirdDownload.accentClass}`}>
        <div class="card-topline">
          <div class="card-heading">
            <div class={`logo-badge ${thunderbirdDownload.accentClass}`} aria-hidden="true">
              <img src={thunderbirdDownload.logoSrc} alt="" />
            </div>
            <div class="card-title-group">
              <h3>{thunderbirdDownload.name}</h3>
              <span class="compatibility">{thunderbirdDownload.compatibility}</span>
            </div>
          </div>
          <span class="file-pill">{thunderbirdDownload.format}</span>
        </div>

        <a class="download-button" href={thunderbirdDownload.downloadHref} download>
          {thunderbirdDownload.downloadLabel}
        </a>

        <details class="install-details">
          <summary>Installation steps</summary>
          <p class="install-note">{thunderbirdDownload.note}</p>
          <ol class="steps">
            {#each thunderbirdDownload.steps as step}
              <li>{step}</li>
            {/each}
          </ol>
        </details>
      </article>
    </div>
  </section>

  <section class="extension-section compact">
    <div class="section-header">
      <h2>Mobile App</h2>
      <p class="section-lede">
        A native capture client for iOS and Android, built with Flutter.
        Quickly save links, notes, and images to your remoteStorage inbox
        from your phone — with share-sheet integration so you can send
        content from any app.
      </p>
    </div>

    <ul class="feature-list">
      <li>
        <strong>Share Sheet</strong> — send links and text from any app
        directly to your inbox
      </li>
      <li>
        <strong>Quick Capture</strong> — open the app, type a note, and save
        in seconds
      </li>
      <li>
        <strong>Cross-Platform</strong> — runs natively on both iOS and
        Android
      </li>
    </ul>

    <div class="download-grid single">
      <article class={`download-card ${mobileDownload.accentClass}`}>
        <div class="card-topline">
          <div class="card-heading">
            <div class={`logo-badge ${mobileDownload.accentClass}`} aria-hidden="true">
              <img src={mobileDownload.logoSrc} alt="" />
            </div>
            <div class="card-title-group">
              <h3>{mobileDownload.name}</h3>
              <span class="compatibility">{mobileDownload.compatibility}</span>
            </div>
          </div>
          <span class="file-pill">SOURCE</span>
        </div>

        <a class="download-button" href={mobileDownload.repoUrl} target="_blank" rel="noopener noreferrer">
          View on GitHub
        </a>

        <details class="install-details">
          <summary>Build instructions</summary>
          <p class="install-note">The mobile app is built from source using Flutter. Pre-built binaries are not yet available.</p>
          <ol class="steps">
            <li>Clone the repository from GitHub.</li>
            <li>Install Flutter and run <code>flutter pub get</code>.</li>
            <li>Build for your target platform, e.g. <code>flutter build apk</code> or <code>flutter build ios</code>.</li>
          </ol>
        </details>
      </article>
    </div>
  </section>

  <footer class="page-footer">
    <div class="footer-meta">
      <span class="footer-version">v{pluginArtifactVersion}</span>
      <span class="footer-sep">·</span>
      <span class="footer-note">Browser extensions and Thunderbird add-on bundled with this release</span>
    </div>
  </footer>
</section>

<style>
  .plugins-page {
    display: grid;
    gap: clamp(2rem, 4vw, 3rem);
  }

  /* ── Hero ── */

  .hero-panel {
    position: relative;
    overflow: hidden;
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

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .hero-copy h2 {
    font-size: clamp(2rem, 4vw, 3.35rem);
    line-height: 0.96;
    letter-spacing: -0.05em;
    max-width: 18ch;
  }

  .lede {
    max-width: 50rem;
    color: color-mix(in srgb, var(--text) 88%, var(--text-muted) 12%);
    font-size: 1.02rem;
  }

  /* ── Section ── */

  .extension-section {
    display: grid;
    gap: 1.25rem;
  }

  .extension-section.compact {
    max-width: calc(50% - 0.5rem);
  }

  .extension-section.compact .feature-list {
    grid-template-columns: 1fr;
  }

  .section-header {
    display: grid;
    gap: 0.65rem;
  }

  .section-header h2 {
    font-size: 1.5rem;
    letter-spacing: -0.03em;
  }

  .section-lede {
    max-width: 52rem;
    color: color-mix(in srgb, var(--text) 86%, var(--text-muted) 14%);
    font-size: 0.95rem;
    line-height: 1.55;
  }

  /* ── Feature List ── */

  .feature-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem 1.5rem;
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.88rem;
    color: color-mix(in srgb, var(--text) 88%, var(--text-muted) 12%);
  }

  .feature-list li {
    line-height: 1.45;
  }

  .feature-list strong {
    color: var(--text);
  }

  /* ── Download Grid ── */

  .grid-label {
    grid-column: 1 / -1;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .download-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .download-grid.single {
    grid-template-columns: minmax(0, 1fr);
  }

  /* ── Download Card ── */

  .download-card {
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

  .download-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    opacity: 0.45;
    pointer-events: none;
  }

  .download-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent) 36%, var(--border) 64%);
  }

  .download-card.chrome::before {
    background: linear-gradient(135deg, rgba(66, 133, 244, 0.16), transparent 46%);
  }

  .download-card.firefox::before {
    background: linear-gradient(135deg, rgba(255, 113, 57, 0.18), transparent 48%);
  }

  .download-card.thunderbird::before {
    background: linear-gradient(135deg, rgba(89, 116, 242, 0.2), transparent 48%);
  }

  .download-card.mobile::before {
    background: linear-gradient(135deg, rgba(80, 200, 120, 0.18), transparent 48%);
  }

  /* ── Card Internals ── */

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

  .card-title-group {
    display: grid;
    gap: 0.15rem;
  }

  .card-title-group h3 {
    font-size: 1.25rem;
    letter-spacing: -0.02em;
  }

  .compatibility {
    font-size: 0.78rem;
    color: var(--text-muted);
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

  .logo-badge.mobile {
    border-color: rgba(80, 200, 120, 0.42);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 18px 34px rgba(80, 200, 120, 0.2);
  }

  .logo-badge.mobile::before {
    background:
      radial-gradient(circle at 40% 28%, rgba(80, 200, 120, 0.6), transparent 32%),
      radial-gradient(circle at 62% 72%, rgba(34, 197, 94, 0.4), transparent 36%),
      linear-gradient(180deg, rgba(80, 200, 120, 0.58), rgba(22, 101, 52, 0.38) 60%, rgba(20, 22, 30, 0.18));
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

  /* ── Download Button ── */

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

  /* ── Install Details ── */

  .install-details {
    font-size: 0.9rem;
  }

  .install-details summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.82rem;
    letter-spacing: 0.02em;
    user-select: none;
  }

  .install-details summary:hover {
    color: var(--text);
  }

  .install-details[open] summary {
    margin-bottom: 0.6rem;
  }

  .install-note {
    color: color-mix(in srgb, var(--text) 86%, var(--text-muted) 14%);
    margin-bottom: 0.5rem;
    font-size: 0.88rem;
  }

  .steps {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding-left: 1.25rem;
    color: var(--text);
  }

  .steps li::marker {
    color: var(--accent);
    font-weight: 700;
  }

  /* ── Responsive ── */

  @media (max-width: 860px) {
    .feature-list,
    .download-grid {
      grid-template-columns: 1fr;
    }

    .extension-section.compact {
      max-width: 100%;
    }
  }

  /* ── Page Footer ── */

  .page-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.25rem 1.5rem;
    border-top: 1px solid var(--border);
    border-radius: calc(var(--radius) * 1.25);
    background: color-mix(in srgb, var(--surface) 92%, black 8%);
  }

  .footer-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .footer-version {
    font-weight: 700;
    font-size: 0.78rem;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 75%, white 25%);
    background: color-mix(in srgb, var(--surface) 86%, black 14%);
    letter-spacing: 0.02em;
  }

  .footer-sep {
    opacity: 0.35;
  }

  .footer-note {
    font-size: 0.78rem;
  }

  @media (max-width: 860px) {
    .page-footer {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.65rem;
      padding: 1rem;
    }

    .footer-meta {
      flex-wrap: wrap;
    }
  }
</style>
