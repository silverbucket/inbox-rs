# Thunderbird listing and submission

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

Capture these in Thunderbird using a demonstration email and account. Do not
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
`packages/thunderbird/dist/submission/`. The source ZIP includes its own root
README with installation and build instructions, a lockfile and a build environment
record. Do not upload an old XPI with sources from the current checkout.

For the reviewer's automated check, clone https://github.com/thunderbird/webext-linter
outside the project, run `npm install` there, extract the source ZIP into an empty
directory, and run:

```sh
node verify.js /absolute/path/to/addon.xpi --sca-root /absolute/path/to/extracted-source --sca-source packages/thunderbird/src
```

Review findings before submitting. Automated checks do not replace the actual
Thunderbird setup/save test or the reviewer's decision.

Mozilla's source submission requirements:
https://extensionworkshop.com/documentation/publish/source-code-submission/.

## Validation status (2026-09-22)

The 2.6.0 source archive was extracted into an empty directory and rebuilt using
its README commands. All 13 unpacked XPI files matched byte for byte. The source
ZIP contained 41 files, without dotfiles, macOS metadata or build output.
`npm run check` passed with existing warnings; all 1,019 tests passed.

The Thunderbird linter did **not** pass: it reported 11 dependency-advisory errors
against the shared monorepo lockfile, then stopped its review early. The flagged
packages were sharp, brace-expansion (two versions), browserslist, devalue,
fast-uri, linkify-it, nanoid, protobufjs, postcss and undici. Some belong to the web
workspace rather than the Thunderbird build; the report alone does not establish
that they ship in this XPI. Resolve the relevant advisories and the submission's
shared-lockfile scope, then rerun the full review. The broad `<all_urls>` permission
also received an informational finding. It supports user-chosen storage hosts.

Screenshots and the live ATN listing update remain outstanding. No submission or
release was performed. This validation applies to the current 2.6.0 sources, not
the previously rejected 1.5.0 artifact.
