"""Connect / disconnect against the local Armadietto.

The connect widget lives inside `UserMenu.svelte`. We type the address
into the form, submit, and let `remotestoragejs` redirect through
Armadietto's Allow page. The test user already exists (signup happens
in the session fixture) so the OAuth screen needs only the password.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

from helpers.armadietto import RsUser
from helpers.pwa import attach_console_capture


pytestmark = [pytest.mark.desktop, pytest.mark.rs]


def test_full_connect_round_trip(desktop_page: Page, web_origin: str, rs_user: RsUser) -> None:
    """Drive the disconnected → connected transition end-to-end through
    the real OAuth UI, not the seeded-token shortcut. This is the closest
    we get to a 'first time user' acceptance test."""
    log = attach_console_capture(desktop_page)
    desktop_page.goto(web_origin)
    desktop_page.wait_for_load_state("networkidle")

    # Open the user menu (header right). It's labelled by aria-label,
    # not visible text, when disconnected.
    desktop_page.get_by_role("button", name="User menu — disconnected").click()

    # Type the RS address and submit. The form's submit button reads
    # "Connect" until in-flight, then "Connecting…".
    desktop_page.get_by_placeholder("user@storage.example").fill(rs_user.address)
    # `exact=True` so we don't accidentally select the User-menu trigger
    # button, whose accessible name contains the substring "Connect".
    desktop_page.get_by_role("button", name="Connect", exact=True).click()

    # remotestoragejs navigates to Armadietto's /oauth/<user> page. Wait
    # for the URL to flip to localhost:8000 so we know the redirect fired.
    desktop_page.wait_for_url("http://localhost:8000/oauth/**", timeout=10_000)

    # Armadietto's Allow form: type password and click Allow.
    desktop_page.locator('input[name="password"]').fill(rs_user.password)
    desktop_page.locator('button[name="allow"]').click()

    # Should land back on the web app with #access_token=… in the hash.
    desktop_page.wait_for_url(f"{web_origin}/**", timeout=10_000)
    desktop_page.wait_for_load_state("networkidle")

    # The empty-state heading is gone, the user menu's connected aria-label
    # is in place. Use the aria-label as the assertion target since the
    # avatar text is the user's initials and not stable across runs.
    expect(desktop_page.get_by_role("heading", name="Connect your storage")).to_have_count(0)
    expect(desktop_page.get_by_role("button", name="User menu — connected")).to_be_visible()


def test_disconnect_returns_to_empty_state(connected_desktop_page: Page, web_origin: str) -> None:
    """Once connected, the menu shows a Disconnect entry. Clicking it must
    reset the UI to the empty 'Connect your storage' state."""
    connected_desktop_page.goto(web_origin)
    connected_desktop_page.wait_for_load_state("networkidle")

    expect(connected_desktop_page.get_by_role("button", name="User menu — connected")).to_be_visible()

    connected_desktop_page.get_by_role("button", name="User menu — connected").click()
    connected_desktop_page.get_by_role("menuitem", name="Disconnect").click()

    expect(connected_desktop_page.get_by_role("heading", name="Connect your storage")).to_be_visible()
