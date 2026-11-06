import { get, writable } from 'svelte/store';
import { browserOnline } from './stores';
import {
  deleteTranscriptionAssets,
  downloadTranscriptionAssets,
  formatTranscriptionAssetBytes,
  getTranscriptionAssetStatus,
  TRANSCRIPTION_ASSETS,
  type TranscriptionAssetStatus,
} from './transcription-assets';

/**
 * App-wide view of the offline transcription model: whether it is cached,
 * whether a download is running, and the user's preference for keeping it.
 *
 * The model is downloaded automatically in the background once the app is
 * idle and online (see `scheduleAutoTranscriptionDownload`). That keeps the
 * first transcription fast without asking the user a storage question during
 * onboarding. A single switch in Settings reflects status and lets them opt
 * out, which also removes the cached files.
 */

export const OFFLINE_TRANSCRIPTION_KEY = 'inbox-rs:offline-transcription';

export const TRANSCRIPTION_MODEL_TOTAL_BYTES = TRANSCRIPTION_ASSETS.reduce(
  (sum, asset) => sum + asset.size,
  0,
);
export const TRANSCRIPTION_MODEL_SIZE_LABEL = formatTranscriptionAssetBytes(
  TRANSCRIPTION_MODEL_TOTAL_BYTES,
);

export type TranscriptionModelState = {
  /** All model and runtime files are cached locally. */
  ready: boolean;
  /** A background or manual download is in progress. */
  downloading: boolean;
  /** 0-100 while downloading. */
  percent: number;
  /** Last download failure, in user-facing words. Empty when none. */
  error: string;
  /** False until the first status check completes. */
  checked: boolean;
};

export const transcriptionModel = writable<TranscriptionModelState>({
  ready: false,
  downloading: false,
  percent: 0,
  error: '',
  checked: false,
});

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the preference just doesn't persist
  }
}

/** On unless the user turned it off in Settings. */
export const offlineTranscriptionEnabled = writable(
  readLocal(OFFLINE_TRANSCRIPTION_KEY) !== 'false',
);

function percentOf(status: TranscriptionAssetStatus): number {
  return status.totalBytes > 0
    ? Math.round((status.storedBytes / status.totalBytes) * 100)
    : 0;
}

export async function refreshTranscriptionModelStatus(): Promise<void> {
  const status = await getTranscriptionAssetStatus();
  transcriptionModel.update((s) => ({
    ...s,
    ready: status.ready,
    percent: s.downloading ? s.percent : percentOf(status),
    checked: true,
  }));
}

let inFlight: Promise<void> | null = null;

/** Download the model into the local cache, reporting progress via the store. */
export function downloadTranscriptionModel(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    transcriptionModel.update((s) => ({
      ...s,
      downloading: true,
      error: '',
    }));
    try {
      const status = await downloadTranscriptionAssets((progress) => {
        transcriptionModel.update((s) => ({
          ...s,
          percent: percentOf(progress),
        }));
      });
      transcriptionModel.update((s) => ({
        ...s,
        ready: status.ready,
        percent: percentOf(status),
        downloading: false,
        checked: true,
      }));
    } catch (e) {
      transcriptionModel.update((s) => ({
        ...s,
        downloading: false,
        error: describeDownloadError(e),
      }));
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function describeDownloadError(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  if (/enough browser storage/i.test(message)) {
    return `Not enough browser storage. The model needs ${TRANSCRIPTION_MODEL_SIZE_LABEL}.`;
  }
  if (/not available here/i.test(message)) {
    return 'Offline storage is not available in this browser.';
  }
  return "Couldn't download the model. It will retry next time you're online.";
}

/** Flip the Settings switch. Turning it off removes the cached model. */
export async function setOfflineTranscriptionEnabled(enabled: boolean) {
  offlineTranscriptionEnabled.set(enabled);
  writeLocal(OFFLINE_TRANSCRIPTION_KEY, enabled ? 'true' : 'false');
  if (enabled) {
    await downloadTranscriptionModel();
  } else {
    await deleteTranscriptionAssets();
    transcriptionModel.update((s) => ({
      ...s,
      ready: false,
      percent: 0,
      error: '',
    }));
  }
}

type ConnectionInfo = { saveData?: boolean };

/** True when the browser reports a data-saver or metered preference. */
export function connectionPrefersSavingData(nav: Navigator = navigator) {
  const conn = (nav as Navigator & { connection?: ConnectionInfo }).connection;
  return conn?.saveData === true;
}

/**
 * Decide whether an automatic download should start now. Pure so it can be
 * tested without a browser: the caller passes the current conditions.
 */
export function shouldAutoDownload(conditions: {
  enabled: boolean;
  online: boolean;
  saveData: boolean;
  ready: boolean;
  downloading: boolean;
}): boolean {
  return (
    conditions.enabled &&
    conditions.online &&
    !conditions.saveData &&
    !conditions.ready &&
    !conditions.downloading
  );
}

function whenIdle(run: () => void) {
  const w = window as Window & {
    requestIdleCallback?: (
      cb: () => void,
      opts?: { timeout: number },
    ) => number;
  };
  if (w.requestIdleCallback) {
    w.requestIdleCallback(run, { timeout: 10_000 });
  } else {
    setTimeout(run, 3_000);
  }
}

let scheduled = false;

/**
 * Kick off the background download once the app has settled. Never blocks
 * app start: it waits for an idle slot, and the download itself streams into
 * IndexedDB without touching the UI. Re-runs when the browser comes back
 * online so a session that started offline still picks the model up.
 */
export function scheduleAutoTranscriptionDownload(): void {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;

  const attempt = () => {
    void refreshTranscriptionModelStatus().then(() => {
      const model = get(transcriptionModel);
      if (
        shouldAutoDownload({
          enabled: get(offlineTranscriptionEnabled),
          online: get(browserOnline),
          saveData: connectionPrefersSavingData(),
          ready: model.ready,
          downloading: model.downloading,
        })
      ) {
        void downloadTranscriptionModel();
      }
    });
  };

  whenIdle(attempt);
  window.addEventListener('online', () => whenIdle(attempt));
}

/** One line for Settings describing where the model stands. */
export function summariseTranscriptionModel(
  model: TranscriptionModelState,
  enabled: boolean,
  online: boolean,
): string {
  if (model.error) return model.error;
  if (model.downloading) return `Downloading ${model.percent}%`;
  if (model.ready)
    return `Saved for offline use (${TRANSCRIPTION_MODEL_SIZE_LABEL}).`;
  if (!enabled)
    return `Downloads the ${TRANSCRIPTION_MODEL_SIZE_LABEL} model the first time you transcribe.`;
  if (!online)
    return `Will download (${TRANSCRIPTION_MODEL_SIZE_LABEL}) when you're online.`;
  if (connectionPrefersSavingData()) {
    return `Data saver is on. Download (${TRANSCRIPTION_MODEL_SIZE_LABEL}) when you're ready.`;
  }
  return `Downloading soon (${TRANSCRIPTION_MODEL_SIZE_LABEL}).`;
}
