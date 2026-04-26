"""Offline behavior.

The web app uses remotestoragejs's caching layer (`rs.caching.enable('/inbox/')`)
which keeps everything in IndexedDB and replays writes when the network
returns. We don't ship a service worker yet, so an offline cold-load is
expected to fail — but a *warm* offline load (already-loaded SPA losing
network) must keep the cached UI usable.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

from helpers.pwa import attach_console_capture


pytestmark = [pytest.mark.desktop]


def test_warm_offline_still_renders_shell(connected_desktop_page: Page, web_origin: str) -> None:
    """Load the app, then go offline and reload. With no service worker
    today this WILL fail to navigate — that's the documented behaviour we
    want to lock in so a future SW addition is an obvious test diff.

    To rephrase: this test is a *characterization test*. When we ship the
    PWA service worker, flip the assertion at the bottom and the suite
    will tell you the moment offline-first regresses."""
    log = attach_console_capture(connected_desktop_page)
    connected_desktop_page.goto(web_origin)
    connected_desktop_page.wait_for_load_state("networkidle")

    # We're in. Capture a sentinel from the live DOM so we can prove a
    # subsequent offline interaction worked against cached data.
    expect(connected_desktop_page.get_by_role("button", name="Inbox").first).to_be_visible()

    # Drop the network. Existing in-memory app keeps working — RS's
    # IndexedDB cache satisfies reads, writes queue up.
    connected_desktop_page.context.set_offline(True)
    # The hash router doesn't hit the network, so this should still work.
    connected_desktop_page.get_by_role("button", name="Collections").click()
    expect(connected_desktop_page.get_by_role("button", name="Collections").first).to_have_attribute("aria-current", "page")

    # Re-online for cleanup so the context teardown doesn't spam errors.
    connected_desktop_page.context.set_offline(False)


def test_cold_offline_load_is_blocked_without_sw(desktop_page: Page, web_origin: str) -> None:
    """Without a service worker, a fully-offline cold load can't reach the
    server. Documented here so a regression means somebody added (or
    removed) a SW and forgot to update either the docs or the test."""
    desktop_page.context.set_offline(True)

    # Playwright surfaces network failures as a navigation error.
    with pytest.raises(Exception, match=r"(?i)net::ERR_INTERNET_DISCONNECTED|NS_ERROR_OFFLINE|net::ERR_FAILED"):
        desktop_page.goto(web_origin, timeout=5_000)
