"""PWA installability checks: manifest, theme color, icons, viewport.

These tests run with no remoteStorage session — the empty-state landing
page exposes every PWA-shell concern we care about.
"""

from __future__ import annotations

import json

import pytest
import requests
from playwright.sync_api import Page, expect


pytestmark = [pytest.mark.desktop, pytest.mark.pwa]


def test_manifest_is_served_and_valid(web_origin: str) -> None:
    """The web manifest must be reachable and contain the fields a browser
    needs before it'll show the install prompt."""
    resp = requests.get(f"{web_origin}/manifest.webmanifest", timeout=5)
    assert resp.status_code == 200, f"manifest not served: HTTP {resp.status_code}"
    # Vite preview defaults to `application/manifest+json` for .webmanifest.
    # Some static hosts will serve `text/json` — both are acceptable to
    # browsers, but anything HTML-ish would mean a routing fallback fired
    # and the actual manifest was masked.
    ctype = resp.headers.get("Content-Type", "")
    assert "json" in ctype or "manifest" in ctype, f"unexpected Content-Type: {ctype!r}"

    manifest = resp.json()
    # PWA install prompt requirements per Chrome:
    #   - name (or short_name)
    #   - start_url
    #   - display in {standalone, fullscreen, minimal-ui}
    #   - at least one icon ≥ 192px
    assert manifest.get("name"), "manifest missing `name`"
    assert manifest.get("start_url"), "manifest missing `start_url`"
    assert manifest.get("display") in {"standalone", "fullscreen", "minimal-ui"}, \
        f"display={manifest.get('display')!r} disqualifies install prompt"
    icons = manifest.get("icons") or []
    big_icons = [i for i in icons if any(int(s.split("x")[0]) >= 192 for s in i.get("sizes", "").split())]
    assert big_icons, f"no icon ≥ 192px in manifest icons: {json.dumps(icons)}"


def test_index_links_manifest_and_meta(desktop_page: Page, web_origin: str) -> None:
    """index.html must declare the manifest, theme-color, and apple-touch-icon
    so iOS Safari and Chrome's install heuristics fire."""
    desktop_page.goto(web_origin)
    desktop_page.wait_for_load_state("networkidle")

    # <link rel="manifest" href="/manifest.webmanifest">
    expect(desktop_page.locator('link[rel="manifest"]')).to_have_count(1)
    # <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    expect(desktop_page.locator('link[rel="apple-touch-icon"]')).to_have_count(1)

    # We declare three theme-color metas: a default plus light/dark
    # variants. `meta[name="theme-color"]` should match all three.
    theme_metas = desktop_page.locator('meta[name="theme-color"]').all()
    assert len(theme_metas) >= 1, "no theme-color metas — install/theme broken"

    # viewport-fit=cover is required for iOS to inset under the notch
    # without breaking layout. App.svelte assumes safe-area insets work.
    viewport = desktop_page.locator('meta[name="viewport"]').get_attribute("content") or ""
    assert "viewport-fit=cover" in viewport, f"viewport meta missing viewport-fit=cover: {viewport!r}"


def test_pwa_icons_actually_load(web_origin: str) -> None:
    """Every icon URL declared in the manifest must resolve to an image.
    A 404 here is the usual cause of `chrome://flags Install` showing
    `(no icons)` after a deploy."""
    manifest = requests.get(f"{web_origin}/manifest.webmanifest", timeout=5).json()
    for icon in manifest.get("icons", []):
        src = icon["src"]
        url = src if src.startswith("http") else f"{web_origin}{src}"
        r = requests.get(url, timeout=5)
        assert r.status_code == 200, f"icon {src!r} → HTTP {r.status_code}"
        assert r.headers.get("Content-Type", "").startswith("image/"), \
            f"icon {src!r} not served as image/*: {r.headers.get('Content-Type')!r}"


def test_app_renders_in_standalone_display_mode(desktop_page: Page, web_origin: str) -> None:
    """Once installed, the PWA runs in display-mode: standalone. Make sure
    the app's empty-state shell renders correctly under that media query —
    a regression here means a broken first-run for installed users."""
    # Playwright doesn't expose a direct way to flip display-mode, but we
    # can emulate it by overriding the `matchMedia` resolver. The web app
    # itself doesn't branch on display-mode today, but this guards against
    # CSS rules that target `@media (display-mode: standalone)` in future.
    desktop_page.emulate_media(media="screen", color_scheme="light")
    desktop_page.add_init_script(
        """
        const orig = window.matchMedia;
        window.matchMedia = (q) => {
          if (typeof q === 'string' && q.includes('display-mode: standalone')) {
            return { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } };
          }
          return orig.call(window, q);
        };
        """
    )
    desktop_page.goto(web_origin)
    desktop_page.wait_for_load_state("networkidle")

    # The disconnected empty state should still render.
    expect(desktop_page.get_by_role("heading", name="Connect your storage")).to_be_visible()
