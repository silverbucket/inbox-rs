import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const MODEL_ID = 'Xenova/whisper-tiny';
const MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';
const MODEL_ASSETS = [
  {
    file: 'config.json',
    size: 2248,
    sha256: '2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94',
  },
  {
    file: 'generation_config.json',
    size: 3716,
    sha256: '68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c',
  },
  {
    file: 'preprocessor_config.json',
    size: 339,
    sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
  },
  {
    file: 'tokenizer.json',
    size: 2480466,
    sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
  },
  {
    file: 'tokenizer_config.json',
    size: 282683,
    sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce',
  },
  {
    file: 'onnx/encoder_model_quantized.onnx',
    size: 10124910,
    sha256: 'fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e',
  },
  {
    file: 'onnx/decoder_model_merged_quantized.onnx',
    size: 30727765,
    sha256: '6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0',
  },
];
const ORT_WASM_ASSETS = [
  {
    file: 'ort-wasm.wasm',
    size: 9223228,
    sha256: 'bbdcb6b3c7d294577d806077630460be4e13ca35a345acb5e81188e9649fa74a',
  },
  {
    file: 'ort-wasm-simd.wasm',
    size: 10014674,
    sha256: '9bd07bababc65f53d061f457233eeae501be7ceb8a2adb9eef52d87fe776d865',
  },
  {
    file: 'ort-wasm-threaded.wasm',
    size: 9149637,
    sha256: '2ee2f715093aaacc0344bfb1610313eb49a3474e8afde5e4635f30ddfc7615c8',
  },
  {
    file: 'ort-wasm-threaded.js',
    size: 32695,
    sha256: '9cddaf5dd8043de8b33c423b6ac29231547e5f89a0016c82c36c934089e065d1',
  },
  {
    file: 'ort-wasm-threaded.worker.js',
    size: 2366,
    sha256: '0cf0d14ffa4dcbece952a66ee317ff656915784aa5cb6b86e0c0beb2d1d8a5e9',
  },
  {
    file: 'ort-wasm-simd-threaded.wasm',
    size: 9960821,
    sha256: 'ac23f2f3cbd519a65a0796f7c79eb34ead4c1f6f31eb06e14ed8a9579d697ef6',
  },
];

const publicRoot = path.join(repoRoot, 'packages/web/public/ml');
const modelRoot = path.join(publicRoot, 'models', MODEL_ID);
const ortRoot = path.join(publicRoot, 'onnxruntime');
const ortSourceRoot = path.join(repoRoot, 'node_modules/onnxruntime-web/dist');
const modelBaseUrl = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}`;
const forceRefresh =
  process.argv.includes('--refresh') ||
  process.env.FORCE_VENDOR_TRANSCRIPTION_ASSETS === '1';
const MAX_DOWNLOAD_ATTEMPTS = 5;

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fileMatchesManifest(file, asset) {
  try {
    const info = await stat(file);
    if (info.size !== asset.size) return false;
    const buffer = await readFile(file);
    return sha256(buffer) === asset.sha256;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header) {
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const timestamp = Date.parse(header);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

function isRetryableDownloadStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithRetry(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url);
      if (
        response.ok ||
        !isRetryableDownloadStatus(response.status) ||
        attempt === MAX_DOWNLOAD_ATTEMPTS
      ) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(
        response.headers.get('retry-after'),
      );
      const delayMs = retryAfterMs ?? 1000 * 2 ** (attempt - 1);
      console.warn(
        `[vendor-transcription-assets] retrying ${url} after ${response.status} ${response.statusText} (attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS})`,
      );
      await sleep(delayMs);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_DOWNLOAD_ATTEMPTS) break;

      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(
        `[vendor-transcription-assets] retrying ${url} after download error (attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS})`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function copyStaticFile(source, destination, asset) {
  if (!forceRefresh && (await fileMatchesManifest(destination, asset))) {
    console.log(
      `[vendor-transcription-assets] kept ${path.relative(repoRoot, destination)}`,
    );
    return;
  }
  await ensureDir(path.dirname(destination));
  await copyFile(source, destination);
  console.log(
    `[vendor-transcription-assets] copied ${path.relative(repoRoot, destination)}`,
  );
}

async function downloadStaticFile(url, destination, asset) {
  if (!forceRefresh && (await fileMatchesManifest(destination, asset))) {
    console.log(
      `[vendor-transcription-assets] kept ${path.relative(repoRoot, destination)}`,
    );
    return;
  }

  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength !== asset.size || sha256(buffer) !== asset.sha256) {
    throw new Error(`Downloaded asset did not match manifest: ${url}`);
  }
  await ensureDir(path.dirname(destination));
  await writeFile(destination, buffer);
  console.log(
    `[vendor-transcription-assets] downloaded ${path.relative(repoRoot, destination)}`,
  );
}

async function main() {
  for (const asset of ORT_WASM_ASSETS) {
    await copyStaticFile(
      path.join(ortSourceRoot, asset.file),
      path.join(ortRoot, asset.file),
      asset,
    );
  }

  for (const asset of MODEL_ASSETS) {
    await downloadStaticFile(
      `${modelBaseUrl}/${asset.file}`,
      path.join(modelRoot, asset.file),
      asset,
    );
  }
}

main().catch((error) => {
  console.error('[vendor-transcription-assets] failed:', error);
  process.exitCode = 1;
});
