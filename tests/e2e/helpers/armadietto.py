"""Armadietto remoteStorage server helpers.

The web app talks to whatever RS server you point it at, but our local CI
test rig spins up Armadietto on http://localhost:8000 (matching the dev
docker-compose). These helpers cover the things tests need from it:

1. `ensure_user(...)`  — idempotent signup so the first test run on a fresh
   container can authenticate.
2. `oauth_token(...)`  — drives the OAuth `/oauth/<user>` POST and returns
   the access token from the redirect Location, so a test can pre-seed the
   web app's auth state without driving the click-through UI.
3. `put_inbox_item(...)` — direct PUT to `/storage/<user>/inbox/items/<id>`
   so a test can pre-populate the user's storage with documents *before*
   the web app ever connects, simulating an "existing account with data"
   first-load scenario.

We deliberately keep these as plain `requests` calls rather than going
through Playwright. The OAuth click-through is itself a UI that's part of
*Armadietto*, not part of inbox-rs — exercising it with the browser would
mostly test Armadietto's HTML, not our PWA.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Optional

import requests


# These constants match docker-compose.yml + armadietto.conf.json. Keeping
# them in one place so a future server-port move is a single-line change.
ARMADIETTO_ORIGIN = "http://localhost:8000"
DEFAULT_TIMEOUT = 10  # seconds


@dataclass(frozen=True)
class RsUser:
    """A signed-up Armadietto account, addressable as `username@host`."""
    username: str
    password: str
    host: str = "localhost:8000"

    @property
    def address(self) -> str:
        """The user-facing remoteStorage address (`user@host`)."""
        return f"{self.username}@{self.host}"


def wait_for_armadietto(timeout: float = 30.0) -> None:
    """Block until Armadietto is reachable, raise on timeout.

    Used by the session fixture; we already know `with_servers.py` waited
    on the port to bind, but Armadietto serves a 404 for the briefest
    moment between bind and route-table init. A quick GET / settles that.
    """
    deadline = time.time() + timeout
    last_err: Optional[Exception] = None
    while time.time() < deadline:
        try:
            r = requests.get(f"{ARMADIETTO_ORIGIN}/", timeout=2)
            if r.status_code == 200:
                return
        except requests.RequestException as e:
            last_err = e
        time.sleep(0.25)
    raise RuntimeError(f"Armadietto never became ready at {ARMADIETTO_ORIGIN}: {last_err}")


def ensure_user(user: RsUser, email: Optional[str] = None) -> RsUser:
    """Sign up `user` if they don't exist yet. Idempotent.

    Armadietto's /signup returns 201 on success and 409 if the username is
    taken — we treat both as success. Any other status is a hard failure
    so that misconfigured tests fail loudly instead of silently sharing a
    stale account.
    """
    resp = requests.post(
        f"{ARMADIETTO_ORIGIN}/signup",
        data={
            "username": user.username,
            "email": email or f"{user.username}@e2e.local",
            "password": user.password,
            "signup": "Go",
        },
        allow_redirects=False,
        timeout=DEFAULT_TIMEOUT,
    )
    if resp.status_code in (200, 201, 409):
        return user
    raise RuntimeError(
        f"Armadietto signup for {user.username!r} failed: "
        f"HTTP {resp.status_code} — {resp.text[:200]}"
    )


def oauth_token(user: RsUser, *, client_origin: str, scopes: str = "inbox:rw shares:rw") -> str:
    """Run the OAuth implicit flow and return the access token.

    `client_origin` is what remoteStorage.js sends as `client_id` — typically
    the origin the PWA is served from (`http://localhost:4173` for our preview
    server). Scopes default to what `packages/web/src/lib/rs.ts` claims.

    Returns just the bearer token; callers inject it into localStorage so the
    web app picks up an already-authorized session on its next load.
    """
    resp = requests.post(
        f"{ARMADIETTO_ORIGIN}/oauth",
        data={
            "client_id": client_origin,
            "redirect_uri": f"{client_origin}/",
            "response_type": "token",
            "scope": scopes,
            "state": "",
            "username": user.username,
            "password": user.password,
            "allow": "Allow",
        },
        allow_redirects=False,
        timeout=DEFAULT_TIMEOUT,
    )
    if resp.status_code != 302:
        raise RuntimeError(
            f"OAuth Allow for {user.username!r} returned HTTP {resp.status_code}, "
            f"expected 302. Body: {resp.text[:200]}"
        )
    location = resp.headers.get("Location", "")
    # Armadietto returns `…/#access_token=…&token_type=bearer&state=…`
    fragment = location.partition("#")[2]
    for kv in fragment.split("&"):
        k, _, v = kv.partition("=")
        if k == "access_token":
            return requests.utils.unquote(v)
    raise RuntimeError(f"OAuth redirect missing access_token: {location!r}")


def put_inbox_item(user: RsUser, token: str, *, item: dict[str, Any]) -> None:
    """Write a single inbox item directly to RS, bypassing the web app.

    Targets `PUT /storage/<user>/inbox/items/<id>`, which is the same path
    `rs-module`'s `store(...)` uses via `privateClient.storeObject(...,
    'items/<id>', ...)`. The web app picks the item up on its next sync —
    that's how we simulate a "first load against an existing account".

    `_migrateVersion` is intentionally optional in the document. The
    rs-module `getAll` call auto-stamps the latest version onto un-stamped
    items of current types, so leaving it off keeps tests decoupled from
    the migration version counter.
    """
    item_id = item.get("id")
    if not item_id:
        raise ValueError("inbox item must have a string `id`")
    resp = requests.put(
        f"{ARMADIETTO_ORIGIN}/storage/{user.username}/inbox/items/{item_id}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        data=json.dumps(item),
        timeout=DEFAULT_TIMEOUT,
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(
            f"PUT /inbox/items/{item_id} for {user.username!r} failed: "
            f"HTTP {resp.status_code} — {resp.text[:200]}"
        )
