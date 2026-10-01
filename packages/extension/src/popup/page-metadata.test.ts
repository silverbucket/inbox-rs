import type { LinkMetadata, UserSettings } from '@inbox-rs/rs-module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPageMetadataForSave } from './page-metadata';

function reader(settings: UserSettings = {}) {
  return { getUserSettings: vi.fn().mockResolvedValue(settings) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchPageMetadataForSave', () => {
  it('uses the built-in relay and removes credentials and fragments', async () => {
    const fetcher = vi.fn().mockResolvedValue({ title: 'Example' });

    await expect(
      fetchPageMetadataForSave(
        reader({ sockethubUrl: 'https://synced-relay.example/actions' }),
        'https://user:secret@example.com/post?q=1#access-token',
        fetcher,
      ),
    ).resolves.toEqual({ title: 'Example' });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.com/post?q=1');
    expect(fetcher.mock.calls[0]?.[1]).toBe(
      'https://sockethub.silverbucket.net/sockethub-http',
    );
  });

  it.each([
    'file:///Users/me/private.html',
    'chrome://settings',
    'not a url',
  ])('does not relay a non-HTTP page URL: %s', async (url) => {
    const settingsReader = reader();
    const fetcher = vi.fn();

    await expect(
      fetchPageMetadataForSave(settingsReader, url, fetcher),
    ).resolves.toBeNull();
    expect(settingsReader.getUserSettings).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when settings cannot be read', async () => {
    const settingsReader = {
      getUserSettings: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const fetcher = vi.fn();

    await expect(
      fetchPageMetadataForSave(settingsReader, 'https://example.com', fetcher),
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('honors the link-preview opt-out', async () => {
    const fetcher = vi.fn();

    await expect(
      fetchPageMetadataForSave(
        reader({ linkPreviews: false }),
        'https://example.com',
        fetcher,
      ),
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops waiting and never starts metadata after a slow settings read', async () => {
    vi.useFakeTimers();
    let resolveSettings: ((settings: UserSettings) => void) | undefined;
    const settingsReader = {
      getUserSettings: vi.fn(
        () =>
          new Promise<UserSettings>((resolve) => {
            resolveSettings = resolve;
          }),
      ),
    };
    const fetcher = vi.fn();
    const result = fetchPageMetadataForSave(
      settingsReader,
      'https://example.com',
      fetcher,
    );

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(result).resolves.toBeNull();
    resolveSettings?.({});
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('aborts a metadata request when the save-time budget expires', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn(
      (_url: string, _endpoint: string, signal?: AbortSignal) => {
        requestSignal = signal;
        return new Promise<LinkMetadata | null>(() => {});
      },
    );
    const result = fetchPageMetadataForSave(
      reader(),
      'https://example.com',
      fetcher,
    );

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(result).resolves.toBeNull();
    expect(requestSignal?.aborted).toBe(true);
  });
});
