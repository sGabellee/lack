/**
 * src/editor/autopair-logic.js
 * Logic for custom LaTeX bracket pairing, backspace pair deletion,
 * and auto \end{env} insertion on Enter.
 */

// Pair definitions where cursor is in the middle: [left, right]
const PAIRS_1CHAR = [
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
  ['"', '"'],
  ['$', '$'],
  ['`', "'"]
];

const PAIRS_2CHAR = [
  ['\\(', '\\)'],
  ['\\[', '\\]']
];

/**
 * Checks if backspace at cursor position should delete an empty pair.
 * Returns { shouldDelete: true, from, to } or { shouldDelete: false }
 */
function checkBackspacePair(text, cursor) {
  if (cursor <= 0 || cursor > text.length) {
    return { shouldDelete: false };
  }

  // 1. Check 2-character pairs: \(|\), \[|\]
  if (cursor >= 2 && cursor <= text.length - 2) {
    const before2 = text.substring(cursor - 2, cursor);
    const after2 = text.substring(cursor, cursor + 2);
    for (const [left, right] of PAIRS_2CHAR) {
      if (before2 === left && after2 === right) {
        return {
          shouldDelete: true,
          from: cursor - 2,
          to: cursor + 2
        };
      }
    }
  }

  // 2. Check 1-character pairs: {|} [|] (|) $|$ `|'
  if (cursor >= 1 && cursor <= text.length - 1) {
    const before1 = text[cursor - 1];
    const after1 = text[cursor];
    for (const [left, right] of PAIRS_1CHAR) {
      if (before1 === left && after1 === right) {
        return {
          shouldDelete: true,
          from: cursor - 1,
          to: cursor + 1
        };
      }
    }
  }

  return { shouldDelete: false };
}

/**
 * Checks if pressing Enter after \begin{env} should auto-insert \end{env}.
 * Returns { shouldExpand: true, insertText, targetCursorOffset } or { shouldExpand: false }
 */
function checkBeginEnvEnter(lineText, colInLine) {
  const textBeforeCursor = lineText.substring(0, colInLine);
  const match = textBeforeCursor.match(/^(\s*)\\begin\{([a-zA-Z0-9*_-]+)\}\s*$/);
  if (!match) return { shouldExpand: false };

  const indent = match[1];
  const envName = match[2];

  // Insert newline with tab indent, plus \end{env}
  const bodyIndent = indent + '  ';
  const insertText = '\n' + bodyIndent + '\n' + indent + '\\end{' + envName + '}';
  const cursorOffset = 1 + bodyIndent.length;

  return {
    shouldExpand: true,
    envName: envName,
    insertText: insertText,
    cursorOffset: cursorOffset
  };
}

module.exports = {
  checkBackspacePair,
  checkBeginEnvEnter,
  PAIRS_1CHAR,
  PAIRS_2CHAR
};
