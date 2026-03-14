# Inbox RS

## Architecture

This is a **client-side only** application. There is no server-side logic — Node.js is used only for build tooling. Do not introduce any server-side code, API routes, or backend logic.

### Packages (npm workspaces)

- **`@inbox-rs/web`** — Svelte 5 web app, built with Vite. Dev server on port 5173.
- **`@inbox-rs/extension`** — Browser extension (Chrome Manifest V3 + Firefox). Built with Vite + Svelte.
- **`@inbox-rs/rs-module`** — Shared TypeScript library for data types, schemas, and CRUD operations. Compiled with `tsc`.

### Data Layer

All data flows directly from the browser to a **remoteStorage** server — no intermediary API.

- Web app and extension both use `remotestoragejs` to read/write data.
- For local development, an Armadietto remoteStorage server runs in Docker (`docker-compose up`, port 8000).

## Development

```bash
npm run dev              # Start web app dev server
npm run build            # Build rs-module + web app
npm run build:extension  # Build browser extension
```

The shared `rs-module` must be built before the web app or extension can use it.

## Constraints

- **No server-side code.** Everything runs in the browser.
- **No Node.js-only dependencies in runtime code.** Packages like `onnxruntime-node` must be optional — the app runs in-browser only.
- Target both Chrome and Firefox for the extension.
