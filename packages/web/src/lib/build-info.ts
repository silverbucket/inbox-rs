// Build-time facts about the running bundle, in the form the UI shows them.
// __STAGING__ and __BUILD_DATE__ are compile-time constants from vite.config.ts.
import { appVersion } from './plugin-downloads.generated';

/** True for staging bundles (STAGING_BUILD=1), false for releases and dev. */
export const isStagingBuild: boolean = __STAGING__;

/** Version as shown in Settings › About: the release number, or "Staging". */
export const versionLabel: string = __STAGING__ ? 'Staging' : appVersion;

/** Footer form of the same: "v2.5.10" for releases, "Staging" otherwise. */
export const footerVersionLabel: string = __STAGING__
  ? 'Staging'
  : `v${appVersion}`;

/**
 * UTC date and time (YYYY-MM-DD HH:MM UTC) this bundle was built — and
 * therefore deployed. Empty outside a real `vite build` (dev server,
 * vitest): those never deploy anything, so there's no honest stamp to show.
 */
export const buildDate: string = __BUILD_DATE__;
