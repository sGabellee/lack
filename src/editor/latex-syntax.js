/**
 * src/editor/latex-syntax.js
 * Custom StreamLanguage syntax tokenizer for LaTeX.
 * Replaces legacy stex mode with deterministic token classification:
 * - command: \name, \name*, control symbols, and delimiters { } [ ] $ &
 * - argument: content of [...] groups and name-like {...} arguments (packages, classes, labels, urls, etc.)
 * - math: content of math modes and environments (styled as argument)
 * - comment: % to end of line
 * - text: prose only (the only class checked by spellchecker)
 */

const { StreamLanguage } = require('@codemirror/language');
const { Tag, tags } = require('@lezer/highlight');

// Custom tags
const latexCommandTag = Tag.define();
const latexArgumentTag = Tag.define();
const latexMathTag = Tag.define();
const latexCommentTag = Tag.define();
const latexDelimiterTag = Tag.define();
const latexTextTag = Tag.define();

const NAME_LIKE_COMMANDS = new Set([
  'documentclass', 'usepackage', 'RequirePackage', 'begin', 'end',
  'pagestyle', 'thispagestyle', 'input', 'include', 'includegraphics',
  'bibliography', 'bibliographystyle', 'label', 'ref', 'eqref',
  'autoref', 'cref', 'Cref', 'pageref', 'cite', 'citep', 'citet',
  'url', 'hypersetup', 'geometry', 'definecolor', 'color', 'textcolor',
  'setlength', 'setcounter', 'graphicspath'
]);

const MATH_ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'multline*', 'split', 'cases', 'matrix', 'pmatrix',
  'bmatrix', 'vmatrix', 'Vmatrix', 'displaymath'
]);

const VERBATIM_ENVIRONMENTS = new Set([
  'verbatim', 'verbatim*', 'lstlisting', 'minted', 'filecontents', 'filecontents*'
]);

const CONTROL_SYMBOLS = new Set([
  '\\', '#', '$', '%', '&', '_', '{', '}',
  ',', ';', ':', '!', '@', '-', '/', ' ', '~', '^'
]);

const latexStreamParser = {
  name: 'latex',
  startState() {
    return {
      stack: [], // contexts: { type: 'bracket_arg' | 'brace_arg' }
      envStack: [], // active environments: [{ name, type: 'math' | 'verbatim' }]
      lastCommand: null,
      pendingNameArg: false,
      inMath: false // false, '$', '$$', '\\]', '\\)'
    };
  },
  token(stream, state) {
    // 1. Comments
    if (stream.peek() === '%') {
      stream.skipToEnd();
      return 'comment';
    }

    // Whitespace
    if (stream.eatSpace()) {
      return null;
    }

    // 2. Math mode delimiters
    if (stream.match('$$')) {
      if (state.inMath === '$$') {
        state.inMath = false;
      } else if (!state.inMath) {
        state.inMath = '$$';
      }
      return 'delimiter';
    }

    if (stream.match('\\[')) {
      state.inMath = '\\]';
      return 'command';
    }
    if (state.inMath === '\\]' && stream.match('\\]')) {
      state.inMath = false;
      return 'command';
    }

    if (stream.match('\\(')) {
      state.inMath = '\\)';
      return 'command';
    }
    if (state.inMath === '\\)' && stream.match('\\)')) {
      state.inMath = false;
      return 'command';
    }

    if (stream.match('$')) {
      if (state.inMath === '$') {
        state.inMath = false;
      } else if (!state.inMath) {
        state.inMath = '$';
      }
      return 'delimiter';
    }

    // If inside math mode and next is not a command, consume as math
    if (state.inMath && stream.peek() !== '\\') {
      stream.match(/^[^\\$%]+/);
      return 'math';
    }

    // 3. Commands and control symbols
    if (stream.peek() === '\\') {
      stream.next(); // eat backslash
      const nextChar = stream.peek();

      // Check control symbols
      if (CONTROL_SYMBOLS.has(nextChar)) {
        stream.next();
        return 'command';
      }

      // Check command name
      if (stream.match(/^[a-zA-Z@]+\*?/)) {
        const fullCmd = stream.current();
        const cmdName = fullCmd.slice(1).replace(/\*$/, '');

        if (NAME_LIKE_COMMANDS.has(cmdName)) {
          state.lastCommand = cmdName;
          state.pendingNameArg = true;
        } else {
          state.lastCommand = null;
          state.pendingNameArg = false;
        }
        return 'command';
      }

      return 'command';
    }

    const ch = stream.peek();

    // 4. Bracket arguments: [...]
    if (ch === '[') {
      stream.next();
      state.stack.push({ type: 'bracket_arg', depth: 1 });
      return 'delimiter';
    }
    if (ch === ']' && state.stack.length > 0 && state.stack[state.stack.length - 1].type === 'bracket_arg') {
      stream.next();
      state.stack.pop();
      return 'delimiter';
    }

    // 5. Brace arguments: {...}
    if (ch === '{') {
      stream.next();
      if (state.pendingNameArg) {
        state.stack.push({ type: 'brace_arg', depth: 1, cmd: state.lastCommand });
        if (state.lastCommand !== 'hypersetup' && state.lastCommand !== 'textcolor' && state.lastCommand !== 'colorbox') {
          state.pendingNameArg = false;
        }
      } else if (state.stack.length > 0 && state.stack[state.stack.length - 1].type === 'brace_arg') {
        state.stack[state.stack.length - 1].depth++;
      }
      return 'delimiter';
    }
    if (ch === '}') {
      stream.next();
      if (state.stack.length > 0 && state.stack[state.stack.length - 1].type === 'brace_arg') {
        const top = state.stack[state.stack.length - 1];
        top.depth--;
        if (top.depth <= 0) {
          state.stack.pop();
        }
      }
      return 'delimiter';
    }

    // 6. Check if currently inside bracket or brace argument
    const currentContext = state.stack.length > 0 ? state.stack[state.stack.length - 1] : null;
    if (currentContext && (currentContext.type === 'bracket_arg' || currentContext.type === 'brace_arg')) {
      const matchArg = stream.match(/^[^\\{}[\]%$,]+/);
      if (matchArg) {
        const textVal = matchArg[0].trim();
        if (currentContext.cmd === 'begin') {
          if (MATH_ENVIRONMENTS.has(textVal)) {
            state.envStack.push({ name: textVal, type: 'math' });
          } else if (VERBATIM_ENVIRONMENTS.has(textVal)) {
            state.envStack.push({ name: textVal, type: 'verbatim' });
          }
        } else if (currentContext.cmd === 'end') {
          if (state.envStack.length > 0 && state.envStack[state.envStack.length - 1].name === textVal) {
            state.envStack.pop();
          }
        }
        return 'argument';
      }
      if (stream.match(/^[,=]/)) {
        return 'argument';
      }
    }

    // 7. Check active environment body (math or verbatim)
    const currentEnv = state.envStack.length > 0 ? state.envStack[state.envStack.length - 1] : null;
    if (currentEnv && stream.peek() !== '\\') {
      stream.match(/^[^\\%]+/);
      return currentEnv.type === 'math' ? 'math' : 'argument';
    }

    // Delimiters
    if (ch === '&') {
      stream.next();
      return 'delimiter';
    }

    // 7. Regular prose text
    stream.match(/^[^\s\\{}[\]%$&]+/);
    return 'text';
  },
  tokenTable: {
    command: latexCommandTag,
    argument: latexArgumentTag,
    math: latexMathTag,
    delimiter: latexDelimiterTag,
    comment: latexCommentTag,
    text: latexTextTag
  }
};

