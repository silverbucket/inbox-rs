# Chrome and Firefox store listings

## Listing description

Save web pages, images, selected text and quick notes to your Inbox RS inbox.
Connect your own remoteStorage account, then capture items while browsing and
organize them at https://inbox.5apps.com using the same storage account.

### Find and set up Inbox RS

1. Open your browser's Extensions menu (the puzzle-piece button) and choose
   **Inbox RS**. Pin it to the toolbar for quick access.
2. Click **Set Up**. You can also open the extension's options from the browser's
   extension manager; after connecting, the popup's gear button opens Settings.
3. Enter your remoteStorage address, such as `you@provider.example`. This may be
   different from your email address.
4. Click **Connect & Authorize**, sign in with your storage provider, and approve
   access. The setup screen displays **Connected** when ready.
5. Return to an ordinary web page and click Inbox RS again.

### Capture while browsing

- **Save Page:** review or edit the page title and URL, optionally add a note,
  then click **Save Page**. Page metadata and an available preview image may be
  included. This saves a bookmark, not a complete offline copy of the website.
- **Quick Note:** select the **Quick Note** tab, enter your note and an optional
  title, then click **Save Note**.
- **Images:** on a direct image URL, the popup offers **Save Image**. You can also
  right-click an image and choose **Save image to Inbox**.
- **Links:** right-click a link and choose **Save link to Inbox**.
- **Selected text:** select text, right-click it, and choose **Save to Inbox**.

Connect your storage before using the context-menu actions. The popup shows
**Saved to inbox** after a successful save. If it displays a save error, leave
it open and retry after restoring the connection. Browser-internal pages and
extension-store pages restrict extension access; use a normal website when
trying the extension for the first time.

Open https://inbox.5apps.com and connect the same remoteStorage account to view
and organize your saved items. Use **Disconnect** in the extension's Settings
to change accounts. Saving requires access to your storage server.

### Your storage, your choice

remoteStorage is an open protocol that lets applications store data on a server
you choose. Find background information and providers at https://remotestorage.io/.
Inbox RS sends captured content directly to your chosen storage server. It does
not automatically archive your browsing history. Storage credentials are granted
through your provider's authorization screen.

For local development, the Inbox RS repository includes an Armadietto server.
Install Docker and Docker Compose, then run from the repository root:

```sh
docker compose up -d --build armadietto
```

Create an account at http://localhost:8000/signup, enter
`yourusername@localhost:8000` in Inbox RS setup and authorize access. Keep the
server running while saving or reading items. The Compose setup uses a persistent
Docker volume. Local HTTP is for development on that machine; use HTTPS and a
reachable server for other devices. More server details:
https://github.com/remotestorage/armadietto.

### Permissions

Website access supports page metadata, fetching selected images, remoteStorage
discovery, and sending saved content to the storage provider you choose. Context
menus provide the right-click save actions. Local extension storage remembers
your storage connection; the identity API opens the provider's authorization
flow. Review the store's privacy disclosures against this behavior before publishing.

## Screenshots and captions

`npm run test:extensions` captures the real installed extension UI with fictional
data in each browser, under `dist/submissions/screenshots/`:

| Screenshot | Caption |
| --- | --- |
| `chromium-setup.png` / `firefox-setup.png` | Connect your own remoteStorage account. |
| `chromium-save-page.png` / `firefox-save-page.png` | Save a page with a title and an optional note. |
| `chromium-quick-note.png` / `firefox-quick-note.png` | Capture a quick note without leaving your browser. |

These show extension pages rendered in browser tabs during automation. They do
not show the toolbar popup anchored to the browser chrome. A manual toolbar
capture can supplement them. Upload the Chromium images to Chrome Web Store and
the Firefox images to AMO; store listings are edited manually.

## Manual sign-in and entry-point check

The automated smoke test installs the packaged extension, seeds a fictional
storage connection, and verifies content-script messaging, bookmark/note uploads,
image upload, failed-save retry and disconnect against a local HTTP fixture.
It does not test a provider's real OAuth UI or right-click menu interactions.
Before submitting, use a test storage account to confirm **Set Up → Connect &
Authorize**, toolbar access, and each of the three right-click actions in both
browsers. Confirm the saved items in the web app with that account.
