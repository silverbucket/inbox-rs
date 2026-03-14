let transcriber: any = null;
let loadPromise: Promise<any> | null = null;

async function getTranscriber() {
  if (transcriber) return transcriber;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { pipeline } = await import('@huggingface/transformers');
      transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
        dtype: 'q8',
        device: 'wasm',
      });
      return transcriber;
    } catch (e) {
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