const latexLanguage = StreamLanguage.define(latexStreamParser);

/**
 * Tokenize a LaTeX string into an array of tokens:
 * [{ text, type, from, to }]
 */
function tokenizeLatexStream(text) {
  const parser = latexStreamParser;
  const state = parser.startState();
  const tokens = [];

  class SimpleStringStream {
    constructor(str) {
      this.string = str;
      this.pos = 0;
      this.start = 0;
    }
    peek() { return this.string.charAt(this.pos) || null; }
    next() {
      if (this.pos < this.string.length) return this.string.charAt(this.pos++);
      return null;
    }
    eatSpace() {
      const s = this.pos;
      while (this.pos < this.string.length && /\s/.test(this.string.charAt(this.pos))) this.pos++;
      return this.pos > s;
    }
    match(pattern, consume = true) {
      if (typeof pattern === 'string') {
        if (this.string.startsWith(pattern, this.pos)) {
          if (consume) this.pos += pattern.length;
          return true;
        }
        return false;
      }
      const match = this.string.slice(this.pos).match(pattern);
      if (match && match.index === 0) {
        if (consume) this.pos += match[0].length;
        return match;
      }
      return false;
    }
    skipToEnd() { this.pos = this.string.length; }
    current() { return this.string.slice(this.start, this.pos); }
  }

  const lines = text.split('\n');
  let currentOffset = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const stream = new SimpleStringStream(line);

    while (stream.pos < stream.string.length) {
      stream.start = stream.pos;
      const type = parser.token(stream, state);
      const len = stream.pos - stream.start;
      if (type) {
        tokens.push({
          text: stream.current(),
          type: type,
          from: currentOffset + stream.start,
          to: currentOffset + stream.pos,
          line: lineNum + 1
        });
      }
    }
    currentOffset += line.length + 1; // +1 for newline
  }

  return tokens;
}

module.exports = {
  latexLanguage,
  latexStreamParser,
  tokenizeLatexStream,
  latexCommandTag,
  latexArgumentTag,
  latexMathTag,
  latexDelimiterTag,
  latexCommentTag,
  NAME_LIKE_COMMANDS,
  CONTROL_SYMBOLS
};
