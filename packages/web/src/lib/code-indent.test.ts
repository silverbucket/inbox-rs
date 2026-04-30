// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyTextState,
  createCodeKeydownHandler,
  dedentSelection,
  indentSelection,
  insertIndent,
  insertNewlineWithIndent,
  isInsideCodeBlock,
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
    const result = insertIndent({
      value: 'hello',
      selectionStart: 2,
      selectionEnd: 2,
    });
    expect(result.value).toBe('he  llo');
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(4);
  });

  it('inserts at the start of the string', () => {
    const result = insertIndent({
      value: 'abc',
      selectionStart: 0,
      selectionEnd: 0,
    });
    expect(result.value).toBe('  abc');
    expect(result.selectionStart).toBe(2);
  });

  it('inserts at the end of the string', () => {
    const result = insertIndent({
      value: 'abc',
      selectionStart: 3,
      selectionEnd: 3,
    });
    expect(result.value).toBe('abc  ');
    expect(result.selectionStart).toBe(5);
  });
});

describe('indentSelection', () => {
  it('indents all lines in selection', () => {
    const value = 'line1\nline2\nline3';
    const result = indentSelection({
      value,
      selectionStart: 0,
      selectionEnd: value.length,
    });
    expect(result.value).toBe('  line1\n  line2\n  line3');
  });

  it('indents partial selection starting mid-line', () => {
    const value = 'aaa\nbbb\nccc';
    // Selection starts inside "aaa", so the whole first line gets indented
    const result = indentSelection({
      value,
      selectionStart: 1,
      selectionEnd: 9,
    });
    expect(result.value).toBe('  aaa\n  bbb\n  ccc');
    expect(result.selectionStart).toBe(3); // 1 + 2
  });

  it('handles single line selection', () => {
    const value = 'only';
    const result = indentSelection({
      value,
      selectionStart: 0,
      selectionEnd: 4,
    });
    expect(result.value).toBe('  only');
  });
});

describe('dedentSelection', () => {
  it('removes 2 leading spaces from all lines', () => {
    const value = '  line1\n  line2';
    const result = dedentSelection({
      value,
      selectionStart: 0,
      selectionEnd: value.length,
    });
    expect(result.value).toBe('line1\nline2');
  });

  it('does nothing when lines have no leading spaces', () => {
    const value = 'line1\nline2';
    const result = dedentSelection({
      value,
      selectionStart: 0,
      selectionEnd: value.length,
    });
    expect(result.value).toBe('line1\nline2');
    expect(result.selectionStart).toBe(0);
  });

  it('only removes 2 spaces, not more', () => {
    const value = '    deep';
    const result = dedentSelection({
      value,
      selectionStart: 0,
      selectionEnd: value.length,
    });
    expect(result.value).toBe('  deep');
  });

  it('adjusts selectionStart when spaces are removed before cursor', () => {
    const value = '  indented';
    const result = dedentSelection({
      value,
      selectionStart: 4,
      selectionEnd: value.length,
    });
    expect(result.selectionStart).toBe(2); // moved left by 2
  });

  it('handles line with fewer than 2 leading spaces', () => {
    const value = ' one\n  two';
    const result = dedentSelection({
      value,
      selectionStart: 0,
      selectionEnd: value.length,
    });
    // Only the line with exactly 2+ leading spaces gets dedented
    expect(result.value).toBe(' one\ntwo');
  });
});

