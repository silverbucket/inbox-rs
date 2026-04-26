"""Shared pytest fixtures for the inbox-rs end-to-end suite.

The suite runs against:

- A locally-running Armadietto instance on :8000 (started via `with_servers.py`
  before pytest is invoked, see `tests/e2e/README.md`).
- The web app's *production preview* on :4173 (`vite preview` of the built
  `dist/`). We test the production build because PWA behaviour (manifest,
  asset paths, build-time defines) only matches reality after the build step.

If you need to iterate fast against the dev server instead, override
`WEB_ORIGIN`:

    WEB_ORIGIN=http://localhost:5173 pytest -k mobile

…but be aware the dev server's HMR shim makes some load-state assertions
flakier and emits non-error console noise.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from typing import Iterator

import pytest
from playwright.sync_api import Browser, BrowserContext, Page

# Make `helpers` importable when pytest is run from the repo root or from
# inside `tests/e2e/`. Without this, `from helpers import …` resolves only
# in one of the two layouts.
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from helpers.armadietto import RsUser, ensure_user, oauth_token, wait_for_armadietto  # noqa: E402
from helpers.pwa import (  # noqa: E402
    DESKTOP_VIEWPORT,
    MOBILE_DEVICE_KWARGS,
    seed_rs_session,
)


WEB_ORIGIN = os.environ.get("WEB_ORIGIN", "http://localhost:4173")


# ──────────────────────────────────────────────────────────────────────
#  Session-scoped: armadietto + a single shared test user
# ──────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def web_origin() -> str:
    """Origin of the web app under test (preview server by default)."""
    return WEB_ORIGIN


@pytest.fixture(scope="session", autouse=True)
def _armadietto_ready() -> None:
    """Make sure Armadietto is up before any test runs.

    `with_servers.py` already waited on the TCP port, but Armadietto's HTTP
    routing wakes up a few hundred ms later. Block until a real GET works
    so individual tests don't have to retry.
    """
    wait_for_armadietto(timeout=30)


@pytest.fixture(scope="session")
def rs_user(_armadietto_ready: None) -> RsUser:
    """A unique signed-up Armadietto user, stable across the test session.

    We use a random suffix so reruns against a persistent Docker volume
    don't accumulate state from earlier failed runs colliding on the same
    storage paths.
    """
    suffix = uuid.uuid4().hex[:8]
    user = RsUser(username=f"e2e_{suffix}", password="e2e_pass_1234")
    ensure_user(user)
    return user


@pytest.fixture(scope="session")
def rs_token(rs_user: RsUser, web_origin: str) -> str:
    """An OAuth token for `rs_user`, valid against the test web origin.

    Issued once per session because Armadietto tokens don't expire on the
    short timescales we run tests at and re-issuing for every test would
    triple the suite's wall-clock time.
    """
    return oauth_token(rs_user, client_origin=web_origin)


# ──────────────────────────────────────────────────────────────────────
#  Per-test fresh accounts
# ──────────────────────────────────────────────────────────────────────
#
# `rs_user` is session-scoped, which means tests that run in the same
# session share its storage state. Some tests (e.g. the "first connect on
# an empty account" path) need a guaranteed-empty user, and others (e.g.
# "first connect on an account that already has data") need to PUT data
# to a user *before* the web app touches it. Both of those would race
# against any other test that writes to the shared `rs_user`.
#
# `fresh_rs_user` / `fresh_rs_token` create a brand-new Armadietto account
# per test. They cost one signup + one OAuth round-trip, which is cheap
# (~200 ms total against the local Docker server).

@pytest.fixture
def fresh_rs_user(_armadietto_ready: None) -> RsUser:
    """A signed-up Armadietto user that exists only for this test."""
    suffix = uuid.uuid4().hex[:8]
    user = RsUser(username=f"e2e_fresh_{suffix}", password="e2e_pass_1234")
    ensure_user(user)
    return user


@pytest.fixture
def fresh_rs_token(fresh_rs_user: RsUser, web_origin: str) -> str:
    """OAuth token for the per-test `fresh_rs_user`."""
    return oauth_token(fresh_rs_user, client_origin=web_origin)


# ──────────────────────────────────────────────────────────────────────
#  Per-test browser contexts
# ──────────────────────────────────────────────────────────────────────
#
# pytest-playwright provides `browser` (session) and `page` / `context`
# (function) fixtures already. We layer on:
#
#   - `desktop_page`  : a fresh Page in a desktop viewport, no auth state
#   - `mobile_page`   : a fresh Page emulating a Pixel-5 phone, touch on
#   - `connected_desktop_page` / `connected_mobile_page` : the same with the
#                       remoteStorage session pre-seeded so the inbox loads
#                       immediately

@pytest.fixture
def desktop_context(browser: Browser) -> Iterator[BrowserContext]:
    ctx = browser.new_context(viewport=DESKTOP_VIEWPORT)
    yield ctx
    ctx.close()


@pytest.fixture
def desktop_page(desktop_context: BrowserContext) -> Iterator[Page]:
    page = desktop_context.new_page()
    yield page
    page.close()


@pytest.fixture
def mobile_context(browser: Browser) -> Iterator[BrowserContext]:
    ctx = browser.new_context(**MOBILE_DEVICE_KWARGS)
    yield ctx
    ctx.close()


@pytest.fixture
def mobile_page(mobile_context: BrowserContext) -> Iterator[Page]:
    page = mobile_context.new_page()
    yield page
    page.close()


@pytest.fixture
def connected_desktop_page(
    desktop_context: BrowserContext,
    rs_user: RsUser,
    rs_token: str,
    web_origin: str,
) -> Iterator[Page]:
    seed_rs_session(desktop_context, rs_user, rs_token, client_origin=web_origin)
    page = desktop_context.new_page()
    yield page
    page.close()


@pytest.fixture
def connected_mobile_page(
    mobile_context: BrowserContext,
    rs_user: RsUser,
    rs_token: str,
    web_origin: str,
) -> Iterator[Page]:
    seed_rs_session(mobile_context, rs_user, rs_token, client_origin=web_origin)
    page = mobile_context.new_page()
    yield page
    page.close()
