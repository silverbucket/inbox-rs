"""Touch-input behaviour on mobile.

`mobile_page` runs with `has_touch=True` and `is_mobile=True`, so
Playwright dispatches `touchstart`/`touchend` instead of mouse events when
we use `page.tap()`. This catches handlers that only listen to `click`
and break in mobile Safari — a recurring class of bug in PWAs."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect


pytestmark = [pytest.mark.mobile, pytest.mark.rs]


def test_tap_opens_user_menu(mobile_page: Page, web_origin: str) -> None:
    """The user menu trigger must respond to a tap. If it only listens for
    `click` events without the proper handler config, mobile Safari may
    dispatch a 300ms-delayed click and the test will time out — that's
    the smoke we're catching."""
    mobile_page.goto(web_origin)
    mobile_page.wait_for_load_state("networkidle")

    trigger = mobile_page.get_by_role("button", name="User menu — disconnected")
    trigger.tap()

    expect(mobile_page.get_by_placeholder("user@storage.example")).to_be_visible()


def test_tap_navigates_between_pages(connected_mobile_page: Page, web_origin: str) -> None:
    """Same coverage as the desktop nav test, but using touch dispatch."""
    connected_mobile_page.goto(web_origin)
    connected_mobile_page.wait_for_load_state("networkidle")

    todos_btn = connected_mobile_page.get_by_role("button", name="Todos").first
    todos_btn.tap()
    expect(todos_btn).to_have_attribute("aria-current", "page")
