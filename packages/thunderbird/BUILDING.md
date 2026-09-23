# Thunderbird review packages

From the repository root, with Node.js 24, npm 11 and Info-ZIP zip/unzip installed:

```sh
npm ci
npm run package:thunderbird
npm run check:submissions -- thunderbird
```

Upload the matching XPI and source ZIP from `dist/submissions/thunderbird/` to
ATN. The source ZIP contains a root README with standalone reviewer commands
(`npm ci` and `npm run package:submission`), exact build environment details,
source for Thunderbird and rs-module, and a scoped lockfile. No Git checkout,
Thunderbird installation, account or remoteStorage server is needed to rebuild.

The scoped lockfile preserves every retained dependency's version, resolution
and integrity. The rebuild check installs from that archive, audits its
required dependencies and compares every unpacked XPI file byte for byte.
Archive timestamps may differ. See `docs/THUNDERBIRD-LISTING.md` for listing and
manual submission steps.
