# Inbox RS Mobile

Native iOS/Android capture client for Inbox RS. Drop in text, audio, photos, or video and send to your remoteStorage inbox.

## Setup

Requires [Flutter](https://flutter.dev/docs/get-started/install) (3.x+).

```bash
cd packages/mobile
flutter pub get
flutter run
```

## Auth

The app authenticates via remoteStorage OAuth:

1. Enter your RS address (`user@host`) on the settings screen
2. WebFinger discovery finds the storage server
3. OAuth redirect via `inboxrs://` custom URL scheme
4. Token stored in platform secure storage (Keychain on iOS, Keystore on Android)

The `inboxrs://` callback scheme is registered in `ios/Runner/Info.plist` and `android/app/src/main/AndroidManifest.xml`.

## Platforms

- **iOS/Android** — primary targets with secure token storage, camera, mic, and gallery access
- **macOS** — works for development/testing (camera hidden, file-based token storage fallback)

## Offline Queue

Items are saved to disk immediately on send and uploaded in FIFO order when connected. Pending items survive app restarts and sync automatically when connectivity is restored.
