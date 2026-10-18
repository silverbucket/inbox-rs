# Thunderbird listing and submission

Privacy policy: https://inbox.5apps.com/privacy/ ([repository copy](../PRIVACY.md)).

The browser extension's **Save Page** sends the page URL to
`sockethub.silverbucket.net` for link previews. Disable this through the web app's
link-preview setting using the same storage account. Thunderbird's Save to Inbox
saves email text directly to your storage and does not use Save Page.

## Listing description (copy to ATN)

Save an email from Thunderbird to your Inbox RS inbox, with an optional note.
Inbox RS requires Thunderbird 128 or later and a remoteStorage account or your
own compatible server.

**Where to find it**

Open an individual email in Thunderbird's message pane, tab, or window. Look for
Inbox RS in the message toolbar (the button's tooltip is “Save to Inbox RS”).
Click it to open the save popup. On first use, click **Set Up** to open the
connection page. After connecting, the popup's gear button opens Settings.

**Connect your storage**

1. Get a remoteStorage address from your provider, or run your own server as
   described below. Your storage address may differ from your email address.
2. In Inbox RS setup, enter that address, for example `user@provider.example`.
3. Click **Connect & Authorize**, sign in at your storage provider, and grant
   Inbox RS access. Return to Thunderbird; setup will show **Connected**.
4. Open an email and click the Inbox RS message-toolbar button again.

**Save an email**

Review or edit the subject, check the sender and body preview, and optionally
enter a note. Click **Save to Inbox**. The popup shows **Saved to inbox** after a
successful upload, then closes. If an error is shown, the popup stays open so you
can retry. This is a manual capture action; it does not automatically import your
mailbox. It saves the text content, not an archive of the original message and
its attachments.

Open https://inbox.5apps.com and connect the same remoteStorage account to view
and organize saved items. To change accounts, open the popup's gear button,
click **Disconnect**, and connect another address.

**What is remoteStorage?**

remoteStorage is an open protocol for storing application data on a server you
choose. Learn about the protocol and available providers at https://remotestorage.io/.
Inbox RS sends saved email content directly to your chosen storage server.
Authorization lets the add-on access its storage without asking for your storage
password in the add-on itself.

**Run a local server (optional)**

Developers and self-hosters can run Armadietto, a remoteStorage server. From the
Inbox RS repository, with Docker and Docker Compose installed:

```sh
docker compose up -d --build armadietto
```

Open http://localhost:8000/signup to create an account, then enter
`yourusername@localhost:8000` in the add-on's setup and authorize access. Keep
Docker running when saving or reading items. The repository's Compose setup
stores data in a persistent Docker volume. This local HTTP setup is intended for
development on the same machine; for access from other devices, configure a
reachable remoteStorage server with HTTPS. Server information:
https://github.com/remotestorage/armadietto.

## Screenshots to upload

Run `npm run build:thunderbird` then `npm run screenshots:thunderbird` for
`thunderbird-setup.png`, `thunderbird-connected.png` and
`thunderbird-save-popup.png` in `dist/submissions/screenshots/` (1280×800).
The same command creates `chromium-promo-440x280.png` from the repository logo.
Automated captures use fictional API data in Chromium.

For a supplementary real Thunderbird capture, use a demonstration email and account. Do not
show real mail or authorization tokens. Include the Thunderbird chrome in the
first screenshot so users can locate the entry point.

1. **Find Inbox RS:** an open demonstration email with the Inbox RS button visible
   in the message toolbar.
2. **Connect your storage:** the setup page with its address field and
   **Connect & Authorize** button.
3. **Save an email:** the popup showing a demonstration subject, sender, body
   preview, optional note and **Save to Inbox** button.

These captures must be uploaded to the ATN listing before resubmission; this file
is listing copy and a capture checklist, not evidence that the listing was edited.

## Prepare the submission

Run `npm run package:thunderbird`. Upload the matching XPI and source ZIP from
`dist/submissions/thunderbird/`. The source ZIP includes its own root
README with installation and build instructions, a lockfile and a build environment
record. Do not upload an old XPI with sources from the current checkout.

For the reviewer's automated check, clone https://github.com/thunderbird/webext-linter
outside the project, run `npm install` there, extract the source ZIP into an empty
directory, and run:

```sh
node verify.js /abs/path/inbox-rs-thunderbird-<v>.xpi --sca-root /abs/path/extracted-source
```

Review findings before submitting. Automated checks do not replace the actual
Thunderbird setup/save test or the reviewer's decision.

Mozilla's source submission requirements:
https://extensionworkshop.com/documentation/publish/source-code-submission/.

## Validation status (2026-10-18)

The scoped source-only rebuild passed `npm run check:submissions` for Chromium,
Firefox and Thunderbird: every unpacked file and each whole installable ZIP/XPI
matched byte for byte. Scoped dependency audits passed at the high threshold.
The source includes vendored rs-migrate v1.0.2 (MIT), with no rs-migrate registry
dependency, and normalized archive timestamps and file modes.

Thunderbird webext-linter 2.5.1, commit
`7802ee765fc3c86fb5baec5833a47092f6ef8d00`, was run in SCA mode against the
Thunderbird 2.6.3 XPI and its extracted source ZIP. It reported **0 errors,
0 holds, 0 warnings and 1 info** for `<all_urls>`, required for user-selected
storage hosts. It also listed 4 extended code, 1 extended manual, 11 standard
code and 10 standard manual review items; those are human review prompts,
not completed manual checks. The local report is
`dist/submissions/thunderbird/reviewer-report.txt`.

`npm run screenshots:thunderbird` captures setup, connected setup and the email
save popup at 1280×800 using the built UI and fictional Thunderbird API stubs.
These are UI previews, not screenshots of a real Thunderbird installation.
A real Thunderbird toolbar/OAuth/save check and live store listing updates
remain manual. No store submission or release was performed.
