export {
  TRANSCRIPTION_MODEL_BASE_PATH,
  TRANSCRIPTION_MODEL_FILES,
  TRANSCRIPTION_MODEL_ID,
  TRANSCRIPTION_MODEL_REVISION,
  TRANSCRIPTION_WASM_BASE_PATH,
  TRANSCRIPTION_WASM_FILES,
} from './transcription-manifest';

import {
  createStoredWasmPaths,
  createTranscriptionAssetCache,
} from './transcription-assets';
import {
  TRANSCRIPTION_MODEL_BASE_PATH,
  TRANSCRIPTION_MODEL_ID,
  TRANSCRIPTION_WASM_BASE_PATH,
} from './transcription-manifest';

// The pipeline returned by @xenova/transformers is a callable instance whose
// own published types are too involved to be useful here — it's effectively a
// `(input, opts) => Promise<{ text: string }>` for whisper. Treat it as such.
type Transcriber = (
  input: Float32Array,
  options: { language: string; task: string },
) => Promise<{ text?: string }>;

type TransformersEnv = {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  localModelPath: string;
  useBrowserCache: boolean;
  useCustomCache: boolean;
  customCache: unknown;
  backends: {
    onnx: {
      wasm: {
        wasmPaths: string | Record<string, string>;
        numThreads?: number;
      };
    };
  };
};

type TranscriptionEnvOptions = {
  assetCache?: unknown;
  wasmPaths?: Record<string, string>;
};

let transcriber: Transcriber | null = null;
let loadPromise: Promise<Transcriber> | null = null;

export function configureTranscriptionEnv(
  env: TransformersEnv,
  options: TranscriptionEnvOptions = {},
) {
  // Keep inference entirely same-origin so the runtime does not fall back to
  // remote models or CDN-hosted ONNX assets.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = TRANSCRIPTION_MODEL_BASE_PATH;
  if (options.assetCache) {
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = options.assetCache;
  }
  env.backends.onnx.wasm.wasmPaths = Object.keys(options.wasmPaths ?? {}).length
    ? (options.wasmPaths as Record<string, string>)
    : TRANSCRIPTION_WASM_BASE_PATH;
  // `wasmPaths` only overrides WASM files, not ONNX Runtime's threaded worker
  // script. Keep transcription on the non-threaded runtime so cached blob URLs
  // are enough for offline inference.
  env.backends.onnx.wasm.numThreads = 1;
}

async function getTranscriber() {
  if (transcriber) return transcriber;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      configureTranscriptionEnv(env as TransformersEnv, {
        assetCache: createTranscriptionAssetCache(),
        wasmPaths: await createStoredWasmPaths(),
      });
      transcriber = (await pipeline(
        'automatic-speech-recognition',
        TRANSCRIPTION_MODEL_ID,
        {
          quantized: true,
        },
      )) as unknown as Transcriber;
      return transcriber;
    } catch (e) {
      console.error('[transcribe] Failed to load pipeline:', e);
      loadPromise = null;
      throw e;
    }
  })();
  return loadPromise;
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const t = await getTranscriber();
  // Convert blob to Float32Array PCM at 16kHz (what Whisper expects)
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  let float32: Float32Array;
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    float32 = audioBuffer.getChannelData(0);
  } finally {
    await audioContext.close();
  }

  const result = await t(float32, {
    language: 'en',
    task: 'transcribe',
  });
  return result.text?.trim() || '';
}
