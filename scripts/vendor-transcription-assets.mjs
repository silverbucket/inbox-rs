import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const MODEL_ID = 'Xenova/whisper-tiny';
const MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';
const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
const ORT_WASM_FILES = [
  'ort-wasm.wasm',
  'ort-wasm-simd.wasm',
  'ort-wasm-threaded.wasm',
  'ort-wasm-threaded.js',
  'ort-wasm-threaded.worker.js',
  'ort-wasm-simd-threaded.wasm',
];

const publicRoot = path.join(repoRoot, 'packages/web/public/ml');
const modelRoot = path.join(publicRoot, 'models', MODEL_ID);
const ortRoot = path.join(publicRoot, 'onnxruntime');
const ortSourceRoot = path.join(repoRoot, 'node_modules/onnxruntime-web/dist');
const modelBaseUrl = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}`;

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function fileExistsWithSize(file, expectedSize) {
  try {
    const info = await stat(file);
    return info.size === expectedSize;
  } catch {
    return false;
  }
}

async function copyStaticFile(source, destination) {
  const info = await stat(source);
  if (await fileExistsWithSize(destination, info.size)) {
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

async function downloadStaticFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (await fileExistsWithSize(destination, buffer.byteLength)) {
    console.log(
      `[vendor-transcription-assets] kept ${path.relative(repoRoot, destination)}`,
    );
    return;
  }
  await ensureDir(path.dirname(destination));
  await writeFile(destination, buffer);
  console.log(
    `[vendor-transcription-assets] downloaded ${path.relative(repoRoot, destination)}`,
  );
}

async function main() {
  for (const file of ORT_WASM_FILES) {
    await copyStaticFile(
      path.join(ortSourceRoot, file),
      path.join(ortRoot, file),
    );
  }

  for (const file of MODEL_FILES) {
    await downloadStaticFile(
      `${modelBaseUrl}/${file}`,
      path.join(modelRoot, file),
    );
  }
}

main().catch((error) => {
  console.error('[vendor-transcription-assets] failed:', error);
  process.exitCode = 1;
});
