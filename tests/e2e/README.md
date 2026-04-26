# inbox-rs end-to-end / PWA tests

A Python + Playwright suite that drives the **production-built** web app
through Chromium, exercising it as both a desktop PWA and a Pixel-class
mobile PWA. Runs in CI on every PR (`.github/workflows/ci.yml`) and is a
gate on the release workflow.

## What it covers

| Suite | Focus |
|-------|-------|
| `desktop/test_pwa_manifest.py` | manifest reachable, install-prompt requirements, icons load, standalone display mode |
| `desktop/test_navigation.py` | hash routing, nav-button `aria-current`, fallback to inbox |
| `desktop/test_connect_flow.py` | full OAuth round-trip against Armadietto, disconnect resets UI |
| `desktop/test_offline_resilience.py` | warm-offline keeps SPA usable; cold-offline characterization (will flip when SW lands) |
| `desktop/test_offline_then_connect.py` | offline → online → connect, for both a brand-new account *and* an existing account with pre-seeded data that must sync down |
| `desktop/test_inbox_crud.py` | add a Note via the modal, see it in the grid (smoke for the change-event path) |
| `mobile/test_mobile_layout.py` | 768 px breakpoint promotes header to grid, logo shrinks, touch targets sized |
| `mobile/test_touch_interactions.py` | `tap()` (touch dispatch) opens menus and navigates |
| `mobile/test_modal_scroll_lock.py` | iOS body-scroll-lock fixed on open, restored on close |
| `mobile/test_mobile_pwa.py` | media-scoped `theme-color` metas resolve to the right value under dark/light |

## Architecture

```
tests/e2e/
├── conftest.py            ← session/per-test fixtures (browser, RS user, token)
├── pytest.ini             ← test discovery, default args, markers
├── helpers/
│   ├── armadietto.py      ← signup + OAuth via plain HTTP (no UI flake)
│   └── pwa.py             ← localStorage seed shim, viewport profiles, console capture
├── scripts/
│   └── with_servers.py    ← starts armadietto + vite preview, waits, runs pytest, cleans up
├── desktop/               ← desktop-viewport tests
└── mobile/                ← mobile-emulated tests (Pixel-5 profile, has_touch)
```

The suite **does not** spin up its own remoteStorage server — it expects
Armadietto to already be reachable on `http://localhost:8000`. The
`scripts/with_servers.py` wrapper takes care of that for both local and
CI invocations:

1. Build the web app (`npm run build`).
2. `with_servers.py` starts `docker compose up armadietto` and
   `vite preview` (port 4173), waiting for both ports to bind.
3. Run `pytest tests/e2e`.
4. Tear down both servers cleanly on exit.

## Running locally

One-time setup:

```bash
# Python deps (use a venv if you prefer; system Python works too)
pip3 install -r tests/e2e/requirements.txt
python3 -m playwright install chromium

# Build the web app once so vite preview has something to serve
npm run build -w packages/web
```

Then either of:

```bash
# Full suite (recommended)
npm run test:e2e

# Or run the harness directly with custom pytest args
python3 tests/e2e/scripts/with_servers.py \
  --server "docker compose up armadietto" --port 8000 \
  --server "npm run preview -w packages/web -- --port 4173" --port 4173 \
  -- pytest tests/e2e -k mobile -v
```

Useful pytest flags inherited from `pytest.ini`:

```bash
pytest tests/e2e -m "desktop and not slow"      # desktop only, skip slow
pytest tests/e2e -m mobile                       # mobile only
pytest tests/e2e -m "pwa"                        # PWA-shell tests across both
pytest tests/e2e --browser firefox               # cross-browser sanity check
pytest tests/e2e --headed                        # watch the browser drive itself
```

Failure artefacts (videos, traces, screenshots) land in
`tests/e2e/artifacts/` — `traces` open in
[`playwright show-trace`](https://playwright.dev/python/docs/trace-viewer):

```bash
playwright show-trace tests/e2e/artifacts/<trace>.zip
```

## Iterating against the dev server

The default `WEB_ORIGIN` is `http://localhost:4173` (the `vite preview`
port). For tighter feedback loops you can run pytest against `vite dev`:

```bash
WEB_ORIGIN=http://localhost:5173 pytest tests/e2e -k navigation
```

…but a few tests intentionally assert on production-build behaviour
(asset hashing, manifest path) and will skip or fail under the dev server.
For PR review and release gating the production preview is the source of
truth.

## CI

`.github/workflows/ci.yml` runs the full suite on every PR. The release
workflow (`release.yml`) depends on the CI workflow's success before
publishing — see the `needs:` chain there. Failures upload the artifact
directory so the trace viewer can replay the broken interaction.

## Adding a test

1. Decide whether it's a desktop or mobile concern (or both — use the
   `pwa` marker for things that genuinely apply to both viewports).
2. Use the `connected_*_page` fixture if the test needs RS auth, else
   the bare `desktop_page` / `mobile_page`.
3. Prefer accessible-name selectors (`get_by_role(...)`) over CSS
   classes — Tailwind/Svelte refactors don't break them.
4. If the test exercises console output, end with
   `assert_no_console_errors(log)` from `helpers.pwa`.
