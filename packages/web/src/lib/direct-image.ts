const MAX_DIRECT_IMAGE_BYTES = 25 * 1024 * 1024;
const DIRECT_IMAGE_TIMEOUT_MS = 20_000;
const IMAGE_PATH_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

/**
 * Download a direct-image URL for local-first storage. New captures use the
 * pathname as a cheap candidate filter; callers checking an existing bookmark
 * can opt out so extensionless image URLs are identified by Content-Type.
 */
export async function downloadDirectImage(
  url: string,
  requireImagePath = true,
): Promise<File | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (requireImagePath && !IMAGE_PATH_PATTERN.test(parsed.pathname))
    return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECT_IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const mimeType = response.headers
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase();
    if (!mimeType?.startsWith('image/')) return null;

    const length = response.headers.get('content-length')?.trim();
    if (
      length &&
      /^\d+$/.test(length) &&
      Number(length) > MAX_DIRECT_IMAGE_BYTES
    ) {
      return null;
    }

    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let receivedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_DIRECT_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
    }
    const blob = new Blob(chunks, { type: mimeType });
    const encodedName = parsed.pathname.split('/').pop() || 'image';
    let filename = encodedName;
    try {
      filename = decodeURIComponent(encodedName);
    } catch {
      // Keep the encoded URL segment when it contains malformed escapes.
    }
    return new File([blob], filename, { type: mimeType });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
