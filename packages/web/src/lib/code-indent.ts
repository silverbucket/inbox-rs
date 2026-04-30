/** Pure string helpers for code-aware indentation in textareas. */

const INDENT = '  ';

export interface TextState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Check whether `pos` in `text` falls inside a fenced code block (``` ... ```). */
export function isInsideCodeBlock(text: string, pos: number): boolean {
  const before = text.slice(0, pos);
  const fenceMatches = before.match(/^```/gm);
  return !!fenceMatches && fenceMatches.length % 2 === 1;
}

/** Insert 2-space indent at cursor (no selection). */
export function insertIndent(state: TextState): TextState {
  const { value, selectionStart: start } = state;
  return {
    value: value.slice(0, start) + INDENT + value.slice(start),
    selectionStart: start + INDENT.length,
    selectionEnd: start + INDENT.length,
  };
}

/** Indent all lines that overlap the selection. */
export function indentSelection(state: TextState): TextState {
  const { value, selectionStart: start, selectionEnd: end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const block = value.slice(lineStart, end);
  const indented = block.replace(/^/gm, INDENT);
  const added = indented.length - block.length;
  return {
    value: value.slice(0, lineStart) + indented + value.slice(end),
    selectionStart: start + INDENT.length,
    selectionEnd: end + added,
  };
}

/** Dedent all lines that overlap the selection (remove up to 2 leading spaces). */
export function dedentSelection(state: TextState): TextState {
  const { value, selectionStart: start, selectionEnd: end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const block = value.slice(lineStart, end);
  const dedented = block.replace(/^ {2}/gm, '');

  // How many chars were removed before the original selectionStart?
  const prefixBefore = block.slice(0, start - lineStart);
  const prefixRemoved =
    prefixBefore.length - prefixBefore.replace(/^ {2}/gm, '').length;
  const totalRemoved = block.length - dedented.length;

  return {
    value: value.slice(0, lineStart) + dedented + value.slice(end),
    selectionStart: start - prefixRemoved,
    selectionEnd: end - totalRemoved,
  };
}

/** Insert a newline preserving the current line's leading whitespace. */
export function insertNewlineWithIndent(state: TextState): TextState {
  const { value, selectionStart: start, selectionEnd: end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(lineStart, start);
  const match = line.match(/^(\s*)/);
  const leadingWhitespace = match ? match[1] : '';
  const insertion = `\n${leadingWhitespace}`;
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    selectionStart: start + insertion.length,
    selectionEnd: start + insertion.length,
  };
}

/** Whether the cursor is on a closing fence line (``` with optional whitespace). */
export function isOnClosingFence(
  value: string,
  selectionStart: number,
): boolean {
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const line = value.slice(lineStart, selectionStart);
  return /^\s*```\s*$/.test(line);
}
