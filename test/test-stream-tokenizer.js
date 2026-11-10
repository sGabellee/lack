const fs = require('fs');
const fixture = fs.readFileSync('test/fixtures/lab-report.tex', 'utf8');

const NAME_LIKE_COMMANDS = new Set([
  'documentclass', 'usepackage', 'RequirePackage', 'begin', 'end',
  'pagestyle', 'thispagestyle', 'input', 'include', 'includegraphics',
  'bibliography', 'bibliographystyle', 'label', 'ref', 'eqref',
  'autoref', 'cref', 'Cref', 'pageref', 'cite', 'citep', 'citet',
  'url', 'hypersetup', 'geometry', 'definecolor', 'color', 'textcolor'
]);

const CONTROL_SYMBOLS = new Set([
  '\\', '#', '$', '%', '&', '_', '{', '}',
  ',', ';', ':', '!', '@', '-', '/', ' '
]);

function createLatexParser() {
  return {
    startState() {
      return {
        stack: [], // 'bracket_arg', 'brace_arg', 'math_inline', 'math_display'
        lastCommand: null,
        pendingNameArg: false,
        inMath: false
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

      // 2. Math delimiters
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

      // If in math mode and encountering non-command content
      if (state.inMath && stream.peek() !== '\\') {
        // Read non-command math characters until backslash, $, or end
        stream.match(/^[^\\$%]+/);
        return 'math';
      }

      // 3. Backslash commands and control symbols
      if (stream.peek() === '\\') {
        stream.next(); // consume '\'
        const nextChar = stream.peek();
        
        // Control symbol?
        if (CONTROL_SYMBOLS.has(nextChar)) {
          stream.next();
          return 'command';
        }

        // Regular command: \[a-zA-Z@]+\*?
        if (stream.match(/^[a-zA-Z@]+\*?/)) {
          const fullCmd = stream.current(); // e.g. "\documentclass" or "\usepackage*"
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

        // Stray backslash
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
          // If command allows multiple brace args (like hypersetup or textcolor), keep pending, else clear
          if (state.lastCommand !== 'hypersetup') {
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

      // Check current context
      const currentContext = state.stack.length > 0 ? state.stack[state.stack.length - 1] : null;
      if (currentContext && (currentContext.type === 'bracket_arg' || currentContext.type === 'brace_arg')) {
        // We are inside an argument: read word or symbols
        // Delimiters like comma, equals, semicolon: can be part of argument or delimiter
        if (stream.match(/^[^\\{}[\]%$,]+/)) {
          return 'argument';
        }
        if (stream.match(/^[,=]/)) {
          return 'argument';
        }
      }

      // Other delimiters
      if (ch === '&') {
        stream.next();
        return 'delimiter';
      }

      // Regular text (prose)
      stream.match(/^[^\s\\{}[\]%$&]+/);
      return 'text';
    }
  };
}

// Tokenize text line by line using simple StringStream simulator
class StringStream {
  constructor(string) {
    this.string = string;
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

const parser = createLatexParser();
const state = parser.startState();
const tokens = [];

const lines = fixture.split('\n');
for (let lineNum = 0; lineNum < lines.length; lineNum++) {
  const line = lines[lineNum];
  const stream = new StringStream(line);
  while (stream.pos < stream.string.length) {
    stream.start = stream.pos;
    const type = parser.token(stream, state);
    if (type) {
      tokens.push({ text: stream.current(), type, line: lineNum + 1 });
    }
  }
}

const requiredWords = ['a4paper', 'inputenc', 'geometry', 'fancy', 'utf8', '12pt', 'margin', '2.5cm', 'colorlinks', 'true'];
console.log('--- Checking Required Words in Snapshot ---');
for (const word of requiredWords) {
  const found = tokens.find(t => t.text.includes(word));
  console.log(`Word "${word}":`, found ? `${found.text} -> ${found.type}` : 'NOT FOUND');
  if (!found || found.type !== 'argument') {
    console.error(`FAILED: ${word} is not argument!`);
    process.exit(1);
  }
}
console.log('ALL REQUIRED WORDS ARE TOKENIZED AS ARGUMENT!');
