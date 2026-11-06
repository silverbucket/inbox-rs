// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createDownloadProgressTracker,
  describeTranscriptionError,
} from './transcribe';
import {
  connectionPrefersSavingData,
  shouldAutoDownload,
} from './transcription-store';

describe('shouldAutoDownload', () => {
  const ok = {
    enabled: true,
    online: true,
    saveData: false,
    ready: false,
    downloading: false,
  };

  it('downloads when enabled, online, not saving data, and not yet cached', () => {
    expect(shouldAutoDownload(ok)).toBe(true);
  });

  it.each([
    ['the user switched it off', { enabled: false }],
    ['the browser is offline', { online: false }],
    ['the connection prefers saving data', { saveData: true }],
    ['the model is already cached', { ready: true }],
    ['a download is already running', { downloading: true }],
  ])('stays quiet when %s', (_label, override) => {
    expect(shouldAutoDownload({ ...ok, ...override })).toBe(false);
  });
});

describe('connectionPrefersSavingData', () => {
  it('reads the Network Information saveData flag when present', () => {
    expect(
      connectionPrefersSavingData({
        connection: { saveData: true },
      } as unknown as Navigator),
    ).toBe(true);
    expect(connectionPrefersSavingData({} as Navigator)).toBe(false);
  });
});

describe('describeTranscriptionError', () => {
  const online = { online: true, modelReady: true };

  it('names an undecodable audio format', () => {
    expect(
      describeTranscriptionError(
        new DOMException('x', 'EncodingError'),
        online,
      ),
    ).toMatch(/audio format/);
  });

  it('points at the download when offline without the model', () => {
    expect(
      describeTranscriptionError(new TypeError('Failed to fetch'), {
        online: false,
        modelReady: false,
      }),
    ).toMatch(/offline/);
  });

  it('blames the network for a fetch failure while online without the model', () => {
    expect(
      describeTranscriptionError(new TypeError('Failed to fetch'), {
        online: true,
        modelReady: false,
      }),
    ).toMatch(/download the transcription model/);
  });

  it('reports storage quota problems', () => {
    expect(
      describeTranscriptionError(
        new Error(
          'Not enough browser storage for offline transcription assets.',
        ),
        online,
      ),
    ).toMatch(/storage/);
  });

  it('falls back to a generic retry line', () => {
    expect(describeTranscriptionError(new Error('boom'), online)).toBe(
      'Transcription failed. Try again.',
    );
  });
});

describe('createDownloadProgressTracker', () => {
  it('sums per-file progress into one percentage', () => {
    const track = createDownloadProgressTracker();
    expect(track({ status: 'initiate', file: 'a' })).toBeNull();
    expect(
      track({ status: 'progress', file: 'a', loaded: 50, total: 100 }),
    ).toBe(50);
    expect(
      track({ status: 'progress', file: 'b', loaded: 0, total: 100 }),
    ).toBe(25);
    expect(track({ status: 'done', file: 'a' })).toBe(50);
    expect(
      track({ status: 'progress', file: 'b', loaded: 100, total: 100 }),
    ).toBe(100);
  });
});
