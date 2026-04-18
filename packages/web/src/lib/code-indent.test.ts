import { describe, it, expect } from 'vitest';
import {
  isInsideCodeBlock,
  insertIndent,
  indentSelection,
  dedentSelection,
  insertNewlineWithIndent,
  isOnClosingFence,
} from './code-indent';

describe('isInsideCodeBlock', () => {
  it('returns false when there are no fences', () => {
    expect(isInsideCodeBlock('hello world', 5)).toBe(false);
  });

  it('returns true after an opening fence', () => {
    const text = '```\nsome code';
    expect(isInsideCodeBlock(text, 10)).toBe(true);
  });

  it('returns false after a closing fence', () => {
    const text = '```\nsome code\n```\noutside';
    expect(isInsideCodeBlock(text, text.length)).toBe(false);
  });

  it('returns true inside a second code block', () => {
    const text = '```\nblock1\n```\n\n```\nblock2';
    expect(isInsideCodeBlock(text, text.length)).toBe(true);
  });

  it('ignores inline backticks (not at line start)', () => {
    const text = 'use `code` here';
    expect(isInsideCodeBlock(text, text.length)).toBe(false);
  });

  it('handles language hints like ```js', () => {
    const text = '```js\nconst x = 1;';
    expect(isInsideCodeBlock(text, text.length)).toBe(true);
  });

  it('returns false at position 0', () => {
    expect(isInsideCodeBlock('```\ncode', 0)).toBe(false);
  });

  it('returns false for triple backticks mid-line', () => {
    const text = 'some text ``` not a fence';
    expect(isInsideCodeBlock(text, text.length)).toBe(false);
  });
});

describe('insertIndent', () => {
  it('inserts 2 spaces at cursor', () => {
    const result = insertIndent({ value: 'hello', selectionStart: 2, selectionEnd: 2 });
    expect(result.value).toBe('he  llo');
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(4);
  });

  it('inserts at the start of the string', () => {
    const result = insertIndent({ value: 'abc', selectionStart: 0, selectionEnd: 0 });
    expect(result.value).toBe('  abc');
    expect(result.selectionStart).toBe(2);
  });

  it('inserts at the end of the string', () => {
    const result = insertIndent({ value: 'abc', selectionStart: 3, selectionEnd: 3 });
    expect(result.value).toBe('abc  ');
    expect(result.selectionStart).toBe(5);
  });
});

describe('indentSelection', () => {
  it('indents all lines in selection', () => {
    const value = 'line1\nline2\nline3';
    const result = indentSelection({ value, selectionStart: 0, selectionEnd: value.length });
    expect(result.value).toBe('  line1\n  line2\n  line3');
  });

  it('indents partial selection starting mid-line', () => {
    const value = 'aaa\nbbb\nccc';
    // Selection starts inside "aaa", so the whole first line gets indented
    const result = indentSelection({ value, selectionStart: 1, selectionEnd: 9 });
    expect(result.value).toBe('  aaa\n  bbb\n  ccc');
    expect(result.selectionStart).toBe(3); // 1 + 2
  });

  it('handles single line selection', () => {
    const value = 'only';
    const result = indentSelection({ value, selectionStart: 0, selectionEnd: 4 });
    expect(result.value).toBe('  only');
  });
});

describe('dedentSelection', () => {
  it('removes 2 leading spaces from all lines', () => {
    const value = '  line1\n  line2';
    const result = dedentSelection({ value, selectionStart: 0, selectionEnd: value.length });
    expect(result.value).toBe('line1\nline2');
  });

  it('does nothing when lines have no leading spaces', () => {
    const value = 'line1\nline2';
    const result = dedentSelection({ value, selectionStart: 0, selectionEnd: value.length });
    expect(result.value).toBe('line1\nline2');
    expect(result.selectionStart).toBe(0);
  });

  it('only removes 2 spaces, not more', () => {
    const value = '    deep';
    const result = dedentSelection({ value, selectionStart: 0, selectionEnd: value.length });
    expect(result.value).toBe('  deep');
  });

  it('adjusts selectionStart when spaces are removed before cursor', () => {
    const value = '  indented';
    const result = dedentSelection({ value, selectionStart: 4, selectionEnd: value.length });
    expect(result.selectionStart).toBe(2); // moved left by 2
  });

  it('handles line with fewer than 2 leading spaces', () => {
    const value = ' one\n  two';
    const result = dedentSelection({ value, selectionStart: 0, selectionEnd: value.length });
    // Only the line with exactly 2+ leading spaces gets dedented
    expect(result.value).toBe(' one\ntwo');
  });
});

describe('insertNewlineWithIndent', () => {
  it('preserves leading whitespace on new line', () => {
    const value = '  indented code';
    const result = insertNewlineWithIndent({ value, selectionStart: value.length, selectionEnd: value.length });
    expect(result.value).toBe('  indented code\n  ');
    expect(result.selectionStart).toBe(value.length + 3); // \n + 2 spaces
  });

  it('inserts plain newline when no leading whitespace', () => {
    const value = 'no indent';
    const result = insertNewlineWithIndent({ value, selectionStart: value.length, selectionEnd: value.length });
    expect(result.value).toBe('no indent\n');
    expect(result.selectionStart).toBe(value.length + 1);
  });

  it('replaces selected text with newline', () => {
    const value = 'hello world';
    const result = insertNewlineWithIndent({ value, selectionStart: 5, selectionEnd: 11 });
    expect(result.value).toBe('hello\n');
  });

  it('works at the start of a line after a newline', () => {
    const value = 'line1\n    line2';
    const pos = value.length;
    const result = insertNewlineWithIndent({ value, selectionStart: pos, selectionEnd: pos });
    expect(result.value).toBe('line1\n    line2\n    ');
  });

  it('handles cursor at position 0', () => {
    const value = 'text';
    const result = insertNewlineWithIndent({ value, selectionStart: 0, selectionEnd: 0 });
    expect(result.value).toBe('\ntext');
    expect(result.selectionStart).toBe(1);
  });
});

describe('isOnClosingFence', () => {
  it('returns true for ``` on its own line', () => {
    const value = '```js\ncode\n```';
    expect(isOnClosingFence(value, value.length)).toBe(true);
  });

  it('returns true for ``` with leading whitespace', () => {
    const value = 'code\n  ```';
    expect(isOnClosingFence(value, value.length)).toBe(true);
  });

  it('returns false for ``` with trailing text', () => {
    const value = '```js';
    expect(isOnClosingFence(value, value.length)).toBe(false);
  });

  it('returns false for non-fence line', () => {
    const value = 'just code';
    expect(isOnClosingFence(value, value.length)).toBe(false);
  });

  it('returns true for ``` with trailing whitespace', () => {
    const value = '```  ';
    expect(isOnClosingFence(value, value.length)).toBe(true);
  });
});
