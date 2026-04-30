// The pipeline returned by @xenova/transformers is a callable instance whose
// own published types are too involved to be useful here — it's effectively a
// `(input, opts) => Promise<{ text: string }>` for whisper. Treat it as such.
type Transcriber = (
  input: Float32Array,
  options: { language: string; task: string },
) => Promise<{ text?: string }>;

let transcriber: Transcriber | null = null;
let loadPromise: Promise<Transcriber> | null = null;

async function getTranscriber() {
  if (transcriber) return transcriber;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false;
      transcriber = (await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny',
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
