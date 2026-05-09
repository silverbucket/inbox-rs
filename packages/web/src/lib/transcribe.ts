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
  backends: {
    onnx: {
      wasm: {
        wasmPaths: string;
      };
    };
  };
};

export const TRANSCRIPTION_MODEL_ID = 'Xenova/whisper-tiny';
export const TRANSCRIPTION_MODEL_REVISION =
  '5332fcc35e32a33b86612b9a57a89be7906102b1';
export const TRANSCRIPTION_MODEL_BASE_PATH = '/ml/models/';
export const TRANSCRIPTION_WASM_BASE_PATH = '/ml/onnxruntime/';
export const TRANSCRIPTION_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
] as const;
export const TRANSCRIPTION_WASM_FILES = [
  'ort-wasm.wasm',
  'ort-wasm-simd.wasm',
  'ort-wasm-threaded.wasm',
  'ort-wasm-threaded.js',
  'ort-wasm-threaded.worker.js',
  'ort-wasm-simd-threaded.wasm',
] as const;

let transcriber: Transcriber | null = null;
let loadPromise: Promise<Transcriber> | null = null;

export function configureTranscriptionEnv(env: TransformersEnv) {
  // Keep inference entirely same-origin so the runtime does not fall back to
  // remote models or CDN-hosted ONNX assets.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = TRANSCRIPTION_MODEL_BASE_PATH;
  env.backends.onnx.wasm.wasmPaths = TRANSCRIPTION_WASM_BASE_PATH;
}

async function getTranscriber() {
  if (transcriber) return transcriber;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      configureTranscriptionEnv(env as TransformersEnv);
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
