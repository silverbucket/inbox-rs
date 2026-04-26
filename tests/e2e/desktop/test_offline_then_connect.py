"""Offline → online → connect transitions.

Both scenarios start with the disconnected app shell loaded online (we
don't ship a service worker yet, so a *cold* offline load is expected to
fail — see `test_offline_resilience.py`). The network is then dropped to
exercise the "user opened the page on a flaky connection" path, brought
back, and the connect flow runs to completion.

We cover the two account states that matter for first-time UX:

1. **New account, no data** — drives the real OAuth UI to register the
   session, then asserts the connected empty state surfaces.
2. **Existing account with data** — pre-seeds one note via a direct PUT
   to the RS server before the page ever opens, connects via the seeded
   localStorage shortcut, and asserts the note syncs down and renders.

Both tests use a *fresh* per-test Armadietto user (`fresh_rs_user`) so
they can't be perturbed by other tests writing to the shared session
account. See `conftest.py` for the fixture rationale.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import BrowserContext, Page, expect

from helpers.armadietto import RsUser, put_inbox_item
from helpers.pwa import seed_rs_session


pytestmark = [pytest.mark.desktop, pytest.mark.rs]


def test_offline_then_online_connect_new_user(
    desktop_page: Page,
    fresh_rs_user: RsUser,
    web_origin: str,
) -> None:
    """User opens the app on a flaky connection, drops offline, comes
    back, and connects for the first time. End state: connected, empty
    inbox."""
    desktop_page.goto(web_origin)
    desktop_page.wait_for_load_state("networkidle")

    # Disconnected at first paint, then we yank the network.
    expect(desktop_page.get_by_role("heading", name="Connect your storage")).to_be_visible()
    desktop_page.context.set_offline(True)

    # Disconnected UI must keep working with no network — the empty state
    # is fully static and hash routing doesn't hit the wire.
    expect(desktop_page.get_by_role("heading", name="Connect your storage")).to_be_visible()
    desktop_page.get_by_role("button", name="Collections").first.click()
    expect(
        desktop_page.get_by_role("button", name="Collections").first
    ).to_have_attribute("aria-current", "page")
    desktop_page.get_by_role("button", name="Inbox").first.click()

    # Network's back. Drive the real OAuth flow (mirrors test_connect_flow)
    # so we cover the connect transition under post-offline conditions.
    desktop_page.context.set_offline(False)
    desktop_page.get_by_role("button", name="User menu — disconnected").click()
    desktop_page.get_by_placeholder("user@storage.example").fill(fresh_rs_user.address)
    desktop_page.get_by_role("button", name="Connect", exact=True).click()

    desktop_page.wait_for_url("http://localhost:8000/oauth/**", timeout=10_000)
    desktop_page.locator('input[name="password"]').fill(fresh_rs_user.password)
    desktop_page.locator('button[name="allow"]').click()

    desktop_page.wait_for_url(f"{web_origin}/**", timeout=10_000)
    desktop_page.wait_for_load_state("networkidle")

    # Connected state: aria-label flips, empty-state heading is gone.
    expect(desktop_page.get_by_role("button", name="User menu — connected")).to_be_visible()
    expect(desktop_page.get_by_role("heading", name="Connect your storage")).to_have_count(0)


def test_offline_then_online_connect_existing_user_with_data(
    desktop_context: BrowserContext,
    fresh_rs_user: RsUser,
    fresh_rs_token: str,
    web_origin: str,
) -> None:
    """Same flow but the account already has one note on the server.
    After the connect transition, a successful sync must surface that
    pre-existing note in the inbox grid — proves the
    `getAll('items/')` → change-event → render pipeline works on a cold
    first connect, not just for items the same browser wrote."""
    # Pre-seed the user's inbox with a note before the web app ever sees
    # this account. A real-world equivalent: the user already used the
    # app on another device, then opened it for the first time here.
    sentinel = "preexisting-note-α-from-another-device"
    put_inbox_item(
        fresh_rs_user,
        fresh_rs_token,
        item={
            "id": "preexisting-note-1",
            "type": "note",
            "title": sentinel,
            "body": sentinel,
            "createdAt": "2024-01-01T00:00:00.000Z",
        },
    )

    page = desktop_context.new_page()
    page.goto(web_origin)
    page.wait_for_load_state("networkidle")

    # Disconnected first, then drop the network.
    expect(page.get_by_role("heading", name="Connect your storage")).to_be_visible()
    desktop_context.set_offline(True)

    # Hash navigation must keep working offline.
    page.get_by_role("button", name="Collections").first.click()
    expect(
        page.get_by_role("button", name="Collections").first
    ).to_have_attribute("aria-current", "page")
    page.get_by_role("button", name="Inbox").first.click()

    # Network returns. Seed the auth state and reload — the seed only
    # takes effect on the next navigation because `add_init_script` runs
    # before page scripts; a simple in-place setItem wouldn't survive
    # the reload that triggers RS's connection handshake.
    desktop_context.set_offline(False)
    seed_rs_session(desktop_context, fresh_rs_user, fresh_rs_token, client_origin=web_origin)
    page.reload()
    page.wait_for_load_state("networkidle")

    # Connected, and the pre-seeded note must surface after RS finishes
    # its initial sync. Sync timing varies on a cold connection so we
    # give it a generous deadline.
    expect(page.get_by_role("button", name="User menu — connected")).to_be_visible(timeout=15_000)
    expect(page.get_by_text(sentinel)).to_be_visible(timeout=15_000)
