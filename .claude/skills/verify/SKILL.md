---
name: verify
description: How to build, launch, and drive the Inbox RS web app for runtime verification (Playwright against the Vite dev server, local-first — no RS server needed).
---

# Verifying the Inbox RS web app

## Launch

```bash
NODE_OPTIONS= npm run dev        # from repo root; serves web app on http://localhost:5173
```

- Prefix node/npm/npx invocations with `NODE_OPTIONS=` — the harness env
  sometimes carries a stale `--require` preload that crashes node.
- No remoteStorage server needed: the app is local-first and fully usable
  disconnected (data in IndexedDB). `docker-compose up` (Armadietto, port
  8000) is only needed to exercise the sync path.
- Checks: `npm run check` (svelte-check, packages/web), `npm test` (vitest).

## Drive (Playwright)

Playwright ~v1.59 + Chromium are installed at the repo root. Scripts outside
the repo can't resolve the bare specifier — require by absolute path:

```js
const { chromium } = require('<repo>/node_modules/playwright');
const ctx = await chromium.launchPersistentContext(dir, { viewport: {...} });
```

Use `launchPersistentContext` so seeded data (IndexedDB) survives across
script runs; `rm -rf <profile-dir>` for a fresh start.

### Gotchas that cost time

- **Opening a card**: `article.card` ignores clicks that land on inner
  links/buttons, and a bookmark card's title is an external link. Click the
  card's `footer` (the date) — keyboard Enter is unreliable inside
  collection views.
- **Filed items** live on the Collections page inside `CollectionView`
  sections; expand toggles are `aria-label="Expand {name}"` (already
  expanded state persists in appConfig).
- **Nav tabs**: the Todos tab label includes a count badge — match with
  `{ name: /^Todos/ }`, not `exact: true`.
- **Seeding**: capture bar (`Paste a link, jot a note, or drop a file…`) +
  Enter creates a bookmark/note instantly. First group via "Create your
  first group" (name field placeholder `e.g. Work, Bands, Research`);
  collections via Collections page FAB "New collection" (placeholder
  `e.g. Reading List`).
- Offline enrichment fetches (sockethub) fail with console errors — noise,
  not a defect.

## Flows worth driving

Open card modal → header icons / meta strip → "File into collection…" →
CollectionPicker (suggestions, type-to-filter, inline create, Unfile/Inbox)
→ Make a todo → Todos page. Mobile: 390×844 viewport renders the picker as
a bottom sheet.
