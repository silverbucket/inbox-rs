"""Hash-based routing on desktop.

App.svelte parses `window.location.hash` to decide which page to render.
We exercise every nav button, plus deep-linking via the URL bar.
"""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import Page, expect

from helpers.pwa import attach_console_capture, assert_no_console_errors


pytestmark = [pytest.mark.desktop]


def test_default_route_renders_inbox_empty_state(desktop_page: Page, web_origin: str) -> None:
    log = attach_console_capture(desktop_page)
    desktop_page.goto(web_origin)
    desktop_page.wait_for_load_state("networkidle")

    # Disconnected → empty state, but the header nav must still be present.
    expect(desktop_page.get_by_role("button", name="Inbox")).to_be_visible()
    expect(desktop_page.get_by_role("button", name="Collections")).to_be_visible()
    expect(desktop_page.get_by_role("heading", name="Connect your storage")).to_be_visible()
    assert_no_console_errors(log)


def test_plugins_page_loads_when_disconnected(desktop_page: Page, web_origin: str) -> None:
    """The Plugins / Downloads page is the one route that should work
    *without* a connection — it's how users get the extension."""
    desktop_page.goto(f"{web_origin}/#/plugins")
    desktop_page.wait_for_load_state("networkidle")

    # The footer Downloads link, when active, mirrors the route — confirm
    # it's marked active so we know route parsing landed on plugins.
    downloads = desktop_page.locator(".footer-link", has_text="Downloads")
    expect(downloads).to_have_class(re.compile(r"active"))


def test_nav_buttons_swap_routes_when_connected(connected_desktop_page: Page, web_origin: str) -> None:
    """Click each top nav button in turn and assert the URL hash and
    `aria-current=page` track. This is the user-facing contract that the
    `parseHash` / `formatRoute` unit tests can't see."""
    log = attach_console_capture(connected_desktop_page)
    connected_desktop_page.goto(web_origin)
    connected_desktop_page.wait_for_load_state("networkidle")

    # Wait for the connected UI to be present — the nav exists in both
    # states but the empty-state heading is gone only after RS attaches.
    expect(connected_desktop_page.get_by_role("heading", name="Connect your storage")).to_have_count(0)

    # Each (label, hash-suffix) pair: hash-suffix is what `parseHash`
    # writes back. `?g=...` filter params can follow on todos/collections,
    # so we match a prefix not the exact value.
    for label, hash_suffix in [
        ("Todos", "todos"),
        ("Collections", "collections"),
        ("Inbox", ""),
    ]:
        connected_desktop_page.get_by_role("button", name=label).first.click()
        if hash_suffix:
            expect(connected_desktop_page).to_have_url(re.compile(rf"#/{hash_suffix}(?:\?.*)?$"))
        else:
            expect(connected_desktop_page).to_have_url(re.compile(r"#/?$"))
        active = connected_desktop_page.get_by_role("button", name=label).first
        expect(active).to_have_attribute("aria-current", "page")

    assert_no_console_errors(log)


def test_unknown_hash_falls_back_to_inbox(connected_desktop_page: Page, web_origin: str) -> None:
    """`parseHash` treats unknown paths as inbox. Verify that's wired all
    the way through the UI, not just the parser."""
    connected_desktop_page.goto(f"{web_origin}/#/this-route-does-not-exist")
    connected_desktop_page.wait_for_load_state("networkidle")

    inbox_btn = connected_desktop_page.get_by_role("button", name="Inbox")
    expect(inbox_btn).to_have_attribute("aria-current", "page")
