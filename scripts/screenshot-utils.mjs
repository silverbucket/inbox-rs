import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function assertPngSize(path, width = 1280, height = 800) {
  const png = readFileSync(path);
  assert(png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), width, `${path}: width`);
  assert.equal(png.readUInt32BE(20), height, `${path}: height`);
}
