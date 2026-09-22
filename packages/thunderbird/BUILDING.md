# Reproduce the Inbox RS Thunderbird add-on

This source archive contains the Thunderbird add-on, its shared rs-module,
workspace manifests, the original npm lockfile, and packaging scripts. The other
workspace manifests preserve npm workspace resolution; their application sources
are not needed. No Git checkout or private dependencies are required.

## Environment

Use Node.js 24 and npm 11 (https://nodejs.org/en/download), plus the Info-ZIP `zip`
CLI and `unzip`. On Ubuntu install the latter with `sudo apt install zip unzip`;
on macOS they are provided by the OS. See BUILD-ENVIRONMENT.txt at the archive
root for the exact Node/npm versions and platform used to create this submission.
Internet access to the npm registry is required to install dependencies.
Thunderbird, Docker, and a remoteStorage account are not needed to build.

## Build

Extract the source ZIP into an empty directory and run from its root:

```sh
npm ci --workspace=packages/thunderbird --workspace=packages/rs-module --include-workspace-root=false
npm run package:thunderbird
```

The command compiles the shared TypeScript library, builds the Svelte add-on with
Vite, and creates these files (VERSION comes from packages/thunderbird/package.json):

- `packages/thunderbird/dist/submission/inbox-rs-thunderbird-VERSION.xpi`
- `packages/thunderbird/dist/submission/inbox-rs-thunderbird-VERSION-source.zip`

The unpacked extension is in `packages/thunderbird/dist/` (excluding its
`submission/` directory). To compare against the submitted XPI, extract both XPIs
to separate empty directories with `unzip`, then run `diff -ru` on those
directories. File contents must match; ZIP timestamps may differ.

The build uses the included lockfile without updating it. Do not run `npm update`
or substitute another lockfile. Build output, dependencies, hidden files, macOS
resource forks and symlinks are excluded from the source submission.
