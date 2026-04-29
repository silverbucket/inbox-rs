/**
 * Recovery shims for files written by the v1.8-and-earlier web store path.
 *
 * That path converted an `ArrayBuffer` to a binary string with
 * `String.fromCharCode(byte)` per byte, then handed the string to
 * `storeFile`. Two on-disk shapes can result:
 *
 *   1. Locally cached files come back as a binary string from
 *      `privateClient.getFile()` — the IndexedDB cache stored exactly what
 *      was passed in. Inverse: read each char's low byte.
 *   2. Server-stored files were UTF-8-encoded by the sync layer's
 *      `fetch(..., { body: string })` (any byte > 0x7F became a 2-byte
 *      0xC2/0xC3 + continuation pair). Inverse: UTF-8-decode back to the
 *      binary string, then read each char's low byte.
 *
 * Both shims are no-ops for correctly-uploaded files, so they're safe to
 * apply unconditionally on read.
 */

/**
 * Convert a binary string (each char's low byte = one file byte) to an
 * `ArrayBuffer`. The inverse of `String.fromCharCode(byte)` per byte.
 *
 * Used when `privateClient.getFile()` returns the locally-cached body of a
 * legacy-written file as a string.
 */
export function legacyBinaryStringToArrayBuffer(str: string): ArrayBuffer {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Recover the original bytes of a file whose body was UTF-8-encoded by the
 * legacy sync-layer upload (binary string → `fetch(..., { body: string })`).
 *
 * Detection is structural rather than per-format:
 *
 *   - Real binary files (JPEG/PNG/etc.) almost always contain byte sequences
 *     that aren't valid UTF-8 (e.g. a lone 0xFF, which UTF-8 reserves as a
 *     never-valid lead byte). `TextDecoder({fatal:true})` throws on those,
 *     so we fall through and return the bytes unchanged.
 *   - Bytes that *do* decode as valid UTF-8 *and* whose every code point is
 *     < 256 can only have come from the binary-string-then-UTF-8 path —
 *     normal text with extended characters would produce code points >= 256
 *     for any non-Latin1 char, and arbitrary binary almost never round-trips
 *     through UTF-8 cleanly. So in practice this only fires on the legacy
 *     corruption pattern.
 *
 * Files that are already in the correct format pass through untouched
 * because of the throw on the first invalid byte. Returns the original
 * `ArrayBuffer` reference (not a copy) in that case.
 */
export function recoverLegacyBinaryStringEncoding(
  buffer: ArrayBuffer,
): ArrayBuffer {
  if (buffer.byteLength === 0) return buffer;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    for (let i = 0; i < decoded.length; i++) {
      // If any code point is >= 256, this isn't a binary-string round-trip
      // (the legacy encoder only ever produced chars 0–255). Bail out.
      if (decoded.charCodeAt(i) >= 256) return buffer;
    }
    const recovered = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      recovered[i] = decoded.charCodeAt(i);
    }
    return recovered.buffer;
  } catch {
    // Invalid UTF-8 → already raw binary. Return as-is.
    return buffer;
  }
}