describe('insertNewlineWithIndent', () => {
  it('preserves leading whitespace on new line', () => {
    const value = '  indented code';
    const result = insertNewlineWithIndent({
      value,
      selectionStart: value.length,
      selectionEnd: value.length,
    });
    expect(result.value).toBe('  indented code\n  ');
    expect(result.selectionStart).toBe(value.length + 3); // \n + 2 spaces
  });

  it('inserts plain newline when no leading whitespace', () => {
    const value = 'no indent';
    const result = insertNewlineWithIndent({
      value,
      selectionStart: value.length,
      selectionEnd: value.length,
    });
    expect(result.value).toBe('no indent\n');
    expect(result.selectionStart).toBe(value.length + 1);
  });

  it('replaces selected text with newline', () => {
    const value = 'hello world';
    const result = insertNewlineWithIndent({
      value,
      selectionStart: 5,
      selectionEnd: 11,
    });
    expect(result.value).toBe('hello\n');
  });

  it('works at the start of a line after a newline', () => {
    const value = 'line1\n    line2';
    const pos = value.length;
    const result = insertNewlineWithIndent({
      value,
      selectionStart: pos,
      selectionEnd: pos,
    });
    expect(result.value).toBe('line1\n    line2\n    ');
  });

  it('handles cursor at position 0', () => {
    const value = 'text';
    const result = insertNewlineWithIndent({
      value,
      selectionStart: 0,
      selectionEnd: 0,
    });
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

/**
 * Test helpers for the textarea handler. We construct a real textarea
 * (jsdom env), populate it with `value`, place the cursor with
 * `setSelectionRange`, then dispatch a synthetic KeyboardEvent through the
 * handler. We don't actually mount it in a document because the handler
 * only reads `currentTarget` from the event.
 */
function makeTextarea(
  value: string,
  selectionStart: number,
  selectionEnd: number = selectionStart,
): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setSelectionRange(selectionStart, selectionEnd);
  return ta;
}

function makeKeyEvent(
  ta: HTMLTextAreaElement,
  init: KeyboardEventInit & { key: string },
): KeyboardEvent & { _defaultPrevented: boolean } {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init });
  // jsdom's KeyboardEvent doesn't have a writable `currentTarget`. Define
  // it via Object.defineProperty so the handler can read it.
  Object.defineProperty(event, 'currentTarget', {
    value: ta,
    enumerable: true,
  });
  // Track preventDefault for assertions without losing the original side
  // effect. We splice a flag onto the event itself.
  let prevented = false;
  const originalPreventDefault = event.preventDefault.bind(event);
  event.preventDefault = () => {
    prevented = true;
    originalPreventDefault();
  };
  Object.defineProperty(event, '_defaultPrevented', {
    get: () => prevented,
  });
  return event as KeyboardEvent & { _defaultPrevented: boolean };
}

describe('applyTextState', () => {
  it('writes the new value through setRangeText and fires an input event', () => {
    const ta = makeTextarea('original', 0);
    let inputFired = false;
    ta.addEventListener('input', () => {
      inputFired = true;
    });

    applyTextState(ta, {
      value: 'replaced',
      selectionStart: 4,
      selectionEnd: 4,
    });

    expect(ta.value).toBe('replaced');
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(4);
    expect(inputFired).toBe(true);
  });
});

describe('createCodeKeydownHandler — Tab inside a code block', () => {
  it('inserts a 2-space indent on Tab with no selection', () => {
    const handler = createCodeKeydownHandler();
    // Cursor sits inside a fenced block — `isInsideCodeBlock` returns true
    // because we're past an unclosed opening fence.
    const ta = makeTextarea('```\nfoo', 7);
    const e = makeKeyEvent(ta, { key: 'Tab' });

    handler(e);

    expect(e._defaultPrevented).toBe(true);
    expect(ta.value).toBe('```\nfoo  ');
  });

  it('indents all lines that overlap the selection', () => {
    const handler = createCodeKeydownHandler();
    const ta = makeTextarea('```\nline1\nline2', 4, 15);
    const e = makeKeyEvent(ta, { key: 'Tab' });

    handler(e);

    expect(ta.value).toBe('```\n  line1\n  line2');
  });

  it('dedents all selected lines on Shift+Tab', () => {
    const handler = createCodeKeydownHandler();
    const ta = makeTextarea('```\n  line1\n  line2', 4, 19);
    const e = makeKeyEvent(ta, { key: 'Tab', shiftKey: true });

    handler(e);

    expect(ta.value).toBe('```\nline1\nline2');
  });

  it('does nothing on Tab outside a code block', () => {
    const handler = createCodeKeydownHandler();
    // No fences anywhere → handler defers to the browser's native Tab
    // behaviour (focus next element).
    const ta = makeTextarea('plain text', 5);
    const e = makeKeyEvent(ta, { key: 'Tab' });

    handler(e);

    expect(e._defaultPrevented).toBe(false);
    expect(ta.value).toBe('plain text');
  });
});

describe('createCodeKeydownHandler — Enter behaviour', () => {
  it('preserves leading whitespace inside a code block', () => {
    const handler = createCodeKeydownHandler();
    const ta = makeTextarea('```\n    indented', 16);
    const e = makeKeyEvent(ta, { key: 'Enter' });

    handler(e);

    expect(e._defaultPrevented).toBe(true);
    expect(ta.value).toBe('```\n    indented\n    ');
  });

  it('lets Enter pass through on a closing fence so the fence stays on its own line', () => {
    const handler = createCodeKeydownHandler();
    const ta = makeTextarea('```\nbody\n```', 12);
    const e = makeKeyEvent(ta, { key: 'Enter' });

    handler(e);

    // Handler returns without preventDefault so the browser/Svelte input
    // bind handles the newline as usual. (We can't assert text changes
    // here because we never dispatched a text-mutating event — the
    // assertion is just that we didn't intercept the key.)
    expect(e._defaultPrevented).toBe(false);
  });
});

describe('createCodeKeydownHandler — Tab trap state machine', () => {
  it('Escape unlatches the Tab trap so the next Tab moves focus', () => {
    const handler = createCodeKeydownHandler();
    const ta = makeTextarea('```\nfoo', 7);

    handler(makeKeyEvent(ta, { key: 'Escape' }));

    const tabEvent = makeKeyEvent(ta, { key: 'Tab' });
    handler(tabEvent);

    expect(tabEvent._defaultPrevented).toBe(false);
    expect(ta.value).toBe('```\nfoo');
  });

  it('typing a regular key after Escape re-arms the Tab trap', () => {
    const handler = createCodeKeydownHandler();
    const ta = makeTextarea('```\nfoo', 7);

    handler(makeKeyEvent(ta, { key: 'Escape' }));
    // A regular character-producing key signals "user is editing again",
    // which means the next Tab should indent rather than escape focus.
    handler(makeKeyEvent(ta, { key: 'a' }));

    const tabEvent = makeKeyEvent(ta, { key: 'Tab' });
    handler(tabEvent);

    expect(tabEvent._defaultPrevented).toBe(true);
    expect(ta.value).toBe('```\nfoo  ');
  });

  it('modifier-only key presses do not re-arm the Tab trap', () => {
    const handler = createCodeKeydownHandler();
    const ta = makeTextarea('```\nfoo', 7);

    handler(makeKeyEvent(ta, { key: 'Escape' }));
    // Plain modifier keys (Shift/Alt/Ctrl/Meta) shouldn't re-arm the trap
    // — otherwise holding Shift to extend a selection would re-trap Tab.
    handler(makeKeyEvent(ta, { key: 'Shift' }));

    const tabEvent = makeKeyEvent(ta, { key: 'Tab' });
    handler(tabEvent);

    expect(tabEvent._defaultPrevented).toBe(false);
    expect(ta.value).toBe('```\nfoo');
  });

  it('returns an independent handler per call', () => {
    // Two textareas, each with their own escape state. Escaping one
    // shouldn't unlatch the other — that's the whole point of the
    // factory returning a fresh closure each time.
    const handlerA = createCodeKeydownHandler();
    const handlerB = createCodeKeydownHandler();
    const taA = makeTextarea('```\nfoo', 7);
    const taB = makeTextarea('```\nbar', 7);

    handlerA(makeKeyEvent(taA, { key: 'Escape' }));

    const tabA = makeKeyEvent(taA, { key: 'Tab' });
    const tabB = makeKeyEvent(taB, { key: 'Tab' });
    handlerA(tabA);
    handlerB(tabB);

    expect(tabA._defaultPrevented).toBe(false);
    expect(tabB._defaultPrevented).toBe(true);
  });
});

describe('createCodeKeydownHandler — alwaysActive', () => {
  it('indents on Tab even outside a fenced block when alwaysActive is set', () => {
    const handler = createCodeKeydownHandler({ alwaysActive: true });
    // Use a string with no space at the cursor so the assertion is
    // unambiguous: 2 inserted spaces, no pre-existing space adjacency.
    const ta = makeTextarea('plaintext', 5);
    const e = makeKeyEvent(ta, { key: 'Tab' });

    handler(e);

    expect(e._defaultPrevented).toBe(true);
    expect(ta.value).toBe('plain  text');
  });

  it('keeps preserving indentation on Enter even on closing-fence-shaped content', () => {
    // With alwaysActive, the closing-fence escape hatch is bypassed —
    // the entire textarea is treated as code, so Enter always preserves
    // leading whitespace.
    const handler = createCodeKeydownHandler({ alwaysActive: true });
    const ta = makeTextarea('```', 3);
    const e = makeKeyEvent(ta, { key: 'Enter' });

    handler(e);

    expect(e._defaultPrevented).toBe(true);
    expect(ta.value).toBe('```\n');
  });
});
