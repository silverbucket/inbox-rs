# inbox-rs end-to-end / PWA tests

A TypeScript + Playwright suite that drives the **production-built** web
app through Chromium, exercising it as both a desktop PWA and a
Pixel-class mobile PWA. Runs in CI on every PR
(`.github/workflows/ci.yml`) and is a gate on the release workflow.

This is its own npm workspace (`@inbox-rs/e2e`) so its dependencies
don't leak into the runtime packages. It imports types from
`@inbox-rs/rs-module` so the seed helpers stay in sync with the live
schemas.

## What it covers

| Spec | Focus |
|------|-------|
| `desktop/pwa-manifest.spec.ts` | manifest reachable, install-prompt requirements, icons load, standalone display mode |
| `desktop/navigation.spec.ts` | hash routing, nav-button `aria-current`, fallback to inbox |
| `desktop/connect-flow.spec.ts` | full OAuth round-trip against Armadietto, disconnect resets UI |
| `desktop/offline-resilience.spec.ts` | warm-offline keeps SPA usable; cold-offline characterization (will flip when SW lands) |
| `desktop/offline-then-connect.spec.ts` | offline → online → connect, both for a brand-new account *and* an existing account with pre-seeded data that must sync down |
| `desktop/inbox-crud.spec.ts` | add a Note via the modal, see it in the grid (smoke for the change-event path) |
| `mobile/mobile-layout.spec.ts` | 768 px breakpoint promotes header to grid, logo shrinks, touch targets sized |
| `mobile/touch-interactions.spec.ts` | `tap()` (touch dispatch) opens menus and navigates |
| `mobile/modal-scroll-lock.spec.ts` | iOS body-scroll-lock fixed on open, restored on close |
| `mobile/mobile-pwa.spec.ts` | media-scoped `theme-color` metas resolve to the right value under dark/light |

## Architecture

```
tests/e2e/
├── package.json            ← workspace, depends on @playwright/test + @inbox-rs/rs-module
├── tsconfig.json
├── playwright.config.ts    ← projects (desktop/mobile), webServer (armadietto + preview)
├── helpers/
│   ├── armadietto.ts       ← signup + OAuth + direct PUT to /storage (no UI flake)
│   ├── pwa.ts              ← localStorage seed shim, console capture
│   └── fixtures.ts         ← test.extend with rsUser, rsToken, freshRsUser, connectedPage
├── desktop/                ← desktop-viewport specs (1440×900)
└── mobile/                 ← Pixel-5 emulated specs (393×851, has-touch)
```

Playwright's `webServer` config takes care of starting Armadietto
(`docker compose up armadietto`, port 8000) and the production preview
(`vite preview`, port 4173) before the suite runs, and shuts both down
on exit. No external harness needed.

## Running locally

One-time setup:

```bash
# Install workspace deps + the chromium browser (~125 MB)
npm ci
npm run test:e2e:install

# Build the web app once so vite preview has something to serve
npm run build -w packages/web
```

Then:

```bash
# Full suite
npm run test:e2e

# Or hand pytest-style flags down to playwright via the workspace:
npm test -w @inbox-rs/e2e -- --grep navigation         # by name
npm test -w @inbox-rs/e2e -- --project=mobile-chromium # mobile only
npm test -w @inbox-rs/e2e -- --headed                  # watch the browser drive itself
npm test -w @inbox-rs/e2e -- --debug                   # step through with the inspector
```

Failure artefacts (videos, traces, screenshots) land in
`tests/e2e/test-results/`. The HTML report opens via:

```bash
npm test -w @inbox-rs/e2e -- --reporter=html
npm run report -w @inbox-rs/e2e
```

## Iterating against the dev server

The default `WEB_ORIGIN` is `http://localhost:4173` (the `vite preview`
port). For tighter feedback loops you can run against `vite dev`:

```bash
WEB_ORIGIN=http://localhost:5173 npm test -w @inbox-rs/e2e -- --grep navigation
```

…but a few tests intentionally assert on production-build behaviour
(asset hashing, manifest path) and will skip or fail under the dev
server. For PR review and release gating the production preview is the
source of truth.

## CI

`.github/workflows/ci.yml` runs the full suite on every PR. The release
workflow (`release.yml`) depends on the CI workflow's success before
publishing — see the `needs:` chain there. Failures upload the
`playwright-report/` and `test-results/` directories so traces can be
replayed locally with `npx playwright show-trace <trace.zip>`.

## Adding a test

1. Decide whether it's a desktop or mobile concern. Cross-cutting
   browser-shell tests can run under both projects by placing the spec
   in either folder and calling out the breakpoint context in the
   docstring.
2. Use the `connectedPage` fixture if the test needs RS auth, otherwise
   the bare `page` fixture. For tests that need a *fresh* account (e.g.
   first-connect or seed-then-sync flows) use `freshRsUser` /
   `freshRsToken`.
3. Prefer accessible-name selectors (`getByRole(...)`) over CSS classes
   — Tailwind/Svelte refactors don't break them.
4. If the test exercises console output, end with `assertNoConsoleErrors(log)`
   from `helpers/pwa.ts`.
