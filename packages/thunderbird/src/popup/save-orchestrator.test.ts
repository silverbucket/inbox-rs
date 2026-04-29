import { DirectRS } from '@inbox-rs/rs-module';
import { describe, expect, it, vi } from 'vitest';
import { runSaveEmail } from './save-orchestrator';

/**
 * Build a `DirectRS` whose underlying fetch can be controlled per-test.
 * The orchestrator goes through `rs.store(item)` which performs a single PUT
 * to `/inbox/items/<id>`, so each fetchImpl mock is checked once.
 */
function makeRS(fetchImpl: ReturnType<typeof vi.fn>): DirectRS {
  return new DirectRS(
    {
      userAddress: 'alice@example.com',
      token: 'tok',
      href: 'https://storage.example.com',
    },
    fetchImpl as unknown as typeof fetch,
  );
}

const baseParams = {
  subject: 'Test subject',
  author: 'sender@example.com',
  bodyText: 'Hello world',
  notes: '',
  messageUrl: 'mid:abc-123',
  generateId: () => 'email-uuid-1',
  now: () => '2026-01-01T00:00:00.000Z',
};

describe('runSaveEmail', () => {
  it('returns ok:true and PUTs the item when rs.store succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as any);
    const rs = makeRS(fetchImpl);

    const result = await runSaveEmail({ rs, ...baseParams });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('/inbox/items/email-uuid-1');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      id: 'email-uuid-1',
      type: 'email',
      title: 'Test subject',
      body: 'Hello world',
      from: 'sender@example.com',
      messageUrl: 'mid:abc-123',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('falls back to "Untitled email" when subject is empty', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as any);
    const rs = makeRS(fetchImpl);

    await runSaveEmail({ rs, ...baseParams, subject: '' });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body.title).toBe('Untitled email');
  });

  it('omits optional fields when blank/whitespace', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as any);
    const rs = makeRS(fetchImpl);

    await runSaveEmail({
      rs,
      ...baseParams,
      author: '',
      notes: '   ',
      messageUrl: '',
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body.from).toBeUndefined();
    expect(body.notes).toBeUndefined();
    expect(body.messageUrl).toBeUndefined();
  });

  it('trims notes when present', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as any);
    const rs = makeRS(fetchImpl);

    await runSaveEmail({ rs, ...baseParams, notes: '  important context  ' });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body.notes).toBe('important context');
  });

  /**
   * REGRESSION: the popup used to call `await rs.store(item)` with no
   * try/catch. When the PUT failed (expired token, network error, missing
   * host_permissions blocking the request) the rejection propagated out of
   * the click handler, leaving `saving` stuck true and the popup hanging in
   * "Saving…" forever. The orchestrator MUST swallow these and return a
   * tagged failure so the popup can reset its state in `finally`.
   */
  it('returns ok:false with the error message when rs.store rejects (401 expired token)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401 } as any);
    const rs = makeRS(fetchImpl);

    const result = await runSaveEmail({ rs, ...baseParams });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });

  it('returns ok:false when fetch itself rejects (network failure / CORS block)', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        new TypeError('NetworkError when attempting to fetch resource.'),
      );
    const rs = makeRS(fetchImpl);

    const result = await runSaveEmail({ rs, ...baseParams });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/NetworkError/i);
  });

  it('returns a generic message when the rejection has no message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue('');
    const rs = makeRS(fetchImpl);

    const result = await runSaveEmail({ rs, ...baseParams });

    expect(result).toEqual({ ok: false, error: 'Save failed' });
  });

  it('never throws — even pathological rejections become tagged failures', async () => {
    // Real-world rejections we've seen: undefined, null, plain objects,
    // and weird Error subclasses. The orchestrator must handle them all
    // because the popup's UI promise depends on never seeing an exception.
    for (const reason of [undefined, null, { weird: 'shape' }, 42]) {
      const fetchImpl = vi.fn().mockRejectedValue(reason);
      const rs = makeRS(fetchImpl);
      // Must resolve, never throw.
      await expect(runSaveEmail({ rs, ...baseParams })).resolves.toMatchObject({
        ok: false,
      });
    }
  });
});
