/**
 * Upload and publish the Chromium ZIP via the Chrome Web Store API v2.
 *
 * Usage (from .github/workflows/release.yml):
 *   node scripts/publish/chrome.mjs <zip> <version>
 *
 * Env: CHROME_EXTENSION_ID, CHROME_PUBLISHER_ID, CHROME_SERVICE_ACCOUNT_JSON
 * (the service account's JSON key; the account must be linked under Account in
 * the Chrome Web Store Developer Dashboard).
 *
 * A version that is already published or submitted for review is treated as
 * success, so re-running a release does not fail here.
 */

import { readFileSync } from 'node:fs';
import { notice, readBody, sleep } from './actions.mjs';
import { googleAssertion } from './jwt.mjs';

const API = 'https://chromewebstore.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const IN_PROGRESS = new Set(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']);

export async function accessToken(serviceAccount) {
  const response = await fetch(
    serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: googleAssertion(serviceAccount, SCOPE),
      }),
    },
  );
  const body = await readBody(response);
  if (!response.ok || !body.access_token) {
    throw new Error(
      `Service-account token exchange failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body.access_token;
}

/** True when the published or in-review revision already carries `version`. */
export function hasVersion(status, version) {
  return [
    status.publishedItemRevisionStatus,
    status.submittedItemRevisionStatus,
  ].some((revision) =>
    revision?.distributionChannels?.some(
      (channel) => channel.crxVersion === version,
    ),
  );
}

async function call(token, method, url, init = {}) {
  const response = await fetch(url, {
    method,
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      `${method} ${url} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

export async function publish({ zipPath, version, env = process.env }) {
  const serviceAccount = JSON.parse(env.CHROME_SERVICE_ACCOUNT_JSON);
  const item = `publishers/${env.CHROME_PUBLISHER_ID}/items/${env.CHROME_EXTENSION_ID}`;
  const token = await accessToken(serviceAccount);
  const fetchStatus = () => call(token, 'GET', `${API}/v2/${item}:fetchStatus`);

  if (hasVersion(await fetchStatus(), version)) {
    notice(
      `Chrome Web Store already has ${version} published or in review — nothing to do.`,
    );
    return;
  }

  let upload = await call(
    token,
    'POST',
    `${API}/upload/v2/${item}:upload?uploadType=media`,
    {
      headers: { 'content-type': 'application/zip' },
      body: readFileSync(zipPath),
    },
  );
  let state = upload.uploadState;
  for (let attempt = 0; IN_PROGRESS.has(state) && attempt < 60; attempt++) {
    await sleep(10_000);
    upload = await fetchStatus();
    state = upload.lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') {
    throw new Error(
      `Chrome Web Store upload did not succeed (state ${state}): ${JSON.stringify(upload)}`,
    );
  }
  console.log(`Uploaded ${zipPath} to Chrome Web Store item ${item}.`);

  const published = await call(token, 'POST', `${API}/v2/${item}:publish`, {
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  console.log(
    `Submitted ${version} for publishing: ${JSON.stringify(published)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [zipPath, version] = process.argv.slice(2);
  if (!zipPath || !version) {
    console.error('Usage: node scripts/publish/chrome.mjs <zip> <version>');
    process.exit(1);
  }
  publish({ zipPath, version }).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
