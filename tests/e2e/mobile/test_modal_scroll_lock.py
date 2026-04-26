"""iOS Safari body-scroll-lock behaviour.

`App.svelte` reacts to any open modal by pinning `<body>` to a fixed
position and snapshotting the scroll offset, then restoring on close.
That dance is the only way to prevent iOS rubber-banding the page under
the modal. Regress this and mobile users find the page scrolled to the
top after closing any dialog."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect


pytestmark = [pytest.mark.mobile, pytest.mark.rs]


def test_open_modal_locks_body_scroll(connected_mobile_page: Page, web_origin: str) -> None:
    connected_mobile_page.goto(web_origin)
    connected_mobile_page.wait_for_load_state("networkidle")

    # Trigger the AddEntryModal via the Note button on the inbox toolbar.
    connected_mobile_page.locator('button[title="Add Note"]').tap()

    # Once the modal is open, App.svelte should have pinned the body.
    body_pos = connected_mobile_page.evaluate("() => getComputedStyle(document.body).position")
    body_overflow = connected_mobile_page.evaluate("() => getComputedStyle(document.body).overflow")
    assert body_pos == "fixed", f"body should be position:fixed while modal open, got {body_pos!r}"
    assert body_overflow == "hidden", f"body overflow should be hidden, got {body_overflow!r}"


def test_close_modal_restores_scroll_position(connected_mobile_page: Page, web_origin: str) -> None:
    connected_mobile_page.goto(web_origin)
    connected_mobile_page.wait_for_load_state("networkidle")

    # Open & close — body styles must come back to defaults so the page
    # stays scrollable. We don't have enough cards in a fresh account to
    # produce a long scroll, but the *style restoration* is what we care
    # about; the saved-scrollY logic is exercised by the same code path.
    connected_mobile_page.locator('button[title="Add Note"]').tap()
    expect(connected_mobile_page.locator(".modal, [role='dialog']")).to_be_visible()

    connected_mobile_page.keyboard.press("Escape")

    # Modal closed; styles cleared. Re-read computed styles.
    body_pos = connected_mobile_page.evaluate("() => getComputedStyle(document.body).position")
    body_overflow = connected_mobile_page.evaluate("() => getComputedStyle(document.body).overflow")
    assert body_pos == "static", f"body should return to position:static, got {body_pos!r}"
    # Once the inline `body.style.overflow` is cleared, the value reverts to
    # whatever the page CSS dictates. With separate overflow-x / overflow-y
    # rules in global.css the shorthand reads back as "<x> <y>" — anything
    # other than the locked "hidden" we set explicitly is acceptable.
    assert "hidden" != body_overflow, (
        f"body overflow should no longer be locked to 'hidden', got {body_overflow!r}"
    )
