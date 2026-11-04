// Background script for Inbox RS Thunderbird extension
// The popup handles all logic directly via messenger.* APIs

import { hasStorageOriginPermission } from '../lib/permissions';
import { getConfig } from '../lib/storage';

console.log('Inbox RS Thunderbird extension loaded');

// `<all_urls>` is an optional permission the user can revoke at any time
// from Thunderbird's add-on manager, independently of this extension. Warn
// as early as possible (rather than waiting for the next save to fail)
// so the user knows to reconnect from Options.
async function warnIfStoragePermissionMissing(): Promise<void> {
  const config = await getConfig();
  if (!config?.token || !config?.href) return;
  if (await hasStorageOriginPermission(config)) return;
  console.warn(
    'Inbox RS: permission for the saved remoteStorage server is missing. Reconnect from the Inbox RS Options page to restore access.',
  );
}

warnIfStoragePermissionMissing();
