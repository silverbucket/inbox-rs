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
