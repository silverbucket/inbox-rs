# Browser extension review packages

From the repository root, with Node.js 24, npm 11 and Info-ZIP zip/unzip installed:

```sh
npm ci
npm run package:browsers
npm run check:submissions -- chromium firefox
npx playwright install chromium
npm run test:extensions
```

Each browser gets its own binary and matching source ZIP in
`dist/submissions/chromium/` or `dist/submissions/firefox/`. Upload the Firefox
XPI and Firefox source ZIP together to AMO. The Chromium ZIP is the Chrome Web
Store upload. Source ZIPs contain a root README with the simpler reviewer
commands (`npm ci` and `npm run package:submission`), exact environment details,
scoped workspace manifests and a scoped lockfile.

The source archive rebuild must produce identical unpacked files. Dependency
scoping may remove unrelated packages but cannot change retained resolutions.
The validation command also audits the scoped dependency tree and runs Firefox
lint. Installable artifacts are unsigned; publishing/signing happens at the store.

Browser tests use fresh temporary profiles. Chromium comes from Playwright;
Selenium Manager provides Firefox/geckodriver if necessary. Set FIREFOX_BINARY
to an existing Firefox executable to use it instead. Screenshots use fictional
data and are written to `dist/submissions/screenshots/`. See
`docs/BROWSER-EXTENSION-LISTING.md` for listing copy and manual OAuth checks.
