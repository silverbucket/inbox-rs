import { describe, expect, it } from 'vitest';
import { cleanForStorage } from './clean-for-storage';

describe('cleanForStorage', () => {
  it('returns a deep clone — mutating the result does not affect the input', () => {
    const input = { a: { b: 1 } };
    const result = cleanForStorage(input);

    result.a.b = 99;

    expect(input.a.b).toBe(1);
  });

  it('result is not the same reference as the input for nested objects', () => {
    const input = { nested: { x: 1 } };
    const result = cleanForStorage(input);

    expect(result).not.toBe(input);
    expect(result.nested).not.toBe(input.nested);
  });

  it('strips top-level undefined properties', () => {
    const input = { keep: 'yes', drop: undefined };
    const result = cleanForStorage(input);

    expect(result).toEqual({ keep: 'yes' });
    expect('drop' in result).toBe(false);
  });

  it('strips nested undefined properties', () => {
    const input = { outer: { keep: 42, drop: undefined } };
    const result = cleanForStorage(input);

    expect(result).toEqual({ outer: { keep: 42 } });
    expect('drop' in result.outer).toBe(false);
  });

  it('strips undefined properties at multiple nesting levels', () => {
    const input = {
      a: undefined,
      b: {
        c: undefined,
        d: {
          e: undefined,
          f: 'value',
        },
      },
    };
    const result = cleanForStorage(input);

    expect(result).toEqual({ b: { d: { f: 'value' } } });
  });

  it('documents JSON.stringify behaviour: undefined array elements become null', () => {
    // JSON.stringify converts undefined inside arrays to null so that array
    // indices are preserved. cleanForStorage reflects this behaviour exactly.
    const input = { arr: [1, undefined, 3] };
    const result = cleanForStorage(input);

    expect(result.arr).toEqual([1, null, 3]);
  });

  it('preserves nested objects faithfully', () => {
    const input = {
      id: 'item-1',
      meta: { createdAt: '2026-04-01T00:00:00.000Z', count: 7 },
    };
    const result = cleanForStorage(input);

    expect(result).toEqual(input);
  });

  it('preserves nested arrays faithfully', () => {
    const input = { tags: ['alpha', 'beta', 'gamma'], counts: [1, 2, 3] };
    const result = cleanForStorage(input);

    expect(result).toEqual(input);
  });

  it('preserves primitive values: strings, numbers, booleans, null', () => {
    const input = {
      str: 'hello',
      num: 42,
      float: 3.14,
      bool: true,
      nothing: null,
    };
    const result = cleanForStorage(input);

    expect(result).toEqual(input);
  });

  it('handles an empty object', () => {
    const result = cleanForStorage({});

    expect(result).toEqual({});
  });

  it('handles a string primitive passed directly', () => {
    const result = cleanForStorage('hello');

    expect(result).toBe('hello');
  });

  it('handles a number primitive passed directly', () => {
    const result = cleanForStorage(42);

    expect(result).toBe(42);
  });

  it('handles a boolean primitive passed directly', () => {
    expect(cleanForStorage(true)).toBe(true);
    expect(cleanForStorage(false)).toBe(false);
  });

  it('handles null passed directly', () => {
    const result = cleanForStorage(null);

    expect(result).toBeNull();
  });

  it('handles deeply nested arrays of objects, stripping undefined inside each', () => {
    const input = {
      items: [
        { id: '1', label: 'one', extra: undefined },
        { id: '2', label: 'two', extra: undefined },
      ],
    };
    const result = cleanForStorage(input);

    expect(result).toEqual({
      items: [
        { id: '1', label: 'one' },
        { id: '2', label: 'two' },
      ],
    });
  });
});
