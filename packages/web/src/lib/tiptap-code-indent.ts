/**
 * TipTap extension: auto-indent on Enter inside code blocks.
 *
 * When the user presses Enter inside a code block, this preserves the
 * leading whitespace from the current line on the new line.
 */
import { Extension } from '@tiptap/core';

export const CodeBlockAutoIndent = Extension.create({
  name: 'codeBlockAutoIndent',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;

        // Only act inside code blocks
        if ($from.parent.type.name !== 'codeBlock') {
          return false;
        }

        // Compute the current line's leading whitespace
        const codeBlockStart = $from.start();
        const textBefore = state.doc.textBetween(codeBlockStart, $from.pos, '\n', '\n');
        const lastNewline = textBefore.lastIndexOf('\n');
        const currentLine = lastNewline >= 0 ? textBefore.slice(lastNewline + 1) : textBefore;
        const match = currentLine.match(/^(\s*)/);
        const leadingWhitespace = match ? match[1] : '';

        const insertion = '\n' + leadingWhitespace;

        // Use a raw transaction to insert text directly into the code block.
        // insertContent goes through HTML parsing which doesn't handle
        // newlines in code blocks correctly.
        return editor.commands.command(({ tr }) => {
          const { from, to } = selection;
          tr.insertText(insertion, from, to);
          return true;
        });
      },
    };
  },
});
