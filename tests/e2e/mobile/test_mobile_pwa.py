"""Mobile PWA-specific concerns: theme color, safe-area insets, dark mode."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page


pytestmark = [pytest.mark.mobile, pytest.mark.pwa]


def test_dark_color_scheme_picks_dark_theme_color(mobile_page: Page, web_origin: str) -> None:
    """The HTML declares two media-scoped theme-color metas. iOS Safari
    picks the matching one for the status bar tint. Verify the dark
    variant is the one Chrome's media query picks under prefers-color-scheme:
    dark — which is the one mobile devices on auto-dark land on at night."""
    mobile_page.emulate_media(color_scheme="dark")
    mobile_page.goto(web_origin)
    mobile_page.wait_for_load_state("networkidle")

    # Pick the *active* theme-color via window.matchMedia instead of
    # parsing the HTML — that's how the browser would pick.
    active_color = mobile_page.evaluate(
        """
        () => {
          const metas = document.querySelectorAll('meta[name="theme-color"]');
          for (const m of metas) {
            const media = m.getAttribute('media');
            if (!media) continue;
            if (window.matchMedia(media).matches) return m.getAttribute('content');
          }
          // Fall back to the unscoped one
          const fallback = document.querySelector('meta[name="theme-color"]:not([media])');
          return fallback ? fallback.getAttribute('content') : null;
        }
        """
    )
    assert active_color and active_color.lower() == "#0f1117", (
        f"Dark theme-color should be #0f1117 (matches the dark bg), got {active_color!r}"
    )


def test_light_color_scheme_picks_light_theme_color(mobile_page: Page, web_origin: str) -> None:
    mobile_page.emulate_media(color_scheme="light")
    mobile_page.goto(web_origin)
    mobile_page.wait_for_load_state("networkidle")

    active_color = mobile_page.evaluate(
        """
        () => {
          const metas = document.querySelectorAll('meta[name="theme-color"]');
          for (const m of metas) {
            const media = m.getAttribute('media');
            if (!media) continue;
            if (window.matchMedia(media).matches) return m.getAttribute('content');
          }
          const fallback = document.querySelector('meta[name="theme-color"]:not([media])');
          return fallback ? fallback.getAttribute('content') : null;
        }
        """
    )
    assert active_color and active_color.lower() == "#f8f9fb", (
        f"Light theme-color should be #f8f9fb, got {active_color!r}"
    )
