/**
 * Client-side thumbnail generation for image captures.
 *
 * The inbox grid renders images into ~300px masonry columns, but cards were
 * decoding the full-resolution original. A downscaled JPEG stored alongside
 * the original (files/<id>.thumb.jpg) lets cards load a few tens of KB while
 * the lightbox still fetches the untouched original.
 *
 * Generation is strictly best-effort: any failure (unsupported codec like
 * HEIC in some browsers, missing canvas in odd environments, zero-byte input)
 * returns null and the caller stores the item without a thumbnail — every
 * consumer falls back to filePath, and items captured by clients that don't
 * generate thumbnails (extension, mobile, older versions) remain fully
 * supported.
 */

/** Longest edge of the generated thumbnail, in CSS pixels. */
export const THUMB_MAX_DIM = 640;

export const THUMB_MIME_TYPE = 'image/jpeg';

const THUMB_QUALITY = 0.82;

export interface ThumbnailResult {
  data: ArrayBuffer;
  mimeType: string;
}

/**
 * Downscale an image blob to at most {@link THUMB_MAX_DIM} on its longest
 * edge. Returns null when the source is already small enough (callers should
 * just use the original) or when generation fails for any reason.
 */
export async function generateThumbnail(
  source: Blob,
): Promise<ThumbnailResult | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    return null; // undecodable in this browser — store without a thumb
  }
  try {
    const { width, height } = bitmap;
    if (width <= THUMB_MAX_DIM && height <= THUMB_MAX_DIM) {
      // Original is thumbnail-sized already; a second copy buys nothing.
      return null;
    }
    const scale = THUMB_MAX_DIM / Math.max(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const blob = await drawToJpeg(bitmap, w, h);
    if (!blob) return null;
    return { data: await blob.arrayBuffer(), mimeType: THUMB_MIME_TYPE };
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

async function drawToJpeg(
  bitmap: ImageBitmap,
  w: number,
  h: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.convertToBlob({
      type: THUMB_MIME_TYPE,
      quality: THUMB_QUALITY,
    });
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) =>
    canvas.toBlob(resolve, THUMB_MIME_TYPE, THUMB_QUALITY),
  );
}
