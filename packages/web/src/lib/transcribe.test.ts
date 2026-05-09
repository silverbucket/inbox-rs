// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  configureTranscriptionEnv,
  TRANSCRIPTION_MODEL_BASE_PATH,
  TRANSCRIPTION_MODEL_FILES,
  TRANSCRIPTION_MODEL_ID,
  TRANSCRIPTION_MODEL_REVISION,
  TRANSCRIPTION_WASM_BASE_PATH,
  TRANSCRIPTION_WASM_FILES,
} from './transcribe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const publicRoot = path.join(repoRoot, 'packages/web/public');
const modelBaseDir = TRANSCRIPTION_MODEL_BASE_PATH.replace(/^\/+/, '');
const wasmBaseDir = TRANSCRIPTION_WASM_BASE_PATH.replace(/^\/+/, '');

describe('configureTranscriptionEnv', () => {
  it('forces same-origin transcription assets', () => {
    const env = {
      allowLocalModels: false,
      allowRemoteModels: true,
      localModelPath: '/',
      backends: {
        onnx: {
          wasm: {
            wasmPaths: '/cdn/',
          },
        },
      },
    };

    configureTranscriptionEnv(env);

    expect(env.allowLocalModels).toBe(true);
    expect(env.allowRemoteModels).toBe(false);
    expect(env.localModelPath).toBe(TRANSCRIPTION_MODEL_BASE_PATH);
    expect(env.backends.onnx.wasm.wasmPaths).toBe(TRANSCRIPTION_WASM_BASE_PATH);
  });
});

describe('vendored transcription assets', () => {
  it('pins the whisper snapshot used for local transcription assets', () => {
    expect(TRANSCRIPTION_MODEL_ID).toBe('Xenova/whisper-tiny');
    expect(TRANSCRIPTION_MODEL_REVISION).toBe(
      '5332fcc35e32a33b86612b9a57a89be7906102b1',
    );
  });

  it('ships every required whisper file under public/ml/models', () => {
    for (const relativeFile of TRANSCRIPTION_MODEL_FILES) {
      const file = path.join(
        publicRoot,
        modelBaseDir,
        TRANSCRIPTION_MODEL_ID,
        relativeFile,
      );
      expect(
        existsSync(file),
        `Missing transcription model asset: ${path.relative(repoRoot, file)}`,
      ).toBe(true);
    }
  });

  it('ships the local ONNX Runtime WASM payloads under public/ml/onnxruntime', () => {
    for (const relativeFile of TRANSCRIPTION_WASM_FILES) {
      const file = path.join(publicRoot, wasmBaseDir, relativeFile);
      expect(
        existsSync(file),
        `Missing ONNX Runtime asset: ${path.relative(repoRoot, file)}`,
      ).toBe(true);
    }
  });
});
