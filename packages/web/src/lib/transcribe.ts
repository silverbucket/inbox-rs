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

/**
 * Progress reported while `transcribeAudio` runs. The first run on a device
 * (or after the cached model expired) downloads the whisper model before any
 * inference happens, so callers can show "Downloading … 43%" rather than a
 * static "Transcribing…" that looks hung on a slow link.
 */
export type TranscriptionProgress =
  | { phase: 'downloading'; percent: number }
  | { phase: 'transcribing' };

type ProgressListener = (progress: TranscriptionProgress) => void;

let transcriber: Transcriber | null = null;
let loadPromise: Promise<Transcriber> | null = null;
const progressListeners = new Set<ProgressListener>();

type PipelineProgressEvent = {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
};

/**
 * Fold transformers.js per-file progress events into one overall percentage.
 * Files report `loaded`/`total` independently and in any order, so keep a
 * running tally per file and sum. Returns null until any byte count is known.
 */
export function createDownloadProgressTracker() {
  const files = new Map<string, { loaded: number; total: number }>();
  return (event: PipelineProgressEvent): number | null => {
    if (!event.file) return null;
    if (event.status === 'progress' && event.total) {
      files.set(event.file, {
        loaded: event.loaded ?? 0,
        total: event.total,
      });
    } else if (event.status === 'done') {
      const prior = files.get(event.file);
      if (prior)
        files.set(event.file, { loaded: prior.total, total: prior.total });
    }
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    if (total === 0) return null;
    return Math.min(100, Math.round((loaded / total) * 100));
  };
}

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

function emitProgress(progress: TranscriptionProgress) {
  for (const listener of progressListeners) listener(progress);
}

async function getTranscriber(onProgress?: ProgressListener) {
  if (transcriber) return transcriber;
  if (onProgress) progressListeners.add(onProgress);
  try {
    if (loadPromise) return await loadPromise;
    loadPromise = (async () => {
      try {
        const { pipeline, env } = await import('@xenova/transformers');
        configureTranscriptionEnv(env as TransformersEnv, {
          assetCache: createTranscriptionAssetCache(),
          wasmPaths: await createStoredWasmPaths(),
        });
        const track = createDownloadProgressTracker();
        transcriber = (await pipeline(
          'automatic-speech-recognition',
          TRANSCRIPTION_MODEL_ID,
          {
            quantized: true,
            progress_callback: (event: PipelineProgressEvent) => {
              const percent = track(event);
              // Cached files still report a final 100% event, so at 100 the
              // remaining wait is model initialisation, not a download.
              if (percent === null) return;
              emitProgress(
                percent >= 100
                  ? { phase: 'transcribing' }
                  : { phase: 'downloading', percent },
              );
            },
          },
        )) as unknown as Transcriber;
        return transcriber;
      } catch (e) {
        console.error('[transcribe] Failed to load pipeline:', e);
        loadPromise = null;
        throw e;
      }
    })();
    return await loadPromise;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

export async function transcribeAudio(
  audioBlob: Blob,
  options: { onProgress?: ProgressListener } = {},
): Promise<string> {
  const t = await getTranscriber(options.onProgress);
  options.onProgress?.({ phase: 'transcribing' });
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

/**
 * Turn a transcription failure into one sentence that says what happened and
 * what to do. Transcription can fail for unrelated reasons that need
 * different next steps, so the raw error alone ("Transcription failed") is
 * not enough for the user to recover.
 */
export function describeTranscriptionError(
  error: unknown,
  context: { online: boolean; modelReady: boolean },
): string {
  // Duck-type rather than `instanceof Error`: DOMException (what
  // decodeAudioData throws) doesn't share Error's prototype in every realm.
  const err = (error ?? {}) as { name?: unknown; message?: unknown };
  const name = typeof err.name === 'string' ? err.name : '';
  const message =
    typeof err.message === 'string' ? err.message : String(error ?? '');
  if (name === 'EncodingError') {
    return "This audio format can't be decoded in your browser.";
  }
  if (
    name === 'QuotaExceededError' ||
    /enough browser storage/i.test(message)
  ) {
    return 'Not enough browser storage for the transcription model. Free up space and try again.';
  }
  if (!context.modelReady && !context.online) {
    return "The transcription model isn't downloaded yet and you're offline. Connect and try again.";
  }
  if (
    !context.modelReady &&
    (name === 'TypeError' || /fetch|network|404|failed to load/i.test(message))
  ) {
    return "Couldn't download the transcription model. Check your connection and try again.";
  }
  return 'Transcription failed. Try again.';
}
