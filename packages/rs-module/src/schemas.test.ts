import { describe, expect, it } from 'vitest';
import { imageMetaSchema } from './schemas.js';

describe('imageMetaSchema', () => {
  it('requires a complete local source or a remote source URL', () => {
    expect(imageMetaSchema.anyOf).toEqual([
      { required: ['filePath', 'mimeType'] },
      { required: ['sourceUrl'] },
    ]);
    expect(imageMetaSchema.properties.filePath.minLength).toBe(1);
    expect(imageMetaSchema.properties.mimeType.minLength).toBe(1);
    expect(imageMetaSchema.properties.sourceUrl.minLength).toBe(1);
  });
});
