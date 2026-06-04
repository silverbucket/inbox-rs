import {
  TRANSCRIPTION_MODEL_BASE_PATH,
  TRANSCRIPTION_MODEL_FILES,
  TRANSCRIPTION_MODEL_ID,
  TRANSCRIPTION_MODEL_REVISION,
  TRANSCRIPTION_WASM_BASE_PATH,
  TRANSCRIPTION_WASM_FILES,
} from './transcription-manifest';

const DB_NAME = 'inbox-rs-transcription-assets';
const DB_VERSION = 1;
const STORE_NAME = 'assets';
const ASSET_VERSION = `whisper-tiny:${TRANSCRIPTION_MODEL_REVISION}:ort-web`;
const MAX_ASSET_AGE_MS = 1000 * 60 * 60 * 24 * 90;

type StoredAsset = {
  url: string;
  version: string;
  blob: Blob;
  size: number;
  storedAt: number;
  lastAccessedAt: number;
};

export type TranscriptionAsset = {
  url: string;
  size: number;
  kind: 'model' | 'runtime';
};

export type TranscriptionAssetStatus = {
  ready: boolean;
  storedBytes: number;
  totalBytes: number;
  storedAssets: number;
  totalAssets: number;
};

export type TranscriptionAssetProgress = TranscriptionAssetStatus & {
  currentUrl?: string;
};

const MODEL_ASSET_SIZES = new Map<string, number>([
  ['config.json', 2248],
  ['generation_config.json', 3716],
  ['preprocessor_config.json', 339],
  ['tokenizer.json', 2480466],
  ['tokenizer_config.json', 282683],
  ['onnx/encoder_model_quantized.onnx', 10124910],
  ['onnx/decoder_model_merged_quantized.onnx', 30727765],
]);

const WASM_ASSET_SIZES = new Map<string, number>([
  ['ort-wasm.wasm', 9223228],
  ['ort-wasm-simd.wasm', 10014674],
  ['ort-wasm-threaded.wasm', 9149637],
  ['ort-wasm-threaded.js', 32695],
  ['ort-wasm-threaded.worker.js', 2366],
  ['ort-wasm-simd-threaded.wasm', 9960821],
]);

export const TRANSCRIPTION_ASSETS: TranscriptionAsset[] = [
  ...TRANSCRIPTION_MODEL_FILES.map((file) => ({
    url: `${TRANSCRIPTION_MODEL_BASE_PATH}${TRANSCRIPTION_MODEL_ID}/${file}`,
    size: MODEL_ASSET_SIZES.get(file) ?? 0,
    kind: 'model' as const,
  })),
  ...TRANSCRIPTION_WASM_FILES.map((file) => ({
    url: `${TRANSCRIPTION_WASM_BASE_PATH}${file}`,
    size: WASM_ASSET_SIZES.get(file) ?? 0,
    kind: 'runtime' as const,
  })),
];

const assetUrls = new Set(TRANSCRIPTION_ASSETS.map((asset) => asset.url));

