<script lang="ts">
  import { buildDate, footerVersionLabel, isStagingBuild } from '../lib/build-info';

  let {
    pluginsActive = false,
    centered = false,
  }: {
    /** Whether the Plugins route is the current page (highlights its link). */
    pluginsActive?: boolean;
    /** Constrain the row to the classic shell's 1200px content column. */
    centered?: boolean;
  } = $props();
</script>

<!-- The visible bar. Both shells wrap this in their own `.app-footer` box,
     which owns how the bar is positioned within that shell's layout; this
     component owns what's in the bar and how it flows at each width. -->
<div class="app-footer-inner">
  <div class="footer-row" class:centered>
    <span class="footer-identity">
      <span class="footer-brand">Inbox RS</span>
      <span class="footer-version" class:staging={isStagingBuild}>{footerVersionLabel}</span>
      {#if buildDate}<span class="footer-date">{buildDate}</span>{/if}
    </span>
    <nav class="footer-nav" aria-label="About Inbox RS">
      <a class="footer-link" class:active={pluginsActive} href="#/plugins">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Plugins
      </a>
      <span class="footer-sep">·</span>
      <a class="footer-link" href="https://github.com/silverbucket/inbox-rs" target="_blank" rel="noopener noreferrer">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
        GitHub
      </a>
    </nav>
  </div>
</div>

<style>
  .app-footer-inner {
    /* Opaque so it reads as one uniform strip: in the sidebar shell it runs
       under the sidebar column and must hide that column's border-right.
       Stacked above in-flow siblings for the same reason — the desktop
       sidebar is position: fixed, which would otherwise paint over the
       bar's left end. The shell's transparent gap above the bar is not part
       of this box, so the sidebar still shows (and receives clicks) there. */
    position: relative;
    z-index: 1;
    padding: 0.85rem 1.5rem;
    border-top: 1px solid var(--border);
    font-size: 0.82rem;
    color: var(--text-muted);
    background: var(--bg);
  }

  /* Identity on the left, links on the right. The row is allowed to wrap,
     and each half keeps its own items together, so a narrow viewport drops
     the links under the identity as a whole rather than breaking the date or
     orphaning a separator. */
  .footer-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.5rem;
  }

  .footer-row.centered {
    max-width: 1200px;
    margin: 0 auto;
  }

  .footer-identity {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.6rem;
    min-width: 0;
  }

  .footer-nav {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }

  .footer-brand {
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--text);
    white-space: nowrap;
  }

  .footer-version {
    font-weight: 700;
    font-size: 0.72rem;
    line-height: 1.3;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 75%, white 25%);
    background: color-mix(in srgb, var(--surface) 86%, black 14%);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  /* A staging bundle shouldn't pass for a release at a glance. */
  .footer-version.staging {
    color: var(--text);
    border-color: color-mix(in srgb, var(--warn) 55%, var(--border));
    background: color-mix(in srgb, var(--warn) 22%, var(--surface));
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .footer-date {
    font-size: 0.78rem;
    font-style: italic;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .footer-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-muted);
    font-size: 0.82rem;
    white-space: nowrap;
    transition: color 180ms ease;
  }

  .footer-link:hover,
  .footer-link.active {
    color: var(--text);
  }

  .footer-link svg {
    flex-shrink: 0;
  }

  .footer-sep {
    opacity: 0.35;
  }

  @media (max-width: 768px) {
    .app-footer-inner {
      padding-inline: 1rem;
    }

    /* Two rows, both flush left: the identity line, then the links. Right-
       aligning the links on their own row reads as a stray on a phone. */
    .footer-nav {
      flex-basis: 100%;
      margin-left: 0;
    }
  }
</style>
