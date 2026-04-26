"""Smoke-level CRUD: add a Note via the UI, see it surface in the grid.

Bookmarks/images/audio depend on the user dropping a URL or picking a
file — which is where the UI gets noisy and isn't a great fit for an
end-to-end smoke test. Notes are pure-text and exercise the Add Entry
modal, the markdown editor, and the change-event → grid render path,
which is the same plumbing every other type rides on.
"""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import Page, expect

from helpers.pwa import attach_console_capture, assert_no_console_errors


pytestmark = [pytest.mark.desktop, pytest.mark.rs]


def test_add_a_note_appears_in_the_inbox_grid(connected_desktop_page: Page, web_origin: str) -> None:
    log = attach_console_capture(connected_desktop_page)
    connected_desktop_page.goto(web_origin)
    connected_desktop_page.wait_for_load_state("networkidle")

    # Make sure we're on the inbox view; the test seed account is empty.
    connected_desktop_page.get_by_role("button", name="Inbox").first.click()

    # Open the Add Note modal from the strip (`AddEntryBar.svelte`). The
    # button's accessible name flips between "Note" (visible-text wins on
    # desktop) and "Add Note" (text hidden under the 520 px CSS, title
    # takes over) — so we anchor on the stable `title` attribute.
    connected_desktop_page.locator('button[title="Add Note"]').click()

    # AddEntryModal mounts a TipTap editor — the editor is a contenteditable
    # ProseMirror node with `role="textbox"`. Type some unique text we can
    # search for in the grid afterwards.
    sentinel = "playwright-smoke-note-α"
    editor = connected_desktop_page.locator('[contenteditable="true"]').first
    editor.click()
    editor.type(sentinel)

    # The modal's primary action is labelled "Save" or "Add" depending on
    # whether we're editing — for a new note it's "Add".
    connected_desktop_page.get_by_role("button", name=re.compile(r"^(Add|Save)$")).first.click()

    # Wait for the modal to close (sentinel is no longer inside an aria
    # dialog) and the new card to render in the grid.
    expect(connected_desktop_page.get_by_text(sentinel)).to_be_visible(timeout=10_000)

    assert_no_console_errors(log)
