/**
 * Upload the Thunderbird XPI to addons.thunderbird.net (ATN) as a new listed
 * version and wait for validation.
 *
 * Usage (from .github/workflows/release.yml):
 *   node scripts/publish/atn.mjs <xpi> <version> <source-zip-name>
 *
 * Env: ATN_JWT_ISSUER, ATN_JWT_SECRET, from
 * https://addons.thunderbird.net/developers/addon/api/key/.
 *
 * The ATN signing API has no source-code field, so the reviewer source ZIP
 * still has to be attached by hand; a workflow warning says so. An existing
 * version (409) is treated as success.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { notice, readBody, sleep, warning } from './actions.mjs';
import { addonsServerToken } from './jwt.mjs';

export const ADDON_ID = 'inbox-rs@silverbucket.net';
const API = 'https://addons.thunderbird.net/api/v4';

export function versionUrl(version, addonId = ADDON_ID) {
  return `${API}/addons/${addonId}/versions/${version}/`;
}

function authorization(env) {
  return `JWT ${addonsServerToken(env.ATN_JWT_ISSUER, env.ATN_JWT_SECRET)}`;
}

function sourceReminder(version, sourceName) {
  warning(
    `Upload ${sourceName} by hand as the source code for Thunderbird ${version}: https://addons.thunderbird.net/developers/addon/${ADDON_ID}/versions`,
  );
}

export async function publish({
  xpiPath,
  version,
  sourceName,
  env = process.env,
}) {
  const form = new FormData();
  form.append(
    'upload',
    new Blob([readFileSync(xpiPath)], { type: 'application/x-xpinstall' }),
    basename(xpiPath),
  );
  form.append('channel', 'listed');

  const response = await fetch(versionUrl(version), {
    method: 'PUT',
    headers: { authorization: authorization(env) },
    body: form,
  });
  let status = await readBody(response);

  if (response.status === 409) {
    notice(`ATN already has Thunderbird ${version} — nothing to upload.`);
    sourceReminder(version, sourceName);
    return;
  }
  if (response.status !== 201 && response.status !== 202) {
    throw new Error(
      `ATN upload failed (${response.status}): ${JSON.stringify(status)}`,
    );
  }
  console.log(`Uploaded ${xpiPath} to ATN; waiting for validation.`);

  for (let attempt = 0; !status.processed && attempt < 60; attempt++) {
    await sleep(10_000);
    const poll = await fetch(status.url || versionUrl(version), {
      headers: { authorization: authorization(env) },
    });
    status = await readBody(poll);
    if (!poll.ok) {
      throw new Error(
        `ATN status check failed (${poll.status}): ${JSON.stringify(status)}`,
      );
    }
  }
  if (!status.processed) {
    throw new Error(
      `ATN validation did not finish in time; check ${status.validation_url || status.url}`,
    );
  }
  if (!status.valid) {
    throw new Error(
      `ATN validation failed: ${status.validation_url || JSON.stringify(status.validation_results)}`,
    );
  }
  console.log(`ATN validated Thunderbird ${version}.`);
  sourceReminder(version, sourceName);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [xpiPath, version, sourceName] = process.argv.slice(2);
  if (!xpiPath || !version || !sourceName) {
    console.error(
      'Usage: node scripts/publish/atn.mjs <xpi> <version> <source-zip-name>',
    );
    process.exit(1);
  }
  publish({ xpiPath, version, sourceName }).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
