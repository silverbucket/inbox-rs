"""Mobile-specific layout: the 768px breakpoint in App.svelte switches the
header from a single row into a 2-row CSS grid (brand + menu on row 1,
nav buttons centered on row 2)."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect


pytestmark = [pytest.mark.mobile]


def test_header_uses_grid_layout_on_mobile(mobile_page: Page, web_origin: str) -> None:
    """On phones, App.svelte's media query promotes `.header-inner` to
    `display: grid` and pushes the nav onto its own row. Verify the
    computed style so a future regression in the breakpoint is caught."""
    mobile_page.goto(web_origin)
    mobile_page.wait_for_load_state("networkidle")

    display = mobile_page.evaluate(
        "() => getComputedStyle(document.querySelector('.header-inner')).display"
    )
    assert display == "grid", f".header-inner should be 'grid' on mobile, got {display!r}"


def test_brand_logo_shrinks_on_mobile(mobile_page: Page, web_origin: str) -> None:
    """The brand logo drops from 38px to 30px under the mobile media query.
    A regression here usually means a !important or specificity bug."""
    mobile_page.goto(web_origin)
    mobile_page.wait_for_load_state("networkidle")

    height = mobile_page.evaluate(
        "() => getComputedStyle(document.querySelector('.brand-logo')).height"
    )
    assert height == "30px", f".brand-logo should be 30px on mobile, got {height!r}"


def test_nav_buttons_remain_visible_on_phone(mobile_page: Page, web_origin: str) -> None:
    """Tab bars are notorious for getting clipped under the iOS home
    indicator. Confirm the three primary nav buttons each occupy non-zero
    box sizes inside the visible viewport."""
    mobile_page.goto(web_origin)
    mobile_page.wait_for_load_state("networkidle")

    for label in ("Inbox", "Todos", "Collections"):
        btn = mobile_page.get_by_role("button", name=label).first
        expect(btn).to_be_visible()
        box = btn.bounding_box()
        assert box and box["width"] > 40 and box["height"] > 24, \
            f"{label!r} button bounding box too small for a touch target: {box}"
