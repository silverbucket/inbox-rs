// Build-time facts about the running bundle, in the form the UI shows them.
// __STAGING__ and __BUILD_DATE__ are compile-time constants from vite.config.ts.
import { appVersion } from './plugin-downloads.generated';

/** Version as shown in Settings › About: the release number, or "Staging". */
export const versionLabel: string = __STAGING__ ? 'Staging' : appVersion;

/** Footer form of the same: "v2.5.10" for releases, "Staging" otherwise. */
export const footerVersionLabel: string = __STAGING__
  ? 'Staging'
  : `v${appVersion}`;

/** UTC date (YYYY-MM-DD) this bundle was built — and therefore deployed. */
export const buildDate: string = __BUILD_DATE__;
