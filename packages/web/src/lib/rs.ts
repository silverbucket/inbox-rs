import RemoteStorage from 'remotestoragejs';
import InboxModule from '@inbox-rs/rs-module';
import SharesModule from 'remotestorage-module-shares';

const rs = new RemoteStorage({
  modules: [InboxModule, SharesModule],
  changeEvents: { local: true, window: false, remote: true, conflict: true }
});

rs.access.claim('inbox', 'rw');
rs.access.claim('shares', 'rw');
rs.caching.enable('/inbox/');

/**
 * Build a direct URL to an RS file that can be used as an img src.
 * Uses RFC 6750 §2.3 (bearer token in query string), which armadietto supports.
 * Returns null if not connected.
 */
export function getFileUrl(path: string): string | null {
  const remote = (rs as any).remote;
  if (!remote?.href || !remote?.token) return null;
  return `${remote.href}/inbox/${path}?access_token=${encodeURIComponent(remote.token)}`;
}

export default rs;
