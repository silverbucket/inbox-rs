# Architecture

Inbox RS is a client-side application. There is no backend of the project's
own in the data path: the browser holds the data, talks to your remoteStorage
server directly, and reaches everything else through a relay you can point
wherever you like.

This document covers the operational detail. [README.md](../README.md) has the
short version.

## Packages

```text
packages/
  rs-module/    # Shared remoteStorage data module (types, schemas, CRUD, migrations)
  web/          # Svelte 5 web app + quick-capture PWA
  extension/    # Chrome MV3 + Firefox WebExtension (popup, context menus, content script)
  thunderbird/  # Thunderbird MailExtension (message toolbar popup)
```

All four share `@inbox-rs/rs-module` for consistent data types and storage
layout.

## What the browser actually talks to

Worth being precise about, since "no backend" is easy to over-read. Five
outbound paths exist, and only the first is unavoidable:

| Destination | When | Notes |
|---|---|---|
| **Your remoteStorage server** | All reads and writes | Whichever host you connected. The only party that sees your data. |
| **Your provider's WebFinger + OAuth endpoints** | Connect time | `GET https://<your-host>/.well-known/webfinger` to discover the storage API, then the OAuth authorize redirect. Same organisation as your storage. |
| **A Sockethub relay** | Link enrichment, CalDAV | Defaults to `sockethub.silverbucket.net`, which the Inbox RS author operates. Changeable in settings — see below. |
| **Sites you bookmarked** | Rendering the inbox | Bookmark cards load `favicon` and `ogImage` straight from their origin, so scrolling the grid issues requests to those sites. Turn off link previews to stop enrichment fetching them; already-stored URLs still load unless the image was downloaded to your storage. |
| **A calendar server** | Publishing an event | Reached *through* the relay, never directly. |

No analytics, telemetry, error reporting, or ad hosts. Nothing else is
contacted.

## Sockethub

Two jobs are impossible from a browser tab. Fetching a page's Open Graph tags
needs a cross-origin read of arbitrary HTML, which CORS forbids. Speaking
CalDAV needs a server that answers browser preflight, and most calendar hosts
don't expose browser-compatible CORS headers.

Rather than run a backend for those two jobs, Inbox RS relays them through
[Sockethub](https://sockethub.org), an open-source protocol gateway that turns
external protocols into one consistent ActivityStreams message format.

### Link enrichment

A bookmark's title, description, site name and preview image come from
Sockethub's stateless `metadata` platform: one `POST` of an ActivityStreams
`fetch`, answered with an NDJSON line carrying the page's Open Graph fields.
No credentials and no connect step, so each lookup is a plain
request/response over the HTTP actions endpoint rather than a websocket.

The text is written into your storage as your own copy. The preview image is
kept as a URL, so it is fetched from the origin at render time — the browser
extension is the one path that downloads the image itself and stores it as a
file.

### Calendars

CalDAV discovery and publishing go through the same endpoint. The relevant
handling:

- Credentials live on the device, in `localStorage`, and are deliberately
  **not** synced through remoteStorage — data there syncs in plaintext, so
  each device connects its own calendar account.
- They are sent with each request and held by the relay only for the life of
  that request: encrypted, in a request-scoped store that is purged on
  teardown. Nothing is persisted server-side, and nothing is written to your
  storage.
- You are nonetheless trusting whoever runs the relay for that window. Two
  things bound it: the endpoint is **pinned per account at connect time**, so
  a synced settings change on a compromised device cannot redirect
  credential-bearing traffic; and the UI insists on app-specific passwords,
  which are scoped and revocable at the provider.
- Accepted trade-off: `localStorage` is readable by any same-origin script, so
  an XSS compromise could exfiltrate stored app passwords. Client-side
  encryption without a per-session passphrase would only obfuscate, since the
  key would be equally reachable.

Publishing is one-shot by design — the client discovers calendars and creates
entries, but never updates or deletes them. A card stays the editor; the
calendar entry is a projection of it.

### Running your own

The relay is configurable per user in settings (`sockethubUrl`), and per build
via `VITE_SOCKETHUB_URL`. The server needs a Sockethub recent enough to have
HTTP actions, with `httpActions: { enabled: true }` in its config. Point it at
your own instance and the default host drops out of the picture entirely.

## Storage layout

Everything lives under the `inbox` scope on your remoteStorage server:

```text
items/{uuid}                 # JSON metadata for each item
files/{uuid}.{ext}           # Binary files (images, audio, video, documents)
files/{uuid}.thumb.jpg       # Downscaled image previews for the card grid
collections/{uuid}           # Collection definitions and their item order
groups/{uuid}                # Collection groups
config/app                   # UI state: ordering, filters, expanded sections
config/user                  # User settings: theme, link previews, calendar mode
```

Cards of every kind share one base shape — collection membership, pinning, and
the scheduling fields (`startsAt`, `endsAt`, `allDay`, `scheduleKind`) that
drive alerts and calendar publishing — so filing, pinning, scheduling and
completing behave identically regardless of what a card holds.
