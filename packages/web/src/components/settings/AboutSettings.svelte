<script lang="ts">import {buildDate, versionLabel} from '../../lib/build-info';</script>
<div class="settings-section"><div class="row wide"><div class="row-main"><div class="row-label">Inbox RS {versionLabel} <span class="deploy-date">Deployed {buildDate}</span></div><div class="row-desc">Your data, your server, no middle tier.</div></div><div class="row-ctl"><a class="btn" href="https://github.com/67P/inbox-rs/releases" target="_blank" rel="noreferrer">What's new</a><a class="btn" href="https://github.com/67P/inbox-rs" target="_blank" rel="noreferrer">Source</a></div></div></div>
<style>
  /* Same small-print treatment as .row-desc — deliberately not bold like
     the version it sits next to. */
  .deploy-date { margin-left: 0.3rem; font-weight: 400; font-style: italic; font-size: 0.79rem; color: var(--text-muted); }
</style>
