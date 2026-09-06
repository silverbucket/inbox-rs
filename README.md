<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/inbox-rs-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/inbox-rs-light.svg">
  <img alt="Inbox RS" src="docs/assets/inbox-rs.svg" width="340">
</picture>

### Capture anything. Own everything.

One inbox for everything you save — and everything you do with it.<br>
No backend, no API, no account of ours. Your data lives on storage you control.

[![CI](https://github.com/silverbucket/inbox-rs/actions/workflows/ci.yml/badge.svg)](https://github.com/silverbucket/inbox-rs/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/silverbucket/inbox-rs?color=6366f1)](https://github.com/silverbucket/inbox-rs/releases)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-6366f1)](LICENSE)
[![remoteStorage](https://img.shields.io/badge/storage-remoteStorage-FF4B03)](https://remotestorage.io)

</div>

---

Save a link, a note, a photo, a voice memo, a document, or an email from wherever
you happen to be — then file it, schedule it, and act on it. Inbox RS runs
entirely in your browser and syncs straight to a
[remoteStorage](https://remotestorage.io) server you control. The two things a
browser can't do alone go through a [Sockethub](https://sockethub.org) relay you
can host yourself. There is no backend of ours in the data path, no Inbox RS
account, and no analytics or telemetry anywhere.

## How it works

**Capture** — Everything lands in one inbox as a card. Paste a URL or type into
the quick-capture bar and it becomes a bookmark or a note automatically; add
images, audio, documents, and emails from any of the clients below. Bookmarks
fill in their own title, description, and preview image. Audio is transcribed
on-device with a local Whisper model, so a recording is never handed to a
third-party speech-to-text service to become searchable text — it syncs to your
storage server like any other file, and nowhere else.

**Organize** — File cards into collections, group related collections together,
and filter the view down to what you're working on. Any card can become a todo,
and todos get their own page with drag-to-order and a collapsed completed
section. Search (`/`, or `⌘K` on a Mac and `Ctrl+K` elsewhere) runs across
everything at once — titles, notes, links, transcripts, and collection names —
and never leaves the browser.

**Act** — Give a card a time and it becomes a scheduled event or task, with an
in-app alert when it comes due. From there it can be published to a real
calendar over CalDAV or downloaded as an `.ics` file. The card stays the
editor — the calendar entry is a projection of it.

Whatever a card holds — a link, a note, a photo, a recording, a document, an
email — it shares one shape underneath, so filing, pinning, scheduling, and
completing all behave the same way. There is no per-type workflow to learn.

## Links keep their context

A traditional bookmark is a URL and a title. When the page goes away — the post
deleted, the account gone, the site reorganized — that is all you are left with,
and it is rarely enough to remember why you saved it.

Inbox RS saves the *content*, not just the pointer, and writes it into your own
storage:

- **Links captured without the extension.** [Sockethub](https://sockethub.org) fetches
  the page's title, description, site name, and preview image and hands them
  back as an ActivityStreams object; that text is written into your storage as
  your own copy of it. A browser tab can't do this itself — CORS blocks
  cross-origin page fetches — so Sockethub is what lets a link arrive with its
  context already attached from the system share sheet, the quick-capture app, or
  a URL pasted into the capture bar — anywhere there is no extension to read the
  page for you.
- **Posts and threads, through the browser extension.** On X, Mastodon, Reddit,
  and Hacker News the content script reads the post text out of the page and
  stores it in the card body, and the preview or attached image is downloaded
  and stored as an actual file rather than a hotlink. Highlight a passage before
  saving and that selection becomes the note.

A saved tweet still reads as the tweet a year later, after the account is gone.

## Where you capture from

| Client | What it's for |
|---|---|
| **Web app** | The full inbox — browsing, filing, scheduling, editing. Installs as a PWA and keeps working offline. |
| **Quick Capture** | A second, separately installable PWA at `/capture/`, built for a phone in one hand: a note, a voice memo, or a photo in a couple of taps. It registers as a system share target, so "Share → Capture" works from any app, and anything captured offline is queued on the device and delivered once connectivity returns. |
| **Browser extension** | Chrome MV3 + Firefox. Save the current page, jot a quick note, or right-click to save a link, an image (the actual binary, not the URL), or a text selection. Tweets capture their full text and attached images. |
| **Thunderbird extension** | MailExtension for Thunderbird 128+. Saves an email with its subject, sender, and body, plus your own notes and a `mid:` link back to the original message. |

The web app's **Plugins** page (`#/plugins`) serves the browser and Thunderbird
builds as direct downloads.

## Architecture

Client-side only. The browser holds your data and talks to your remoteStorage
server directly — there is no backend of ours in the data path, and no
analytics, telemetry or error reporting anywhere.

```text
packages/
  rs-module/    # Shared remoteStorage data module (types, schemas, CRUD, migrations)
  web/          # Svelte 5 web app + quick-capture PWA
  extension/    # Chrome MV3 + Firefox WebExtension (popup, context menus, content script)
  thunderbird/  # Thunderbird MailExtension (message toolbar popup)
```

All four packages share `@inbox-rs/rs-module` for consistent data types and
storage layout.

Two things a browser tab genuinely cannot do — read a page's Open Graph tags
across origins, and speak CalDAV — are relayed through
**[Sockethub](https://sockethub.org)** instead of a backend of our own. That
relay defaults to a host the author runs, and you can point it at your own
instance in settings. Calendar credentials stay on your device, are never
synced to your storage, and are held by the relay only for the life of a single
request.

Beyond your storage server and the relay, the browser contacts the WebFinger
and OAuth endpoints your address resolves to when you connect, and loads
favicons and preview images straight from the sites you bookmarked.

**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** has the full picture: every
outbound request, how the relay handles credentials, and the storage layout.

## Quick start

```bash
npm install
docker compose up -d   # Local remoteStorage server (Armadietto) on :8000
npm run dev            # Web app on http://localhost:5173
```

Sign up a test user at `http://localhost:8000/signup`, then connect the app with
`testuser@localhost:8000`. See [DEVELOPMENT.md](DEVELOPMENT.md) for extension
loading, Firefox builds, and the full setup, and
[`docs/RELEASING.md`](docs/RELEASING.md) for the release runbook.

```bash
npm run build             # Web app + packaged plugin downloads into packages/web/dist/
npm run build:extension   # Browser extension only
npm run build:thunderbird # Thunderbird extension only
npm test                  # Unit tests (all packages)
npm run test:e2e          # Playwright end-to-end suite
npm run check             # Biome lint + format
```

`npm run build` emits a self-contained `packages/web/dist/` for static hosting,
including the plugin artifacts. The browser and Thunderbird extensions carry
separate version namespaces, so their filenames don't move in lockstep:

```text
downloads/inbox-rs-chromium-<extension-version>.zip
downloads/inbox-rs-firefox-<extension-version>.xpi
downloads/inbox-rs-thunderbird-<thunderbird-version>.xpi
```

## Tech stack

- **Svelte 5** with runes (`$state`, `$derived`, `$effect`, `$props`)
- **Vite 6** for the web app and both extensions (`rs-module` compiles with `tsc`);
  **vite-plugin-pwa** for offline + share target
- **remotestorage.js** for sync, **remotestorage-module-shares** for public share links
- **TipTap** + **marked** for Markdown editing and rendering
- **transformers.js** (Whisper tiny, WASM) for on-device audio transcription
- **TypeScript** across all four packages (build scripts are plain ESM),
  **Biome** for lint/format, **Vitest** + **Playwright** for tests
- **Chrome Manifest V3** / Firefox WebExtension APIs / **Thunderbird Manifest V2**
- **Armadietto** as the local dev remoteStorage server

## License

[GPL-3.0-or-later](LICENSE) — © 2026 Nick Jennings.

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option)
any later version.

---

<div align="center">

**Built on open protocols**

<a href="https://remotestorage.io">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/remotestorage-text-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/remotestorage-text-light.svg">
    <img alt="remoteStorage" src="docs/assets/remotestorage-text.svg" height="48">
  </picture>
</a>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://sockethub.org">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/sockethub-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/sockethub-light.svg">
    <img alt="Sockethub" src="docs/assets/sockethub.svg" height="48">
  </picture>
</a>

<br>

<sub><a href="https://remotestorage.io">remoteStorage</a> keeps your data yours&nbsp; ·&nbsp; <a href="https://sockethub.org">Sockethub</a> reaches what the browser can't</sub>

</div>