function normalizeUrl(input: RequestInfo | URL): string | null {
  const raw =
    typeof Request !== 'undefined' && input instanceof Request
      ? input.url
      : input.toString();
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  return `${url.pathname}${url.search}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'url' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    let result: T | undefined;
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function readAsset(url: string): Promise<StoredAsset | undefined> {
  const asset = await withStore<StoredAsset>('readonly', (store) =>
    store.get(url),
  );
  if (!asset || asset.version !== ASSET_VERSION) return undefined;
  return asset;
}

async function writeAsset(url: string, blob: Blob) {
  const now = Date.now();
  const asset: StoredAsset = {
    url,
    version: ASSET_VERSION,
    blob,
    size: blob.size,
    storedAt: now,
    lastAccessedAt: now,
  };
  await withStore('readwrite', (store) => store.put(asset));
}

async function touchAsset(asset: StoredAsset) {
  await withStore('readwrite', (store) =>
    store.put({ ...asset, lastAccessedAt: Date.now() }),
  );
}

async function deleteAsset(url: string) {
  await withStore('readwrite', (store) => store.delete(url));
}

async function getAllAssets(): Promise<StoredAsset[]> {
  return (
    (await withStore<StoredAsset[]>('readonly', (store) => store.getAll())) ??
    []
  );
}

export function formatTranscriptionAssetBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export async function cleanupExpiredTranscriptionAssets() {
  if (typeof indexedDB === 'undefined') return;
  const now = Date.now();
  for (const asset of await getAllAssets()) {
    if (
      !assetUrls.has(asset.url) ||
      asset.version !== ASSET_VERSION ||
      now - asset.lastAccessedAt > MAX_ASSET_AGE_MS
    ) {
      await deleteAsset(asset.url);
    }
  }
}

export async function getTranscriptionAssetStatus(): Promise<TranscriptionAssetStatus> {
  if (typeof indexedDB === 'undefined') {
    const totalBytes = TRANSCRIPTION_ASSETS.reduce(
      (sum, asset) => sum + asset.size,
      0,
    );
    return {
      ready: false,
      storedBytes: 0,
      totalBytes,
      storedAssets: 0,
      totalAssets: TRANSCRIPTION_ASSETS.length,
    };
  }

  await cleanupExpiredTranscriptionAssets();
  let storedBytes = 0;
  let storedAssets = 0;
  for (const asset of TRANSCRIPTION_ASSETS) {
    const stored = await readAsset(asset.url);
    if (stored) {
      storedBytes += stored.size;
      storedAssets++;
    }
  }
  const totalBytes = TRANSCRIPTION_ASSETS.reduce(
    (sum, asset) => sum + asset.size,
    0,
  );
  return {
    ready: storedAssets === TRANSCRIPTION_ASSETS.length,
    storedBytes,
    totalBytes,
    storedAssets,
    totalAssets: TRANSCRIPTION_ASSETS.length,
  };
}

async function assertEnoughStorage(remainingBytes: number) {
  if (!navigator.storage?.estimate) return;
  const { quota, usage } = await navigator.storage.estimate();
  if (quota === undefined || usage === undefined) return;
  const available = quota - usage;
  if (available < remainingBytes) {
    throw new Error(
      `Not enough browser storage for offline transcription assets. Need ${formatTranscriptionAssetBytes(remainingBytes)}, have ${formatTranscriptionAssetBytes(available)} available.`,
    );
  }
}

export async function downloadTranscriptionAssets(
  onProgress?: (progress: TranscriptionAssetProgress) => void,
): Promise<TranscriptionAssetStatus> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('Offline transcription storage is not available here.');
  }
  await cleanupExpiredTranscriptionAssets();
  const status = await getTranscriptionAssetStatus();
  await assertEnoughStorage(status.totalBytes - status.storedBytes);

  for (const asset of TRANSCRIPTION_ASSETS) {
    if (await readAsset(asset.url)) continue;
    onProgress?.({
      ...(await getTranscriptionAssetStatus()),
      currentUrl: asset.url,
    });
    const response = await fetch(asset.url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to download ${asset.url}: ${response.status}`);
    }
    await writeAsset(asset.url, await response.blob());
  }

  const finalStatus = await getTranscriptionAssetStatus();
  onProgress?.(finalStatus);
  return finalStatus;
}

export async function deleteTranscriptionAssets() {
  if (typeof indexedDB === 'undefined') return;
  for (const asset of TRANSCRIPTION_ASSETS) {
    await deleteAsset(asset.url);
  }
}

export function createTranscriptionAssetCache() {
  return {
    async match(input: RequestInfo | URL): Promise<Response | undefined> {
      if (typeof indexedDB === 'undefined') return undefined;
      const url = normalizeUrl(input);
      if (!url || !assetUrls.has(url)) return undefined;
      const asset = await readAsset(url);
      if (!asset) return undefined;
      await touchAsset(asset);
      return new Response(asset.blob);
    },
    async put(input: RequestInfo | URL, response: Response): Promise<void> {
      if (typeof indexedDB === 'undefined') return;
      const url = normalizeUrl(input);
      if (!url || !assetUrls.has(url) || !response.ok) return;
      await writeAsset(url, await response.clone().blob());
    },
  };
}

export async function createStoredWasmPaths(): Promise<Record<string, string>> {
  if (typeof indexedDB === 'undefined') return {};
  const paths: Record<string, string> = {};
  for (const file of TRANSCRIPTION_WASM_FILES) {
    const url = `${TRANSCRIPTION_WASM_BASE_PATH}${file}`;
    const asset = await readAsset(url);
    if (asset) {
      await touchAsset(asset);
      paths[file] = URL.createObjectURL(asset.blob);
    }
  }
  return paths;
}
