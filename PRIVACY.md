# Inbox RS – Privacy Policy

Last updated: October 18, 2026

This policy covers the Inbox RS web app at https://inbox.5apps.com, its Chrome and Firefox extensions, and its Thunderbird add-on. Inbox RS is open source and runs on your device. It does not require an Inbox RS account or use an Inbox RS database for your saved content.

## Your content and storage provider

Inbox RS stores the items you create or choose to save, including URLs, titles, notes, selected text, images, files, audio, email text, and organizational settings. The web app can keep data locally for offline use and sync it directly with the remoteStorage provider you connect. The extensions send saved items directly to that provider.

Your provider receives your saved content and connection requests. Authorization takes place with the provider; Inbox RS stores an access token and connection details on your device rather than asking for your storage password. Data is not end-to-end encrypted by Inbox RS, so your storage provider can access stored content. Use a provider you trust and HTTPS for connections.

## Browser and email access

The browser extension reads page metadata to support capture and saves content when you use its popup or context-menu actions. It does not automatically upload your browsing history. Saving an image may fetch the image from its original host.

The Thunderbird add-on reads the displayed message to prepare its save popup. When you click Save to Inbox, it sends the subject, sender, text body, message reference, and any note you entered to your chosen storage. It does not automatically import your mailbox or save message attachments.

## Link previews and external content

When link previews are enabled (the default for the browser extension), Inbox RS sends a saved page URL to a Sockethub relay to retrieve metadata. The default relay is https://sockethub.silverbucket.net/sockethub-http. In the browser extension, Save Page uses this default relay; it removes fragments and embedded HTTP credentials first, but the URL path and query can still contain personal information. Disable link previews in the web app's link-preview setting, synced to the same storage account, to disable these lookups in the extension.

The web app also supports a custom Sockethub endpoint. The relay contacts the target website, and preview images or favicons may be fetched from external hosts. These services receive the requested URLs and ordinary network information such as IP addresses. Their logging and retention are controlled by their operators.

## Optional calendars and audio transcription

If you connect a CalDAV calendar in the web app, calendar requests pass through the Sockethub relay selected when that account is connected. The relay receives the calendar server address, username, app password, and calendar data needed for the request, and forwards requests to your calendar provider. Calendar credentials are stored locally on that device and are not synced through remoteStorage. You can remove the calendar account in settings and revoke its app password at your provider.

Audio transcription runs locally on your device using downloaded model files. Audio is not sent to an external transcription service. Audio and resulting text you save can still be stored with your chosen remoteStorage provider.

## Local data, hosting, and analytics

Inbox RS uses browser storage and caches for content, drafts, preferences, connection tokens, calendar credentials, and offline app assets. Other people with access to your device or browser profile may be able to access this information. Inbox RS does not include advertising trackers or analytics telemetry and does not sell your content.

The web host, storage provider, relay, and any external hosts contacted can receive ordinary network request information. This policy does not promise that those operators keep no logs; their own policies and retention practices apply.

## Your choices and deletion

You can disable link previews, disconnect storage, remove calendar accounts, and revoke authorization at your provider. Disconnecting or uninstalling does not delete previously saved items from your remoteStorage server. Delete items in Inbox RS while connected, or manage data directly with your provider. Clear the web app's site data or the extension's local data to remove device-local copies and credentials. Provider backups and server logs remain subject to that operator's retention practices.

## Changes and contact

Updates to this policy will be published here with a revised date. For privacy questions, contact the maintainer through https://github.com/silverbucket/inbox-rs. Do not include private content or credentials in public issues.
