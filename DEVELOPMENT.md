# Development Guide

## Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Chrome or Firefox (for extension testing)

## Initial setup

```bash
# Install all dependencies (uses npm workspaces)
npm install

# Build the shared RS module (required before other packages)
npm run build -w packages/rs-module
```

## remoteStorage server

The project uses [Armadietto](https://github.com/remotestorage/armadietto) as a local remoteStorage server, running in Docker.

```bash
# Start the server (runs on http://localhost:8000)
docker compose up -d

# Check logs
docker compose logs -f armadietto

# Stop
docker compose down
```

On first run, sign up a test user at `http://localhost:8000/signup` (e.g. username: `testuser`, email: anything, password: anything).

## Web app

```bash
# Development server with HMR (http://localhost:5173)
npm run dev -w packages/web

# Production build
npm run build -w packages/web
```

### Connecting

1. Open `http://localhost:5173`
2. Enter your remoteStorage address: `testuser@localhost:8000`
3. You'll be redirected to authorize — click "Allow"
4. The inbox grid loads (empty initially)

## Browser extension

```bash
# Build the extension
npm run build -w packages/extension

# Rebuild after changes
npm run build -w packages/extension
```

### Loading in Chrome

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select `packages/extension/dist/`
5. After rebuilding, click the refresh icon on the extension card

### Loading in Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `packages/extension/dist/manifest.json`

### First-time setup

1. Click the extension icon — you'll see "Set Up"
2. Click it to open the options page
3. Enter your RS address (e.g. `testuser@localhost:8000`)
4. Click "Connect & Authorize"
5. Authorize in the popup window
6. You're connected — the popup now shows "Save Page" and "Quick Note" tabs

### Building for Firefox

```bash
BROWSER=firefox npm run build -w packages/extension
```

This uses `manifest.firefox.json` instead of `manifest.json`.

## Project structure

```
inbox-rs/
├── package.json                    # npm workspaces root
├── docker-compose.yml              # Armadietto RS server
├── armadietto.conf.json            # Server config
├── packages/
│   ├── rs-module/                  # Shared data module
│   │   └── src/
│   │       ├── index.ts            # Module definition (getAll, store, remove, etc.)
│   │       ├── types.ts            # TypeScript interfaces for all item types
│   │       └── schemas.ts          # JSON Schema for RS declareType
│   ├── web/                        # Svelte web app
│   │   └── src/
│   │       ├── App.svelte          # Main layout
│   │       ├── lib/
│   │       │   ├── rs.ts           # RS instance + getFileUrl helper
│   │       │   └── stores.ts       # Svelte stores (items, connection state)
│   │       └── components/
│   │           ├── InboxGrid.svelte      # CSS-column masonry layout
│   │           ├── InboxCard.svelte      # Type dispatcher
│   │           ├── BookmarkCard.svelte   # URL cards with images, body text
│   │           ├── NoteCard.svelte       # Text notes
│   │           ├── ImageCard.svelte      # Saved images
│   │           ├── VoiceMemoCard.svelte  # Audio player (planned)
│   │           ├── Lightbox.svelte       # Fullscreen image viewer
│   │           ├── ConnectWidget.svelte  # RS connect/disconnect
│   │           └── DeleteConfirm.svelte  # Delete confirmation dialog
│   └── extension/                  # Browser extension
│       ├── manifest.json           # Chrome MV3 manifest
│       ├── manifest.firefox.json   # Firefox manifest
│       ├── vite.config.ts          # Multi-entry build (popup, options, SW, content script)
│       └── src/
│           ├── popup/              # Extension popup (Save Page / Quick Note)
│           ├── options/            # Full-page setup/auth flow
│           ├── background/         # Service worker (context menus, image download)
│           ├── content/            # Content script (metadata extraction from pages)
│           └── lib/
│               ├── rs.ts           # DirectRS client + OAuth helpers
│               └── storage.ts      # Extension storage for RS config
```

## Key design decisions

### DirectRS vs remotestorage.js in the extension

The extension uses a custom `DirectRS` class that makes direct HTTP PUT/GET requests to the RS server, rather than going through the full remotestorage.js stack. This is because:

- MV3 service workers are short-lived — RS's caching/sync layer doesn't persist between wake-ups
- The extension only needs simple store operations, not full bidirectional sync
- Direct HTTP is more reliable in the constrained extension environment

### Image storage

Images are downloaded by the service worker and stored as binary files on the RS server. The web app displays them using direct URLs with bearer tokens in the query string (RFC 6750 section 2.3), avoiding the need to fetch binaries through the RS caching layer.

### Content script for metadata

The content script (`metadata.ts`) runs on all pages and extracts:
- Open Graph metadata (title, description, image, site name)
- Favicon URL
- Embedded content from specific sites (Twitter/X tweet text, Mastodon posts, Reddit posts, HN)
- Tweet images from the DOM (with `pbs.twimg.com` URL filtering)

For Twitter/X (an SPA), it uses a `MutationObserver` to wait for tweet content to render before extracting.

## Troubleshooting

### Extension popup hangs on "Connecting..."
The OAuth flow requires the options page. Click "Set Up" in the popup to open it.

### Items don't appear in web app after saving via extension
The web app syncs periodically. Refresh the page or wait a few seconds for RS to sync.

### Images don't load in web app
Check that the RS server is running (`docker compose up -d`). Images are loaded via direct URL to armadietto with the bearer token.

### Content script not working on a page
The content script runs at `document_idle`. If the page loaded before the extension was installed, refresh the tab.
