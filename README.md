<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/inbox-rs-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/inbox-rs-light.svg">
  <img alt="Inbox RS" src="docs/assets/inbox-rs.svg" width="340">
</picture>

### Capture anything. Own everything.

One inbox for everything you save — and everything you do with it.<br>
No server, no API, no account. Your data lives on storage you control.

[![CI](https://github.com/silverbucket/inbox-rs/actions/workflows/ci.yml/badge.svg)](https://github.com/silverbucket/inbox-rs/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/silverbucket/inbox-rs?color=6366f1)](https://github.com/silverbucket/inbox-rs/releases)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-6366f1)](#license)
[![remoteStorage](https://img.shields.io/badge/storage-remoteStorage-FF4B03)](https://remotestorage.io)

</div>

---

Save a link, a note, a photo, a voice memo, a document, or an email from wherever
you happen to be — then file it, schedule it, and act on it. Inbox RS runs
entirely in your browser and syncs straight to a
[remoteStorage](https://remotestorage.io) server you control. There is no
backend to run, nothing to sign up for, and nobody in the middle.

## How it works

**Capture** — Everything lands in one inbox as a card. Paste a URL or type into
the quick-capture bar and it becomes a bookmark or a note automatically; add
images, audio, documents, and emails from any of the clients below. Bookmarks
fill in their own title, description, and preview image. Audio is transcribed
on-device — the recording never leaves your machine to become searchable text.

**Organize** — File cards into collections, group related collections together,
and filter the view down to what you're working on. Any card can become a todo,
and todos get their own page with drag-to-order and a collapsed completed
section.

**Act** — Give a card a time and it becomes a scheduled event or task, with an
in-app alert when it comes due. From there it can be published to a real
calendar over CalDAV or downloaded as an `.ics` file. The card stays the
editor — the calendar entry is a projection of it.

## Where you capture from

| Client | What it's for |
|---|---|
| **Web app** | The full inbox. Installs as a PWA and registers as a system share target, so "Share → Inbox RS" from any app opens a quick-capture window. Works offline. |
| **Browser extension** | Chrome MV3 + Firefox. Save the current page, jot a quick note, or right-click to save a link, an image (the actual binary, not the URL), or a text selection. Tweets capture their full text and attached images. |
| **Thunderbird extension** | MailExtension for Thunderbird 128+. Saves an email with its subject, sender, and body, plus your own notes and a `mid:` link back to the original message. |
| **[Mobile app](https://github.com/silverbucket/inbox-rs-mobile)** | Native iOS/Android (Flutter) for capture on the go — notes, audio, photos — with an offline queue that syncs automatically. |

The web app's **Plugins** page (`#/plugins`) serves the browser and Thunderbird
builds as direct downloads.

## Architecture

Client-side only. The browser talks directly to your remoteStorage server —
there is no backend of our own, and no request ever passes through infrastructure
we run.

```
packages/
  rs-module/    # Shared remoteStorage data module (types, schemas, CRUD, migrations)
  web/          # Svelte 5 web app + quick-capture PWA
  extension/    # Chrome MV3 + Firefox WebExtension (popup, context menus, content script)
  thunderbird/  # Thunderbird MailExtension (message toolbar popup)
```

All four packages share `@inbox-rs/rs-module` for consistent data types and
storage layout.

### Reaching the outside world with Sockethub

A browser tab can't fetch a page's Open Graph tags across origins, and it can't
speak CalDAV — no calendar server sends CORS headers. Rather than stand up a
backend for those two jobs, Inbox RS relays them through
**[Sockethub](https://sockethub.org)**, an open-source protocol gateway that
turns messy external protocols into one consistent ActivityStreams message
format:

- **Link enrichment** — a bookmark's title, description, and preview image are
  fetched by Sockethub and handed back as an ActivityStreams object.
- **Calendars** — CalDAV discovery and publishing. Credentials are sent per
  request from a credential store that is torn down when the request completes,
  so no password is ever stored server-side. They stay on your device and are
  never synced.

Sockethub is the *only* way this app reaches the internet, and you can point it
at your own instance in settings. Everything else is your browser and your
storage server.

### Storage layout

Everything lives under the `inbox` scope on your remoteStorage server:

```
items/{uuid}                 # JSON metadata for each item
files/{uuid}.{ext}           # Binary files (images, audio, video, documents)
files/{uuid}.thumb.jpg       # Downscaled image previews for the card grid
collections/{uuid}           # Collection definitions and their item order
groups/{uuid}                # Collection groups
config/app                   # UI state: ordering, filters, expanded sections
config/user                  # User settings: theme, link previews, calendar mode
```

### Item types

| Type | Description |
|---|---|
| `bookmark` | URL with title, description, og:image, favicon, site name. May carry `body` (embedded content like tweet text) and `filePath` (a downloaded image). |
| `note` | Freeform Markdown text with title and body. |
| `image` | Image binary with metadata, optional source URL, and optional thumbnail. |
| `audio` | Audio recording with duration and transcription text. |
| `video` | Video file with duration and optional transcription. |
| `document` | Uploaded file with name, size, and mime type. |
| `email` | Subject, body, sender, your notes, and a `mid:` URI back to the message. |
| `todo` | Task with completion status and notes. Any item can be converted to a todo. |

Every type shares the same base: collection membership, pinning, and the
scheduling fields (`startsAt`, `endsAt`, `allDay`, `scheduleKind`) that drive
alerts and calendar publishing.

## Quick start

```bash
npm install
docker compose up -d   # Local remoteStorage server (Armadietto) on :8000
npm run dev            # Web app on http://localhost:5173
```

Sign up a test user at `http://localhost:8000/signup`, then connect the app with
`testuser@localhost:8000`. See [DEVELOPMENT.md](DEVELOPMENT.md) for extension
loading, Firefox builds, and the full setup.

```bash
npm run build             # Web app + packaged plugin downloads into packages/web/dist/
npm run build:extension   # Browser extension only
npm run build:thunderbird # Thunderbird extension only
npm test                  # Unit tests (all packages)
npm run test:e2e          # Playwright end-to-end suite
npm run check             # Biome lint + format
```

`npm run build` emits a self-contained `packages/web/dist/` for static hosting,
including `downloads/inbox-rs-{chromium,firefox,thunderbird}-<version>.{zip,xpi}`.

## Releasing

```bash
gh workflow run release.yml -f bump=patch    # or minor / major
```

The web app version tracks the root `package.json`. The browser and Thunderbird
extensions have their own version namespaces and only move when their bundle
changed since the previous tag — see [`docs/RELEASING.md`](docs/RELEASING.md).

## Tech stack

- **Svelte 5** with runes (`$state`, `$derived`, `$effect`, `$props`)
- **Vite 6** for every package; **vite-plugin-pwa** for offline + share target
- **remotestorage.js** for sync, **remotestorage-module-shares** for public share links
- **TipTap** + **marked** for Markdown editing and rendering
- **transformers.js** (Whisper tiny, WASM) for on-device audio transcription
- **TypeScript** throughout, **Biome** for lint/format, **Vitest** + **Playwright** for tests
- **Chrome Manifest V3** / Firefox WebExtension APIs / **Thunderbird Manifest V2**
- **Armadietto** as the local dev remoteStorage server

## License

GPL-3.0

---

<div align="center">

**Built on open protocols**

<a href="https://remotestorage.io">
  <img alt="remoteStorage" src="docs/assets/remotestorage.svg" height="56">
</a>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://sockethub.org">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/sockethub-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/sockethub-light.svg">
    <img alt="Sockethub" src="docs/assets/sockethub.svg" height="42">
  </picture>
</a>

<br>

<sub><a href="https://remotestorage.io">remoteStorage</a> keeps your data yours&nbsp; ·&nbsp; <a href="https://sockethub.org">Sockethub</a> talks to everything else</sub>

</div>
