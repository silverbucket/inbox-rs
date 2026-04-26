"""Helpers for inbox-rs as a Progressive Web App.

Two responsibilities:

- `seed_rs_session(...)` — bypasses the connect widget by writing the same
  localStorage entries that remotestorage.js writes after a successful
  OAuth round-trip, so a test starts already-authenticated.

- Device-profile constants (desktop / mobile viewports) so individual tests
  can stay terse.
"""

from __future__ import annotations

import json
from typing import Any

from playwright.sync_api import BrowserContext, Page

from .armadietto import ARMADIETTO_ORIGIN, RsUser


# Keys mirror what remotestoragejs writes after a real OAuth callback,
# determined by reading `node_modules/remotestoragejs/src/wireclient.ts`:
#
#   - `remotestorage:backend`  — single string, the backend type
#   - `remotestorage:wireclient` — single JSON blob holding the wireclient
#     state (userAddress, href, storageApi, token, properties). On boot the
#     wireclient does `getJSONFromLocalStorage(SETTINGS_KEY)` and re-applies
#     the values via `configure(...)`, which fires the `connected` event.
#
# We also seed the web app's own keys (`inbox-rs:userAddress`,
# `inbox-rs:theme`) so the UI shows the connected state on first paint
# without flashing the disconnected one.
def _rs_localstorage_payload(user: RsUser, token: str, *, client_origin: str) -> dict[str, str]:
    storage_href = f"{ARMADIETTO_ORIGIN}/storage/{user.username}"
    wireclient_settings = {
        "userAddress": user.address,
        "href": storage_href,
        "storageApi": "draft-dejong-remotestorage-10",
        "token": token,
        "properties": {
            "http://remotestorage.io/spec/version": "draft-dejong-remotestorage-10",
            "http://tools.ietf.org/html/rfc6750#section-2.3": True,
            "http://tools.ietf.org/html/rfc6749#section-4.2": f"{ARMADIETTO_ORIGIN}/oauth/{user.username}",
        },
    }
    return {
        "remotestorage:backend": "remotestorage",
        "remotestorage:wireclient": json.dumps(wireclient_settings),
        # Web-app private keys — keep `applyTheme` happy on cold load and
        # let the connect widget render the user address before RS finishes
        # its async restore handshake.
        "inbox-rs:userAddress": user.address,
        "inbox-rs:theme": "system",
    }


def seed_rs_session(
    context: BrowserContext,
    user: RsUser,
    token: str,
    *,
    client_origin: str,
) -> None:
    """Pre-populate the browser context with an authorized RS session.

    Must be called *before* the test navigates to the app. Internally uses
    `add_init_script`, which fires before any page script — so by the time
    the web app's `RemoteStorage` constructor runs, the auth state is in
    place and the connect widget skips straight to the connected UI.
    """
    payload = _rs_localstorage_payload(user, token, client_origin=client_origin)
    # Build a tiny inline script. We avoid string interpolation of the token
    # into the script body by passing it through JSON.parse — that way a
    # token containing a literal `</script>` (rare but possible with some
    # base64 alphabets) can't break out.
    serialized = json.dumps(payload)
    context.add_init_script(
        f"""
        (() => {{
          const entries = JSON.parse({json.dumps(serialized)});
          for (const [k, v] of Object.entries(entries)) {{
            try {{ localStorage.setItem(k, v); }} catch (e) {{}}
          }}
        }})();
        """
    )


# Common viewport / device profiles. Centralising so a future redesign that
# tweaks the mobile breakpoint only updates one place.
DESKTOP_VIEWPORT = {"width": 1440, "height": 900}

# Pixel 5–ish: 393×851 logical, 2.75 DPR — small enough to trigger the
# 768px mobile media query in App.svelte and similar to a real Android phone.
MOBILE_VIEWPORT = {"width": 393, "height": 851}
MOBILE_DEVICE_KWARGS: dict[str, Any] = {
    "viewport": MOBILE_VIEWPORT,
    "device_scale_factor": 2.75,
    "is_mobile": True,
    "has_touch": True,
    "user_agent": (
        "Mozilla/5.0 (Linux; Android 13; Pixel 5) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Mobile Safari/537.36"
    ),
}


def assert_no_console_errors(messages: list[str]) -> None:
    """Fail the test if any captured console message looks like a real error.

    The web app legitimately logs `console.error('Failed to sync URL filters …',
    e)` on bootstrap when configs aren't loaded yet, so we can't fail on the
    bare presence of an `[error]` entry. Filter against a known-noise list.
    """
    noise_substrings = (
        # Vite injects this on dev builds when the page is opened directly;
        # production preview shouldn't emit it but we keep it harmless.
        "[vite] connecting",
        # Service worker registration messages from Chrome DevTools when no
        # SW is installed — purely informational.
        "Failed to load resource: the server responded with a status of 404",
    )
    real_errors = [
        m for m in messages
        if m.startswith("[error]") and not any(s in m for s in noise_substrings)
    ]
    assert not real_errors, "Unexpected console errors:\n" + "\n".join(real_errors)


def attach_console_capture(page: Page) -> list[str]:
    """Attach a console listener and return the list it appends to.

    The returned list is a live view — assert against it after your
    interactions, then call `assert_no_console_errors(...)` for the
    common-case check.
    """
    log: list[str] = []
    page.on("console", lambda msg: log.append(f"[{msg.type}] {msg.text}"))
    page.on("pageerror", lambda exc: log.append(f"[pageerror] {exc}"))
    return log
