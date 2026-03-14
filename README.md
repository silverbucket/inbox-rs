# Inbox RS

A universal inbox for saving URLs, notes, images, and voice memos — backed by [remoteStorage](https://remotestorage.io). Your data stays on your own storage server, not someone else's cloud.

## What it does

**Web App** — A Svelte app that displays all your saved items in a masonry grid. Connect to any remoteStorage-compatible server to view, browse, and delete your inbox items. Includes [Sharesome](https://sharesome.5apps.com) integration — save any image or file from your inbox to Sharesome with one click and get a public sharing link.

**Browser Extension** — A Chrome/Firefox extension for quickly saving things while browsing:

- **Save Page** — Saves the current page as a bookmark with title, og:image preview, favicon, and site name. For tweets, it captures the full tweet text and any attached images.
- **Quick Note** — Jot down a note with no page context needed.
- **Right-click: Save Link** — Save any link to your inbox.
- **Right-click: Save Image** — Downloads and saves the actual image binary (not just the URL).
- **Right-click: Save Selection** — Saves highlighted text as a note with a link back to the source page.

## Architecture

```
packages/
  rs-module/    # Shared remoteStorage data module (types, schemas, CRUD)
  web/          # Svelte web app (masonry grid, lightbox, delete)
  extension/    # Chrome MV3 + Firefox WebExtension (popup, context menus, content script)
```

All three packages share the `@inbox-rs/rs-module` for consistent data types and storage layout.

### Storage layout

```
/inbox/items/{uuid}          # JSON metadata for each item
/inbox/files/{uuid}.{ext}    # Binary files (images, audio)
```

### Item types

| Type | Description |
|------|-------------|
| `bookmark` | URL with title, description, og:image, favicon. Optionally includes `body` (embedded content like tweet text) and `filePath` (downloaded image). |
| `note` | Freeform text with title and body. |
| `image` | Downloaded image binary with metadata and optional source URL. |
| `voice-memo` | Audio recording with duration (planned). |

## Quick start

See [DEVELOPMENT.md](DEVELOPMENT.md) for full setup instructions.

```bash
npm install
docker compose up -d          # Start local remoteStorage server
npm run dev -w packages/web   # Start web app on localhost:5173
npm run build -w packages/extension  # Build extension, load dist/ in browser
```

## Tech stack

- **Svelte 5** with runes (`$state`, `$derived`, `$effect`, `$props`)
- **Vite 5** for both web app and extension builds
- **remotestorage.js** for data sync + **remotestorage-module-shares** for Sharesome integration
- **TypeScript** throughout
- **Chrome Manifest V3** / Firefox WebExtension APIs
- **Armadietto** as the local dev remoteStorage server

## License

MIT
