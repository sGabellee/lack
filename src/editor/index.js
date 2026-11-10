const { EditorState, Compartment, Prec } = require('@codemirror/state');
const {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  ViewPlugin,
  Decoration
} = require('@codemirror/view');
const {
  defaultKeymap,
  history,
  historyKeymap
} = require('@codemirror/commands');
const {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  acceptCompletion
} = require('@codemirror/autocomplete');
const {
  bracketMatching,
  foldGutter,
  foldKeymap,
  foldService,
  StreamLanguage,
  syntaxHighlighting
} = require('@codemirror/language');
const { search, searchKeymap, openSearchPanel } = require('@codemirror/search');
const { lintGutter, lintKeymap } = require('@codemirror/lint');
const { latexLanguage } = require('./latex-syntax');
const { vim } = require('@replit/codemirror-vim');
const { yCollab } = require('y-codemirror.next');

const { getThemeExtensions } = require('./themes');
const {
  backspacePairCommand,
  enterBeginEnvCommand,
  customPairTypingExtension,
  createRenameSyncFilter
} = require('./autopair');
const { createLatexCompletionSource } = require('./autocomplete');
const { latexLinterExtension } = require('./linter');
const {
  createSpellCheckPlugin,
  setLanguage: setSpellLanguageInternal,
  addToUserDictionary,
  getSpellSuggestions,
  initSpellWorker
} = require('./spellcheck');

// LaTeX Folding Service
const latexFoldService = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;

  // 1. Fold environments \begin{env} ... \end{env}
  const beginMatch = /^(\s*)\\begin\{([a-zA-Z0-9*_-]+)\}/.exec(text);
  if (beginMatch) {
    const envName = beginMatch[2];
    const endTag = `\\end{${envName}}`;
    const docText = state.doc.toString();
    const afterPos = line.to;
    const endIdx = docText.indexOf(endTag, afterPos);
    if (endIdx !== -1) {
      const endLine = state.doc.lineAt(endIdx);
      return { from: line.to, to: endLine.to };
    }
  }

  // 2. Fold sections \section{...} until next \section, \chapter, etc.
  const secMatch = /^(\s*)\\(part|chapter|(?:sub){0,2}section|paragraph)\*?\{/.exec(text);
  if (secMatch) {
    const kind = secMatch[2];
    const levels = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };
    const curLevel = levels[kind] ?? 2;

    const totalLines = state.doc.lines;
    let endLine = line.number;
    for (let l = line.number + 1; l <= totalLines; l++) {
      const curLine = state.doc.line(l);
      const m = /^(\s*)\\(part|chapter|(?:sub){0,2}section|paragraph)\*?\{/.exec(curLine.text);
      if (m) {
        const nextLevel = levels[m[2]] ?? 2;
        if (nextLevel <= curLevel) {
          endLine = l - 1;
          break;
        }
      }
      endLine = l;
    }
    if (endLine > line.number) {
      return { from: line.to, to: state.doc.line(endLine).to };
    }
  }

  return null;
});

// Accurate LaTeX word counter (excludes commands, math, comments)
function getLatexWordCount(rawText) {
  if (!rawText || typeof rawText !== 'string') return 0;

  // 1. Remove comments
  let text = rawText.replace(/(^|[^\\])%.*$/gm, '$1 ');

  // 2. Remove display math \[ ... \] and $$ ... $$ and \begin{equation} ... \end{equation}
  text = text.replace(/\\\[[\s\S]*?\\\]/g, ' ');
  text = text.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  text = text.replace(/\\begin\{(?:equation|align|gather|multline|flalign)\*?\}[\s\S]*?\\end\{(?:equation|align|gather|multline|flalign)\*?\}/g, ' ');

  // 3. Remove inline math $ ... $ and \( ... \)
  text = text.replace(/\\\([\s\S]*?\\\)/g, ' ');
  text = text.replace(/\$[^\$]*?\$/g, ' ');

  // 4. Remove preamble
  const docIdx = text.indexOf('\\begin{document}');
  if (docIdx !== -1) {
    text = text.slice(docIdx + 16);
  }
  const endDocIdx = text.indexOf('\\end{document}');
  if (endDocIdx !== -1) {
    text = text.slice(0, endDocIdx);
  }

  // 5. Remove citations, labels, refs, input, usepackage commands
  text = text.replace(/\\(?:cite[a-z]*|ref|eqref|pageref|label|input|include|usepackage|documentclass)(?:\[[^\]]*\])?\{[^}]*\}/g, ' ');

  // 6. Remove general commands like \textbf{...} -> keep argument
  text = text.replace(/\\[a-zA-Z@*]+/g, ' ');

  // 7. Strip curly braces & punctuation
  text = text.replace(/[{}[\]()\\#&_]/g, ' ');

  // 8. Match words
  const words = text.match(/[\p{L}\p{N}'-]+/gu);
  return words ? words.length : 0;
}

// Extract outline structure (sections, subsections, etc.)
function getLatexOutline(rawText) {
  if (!rawText) return [];
  const outline = [];
  const lines = rawText.split('\n');
  const secRegex = /\\(part|chapter|(?:sub){0,2}section|paragraph)\*?\{([^}]+)\}/;

  let pos = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const lineText = lines[idx];
    const match = secRegex.exec(lineText);
    if (match) {
      const type = match[1];
      const title = match[2];
      outline.push({
        type,
        title,
        line: idx + 1,
        pos: pos + match.index
      });
    }
    pos += lineText.length + 1; // +1 for \n
  }
  return outline;
}

// Error line highlight decoration
const errorLineDeco = Decoration.line({
  class: 'cm-lint-error-line'
});

const errorHighlightField = ViewPlugin.fromClass(
  class {
    constructor() {
      this.decorations = Decoration.none;
    }
    setLine(view, lineNum) {
      if (!lineNum || lineNum < 1 || lineNum > view.state.doc.lines) {
        this.decorations = Decoration.none;
      } else {
        const line = view.state.doc.line(lineNum);
        this.decorations = Decoration.set([errorLineDeco.range(line.from)]);
      }
      view.requestMeasure();
    }
  },
  {
    decorations: (v) => v.decorations
  }
);

class CodeMirrorManager {
  constructor(containerEl, options = {}) {
    this.containerEl = containerEl;
    this.options = options;

    this.wrappingCompartment = new Compartment();
    this.vimCompartment = new Compartment();
    this.themeCompartment = new Compartment();
    this.collabCompartment = new Compartment();

    this.onDocChangeCallback = null;
    this.onCursorChangeCallback = null;
    this.onCompileCallback = options.onCompile || null;
    this.onRotateThemeCallback = options.onRotateTheme || null;

    this.projectContext = {
      getBibKeys: options.getBibKeys || (() => []),
      getImageFiles: options.getImageFiles || (() => []),
      getTexFiles: options.getTexFiles || (() => [])
    };

    this.initEditor(options.initialValue || '');
  }

  initEditor(initialText) {
    const self = this;

    // Custom keybindings
    const customKeymaps = [
      {
        key: 'Backspace',
        run: backspacePairCommand
      },
      {
        key: 'Enter',
        run: enterBeginEnvCommand
      },
      {
        key: 'Mod-b',
        run: () => {
          self.wrapSelection('\\textbf{', '}');
          return true;
        }
      },
      {
        key: 'Mod-i',
        run: () => {
          self.wrapSelection('\\textit{', '}');
          return true;
        }
      },
      {
        key: 'Mod-u',
        run: () => {
          self.wrapSelection('\\underline{', '}');
          return true;
        }
      },
      {
        key: 'Mod-m',
        run: () => {
          if (typeof self.onRotateThemeCallback === 'function') {
            self.onRotateThemeCallback();
            return true;
          }
          return false;
        }
      },
      {
        key: 'Mod-Shift-m',
        run: () => {
          self.toggleMath();
          return true;
        }
      },
      {
        key: 'Mod-Alt-m',
        run: () => {
          self.toggleMath();
          return true;
        }
      },
      {
        key: 'Tab',
        run: acceptCompletion
      },
      {
        key: 'Mod-/',
        run: () => {
          self.toggleComment();
          return true;
        }
      },
      {
        key: 'Mod-Enter',
        run: () => {
          if (typeof self.onCompileCallback === 'function') {
            self.onCompileCallback();
          }
          return true;
        }
      },
      {
        key: 'Mod-f',
        run: openSearchPanel
      }
    ];

    const state = EditorState.create({
      doc: initialText,
      extensions: [
        EditorView.exceptionSink.of((err) => {
          console.error("CM CRASH STACK:\n" + (err && err.stack ? err.stack : err));
        }),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        history(),
        foldGutter(),
        latexFoldService,
        search({ top: true }),
        lintGutter(),
        latexLanguage,
        this.themeCompartment.of(getThemeExtensions(this.options.theme || 'light')),
        this.wrappingCompartment.of(EditorView.lineWrapping),
        this.vimCompartment.of([]),
        this.collabCompartment.of([]),
        customPairTypingExtension(),
        EditorState.transactionFilter.of(createRenameSyncFilter()),
        autocompletion({
          override: [createLatexCompletionSource(this.projectContext)],
          defaultKeymap: true
        }),
        latexLinterExtension(),
        createSpellCheckPlugin(),
        errorHighlightField,
        Prec.high(keymap.of(customKeymaps)),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          ...lintKeymap
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && typeof self.onDocChangeCallback === 'function') {
            self.onDocChangeCallback(update.state.doc.toString());
          }
          if (
            (update.docChanged || update.selectionSet) &&
            typeof self.onCursorChangeCallback === 'function'
          ) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            const col = head - line.from + 1;
            self.onCursorChangeCallback(line.number, col);
          }
        })
      ]
    });

    this.view = new EditorView({
      state,
      parent: this.containerEl
    });
  }

  getValue() {
    return this.view.state.doc.toString();
  }

  setValue(newText) {
    if (newText === this.getValue()) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: newText }
    });
  }

  getSelection() {
    const sel = this.view.state.selection.main;
    return this.view.state.sliceDoc(sel.from, sel.to);
  }

  replaceSelection(insertText) {
    this.view.dispatch(this.view.state.replaceSelection(insertText));
    this.view.focus();
  }

  wrapSelection(before, after) {
    const sel = this.view.state.selection.main;
    const doc = this.view.state.doc;
    const selectedText = this.view.state.sliceDoc(sel.from, sel.to);

    // 1. If selection itself starts with before and ends with after -> UNWRAP
    if (selectedText.length >= before.length + after.length &&
        selectedText.startsWith(before) &&
        selectedText.endsWith(after)) {
      const unwrapped = selectedText.slice(before.length, selectedText.length - after.length);
      this.view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: unwrapped },
        selection: { anchor: sel.from, head: sel.from + unwrapped.length }
      });
      this.view.focus();
      return;
    }

    // 2. If selection is surrounded in document by before and after -> UNWRAP
    const bLen = before.length;
    const aLen = after.length;
    if (sel.from >= bLen && sel.to + aLen <= doc.length) {
      const textBefore = doc.sliceString(sel.from - bLen, sel.from);
      const textAfter = doc.sliceString(sel.to, sel.to + aLen);
      if (textBefore === before && textAfter === after) {
        this.view.dispatch({
          changes: [
            { from: sel.to, to: sel.to + aLen, insert: '' },
            { from: sel.from - bLen, to: sel.from, insert: '' }
          ],
          selection: { anchor: sel.from - bLen, head: sel.to - bLen }
        });
        this.view.focus();
        return;
      }
    }

    // 3. Otherwise -> WRAP
    const replacement = `${before}${selectedText}${after}`;
    const newAnchor = sel.from + bLen;
    const newHead = newAnchor + selectedText.length;
    this.view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: replacement },
      selection: selectedText.length > 0
        ? { anchor: newAnchor, head: newHead }
        : { anchor: newAnchor }
    });
    this.view.focus();
  }

  toggleMath() {
    this.wrapSelection('$', '$');
  }

  setTheme(themeName) {
    this.view.dispatch({
      effects: this.themeCompartment.reconfigure(getThemeExtensions(themeName))
    });
  }

  insertSnippet(text) {
    this.replaceSelection(text);
  }

  toggleComment() {
    const state = this.view.state;
    const sel = state.selection.main;
    const startLine = state.doc.lineAt(sel.from);
    const endLine = state.doc.lineAt(sel.to);

    const changes = [];
    let allCommented = true;

    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = state.doc.line(l);
      if (!/^\s*%/.test(line.text) && line.text.trim().length > 0) {
        allCommented = false;
        break;
      }
    }

    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = state.doc.line(l);
      if (allCommented) {
        // Remove %
        const match = /^(\s*)% ?/.exec(line.text);
        if (match) {
          changes.push({
            from: line.from + match[1].length,
            to: line.from + match[0].length,
            insert: ''
          });
        }
      } else {
        // Add %
        changes.push({
          from: line.from,
          to: line.from,
          insert: '% '
        });
      }
    }

    if (changes.length > 0) {
      this.view.dispatch({ changes });
    }
  }

  jumpToLine(lineNum, col = 1) {
    const totalLines = this.view.state.doc.lines;
    const targetLineNum = Math.max(1, Math.min(lineNum, totalLines));
    const line = this.view.state.doc.line(targetLineNum);
    const targetPos = Math.min(line.from + Math.max(0, col - 1), line.to);

    this.view.dispatch({
      selection: { anchor: targetPos },
      scrollIntoView: true
    });
    this.view.focus();
  }

  highlightErrorLine(lineNum) {
    const plugin = this.view.plugin(errorHighlightField);
    if (plugin) {
      plugin.setLine(this.view, lineNum);
      if (lineNum) {
        this.jumpToLine(lineNum);
      }
    }
  }

  clearErrorHighlight() {
    const plugin = this.view.plugin(errorHighlightField);
    if (plugin) {
      plugin.setLine(this.view, null);
    }
  }

  setLineWrapping(enabled) {
    this.view.dispatch({
      effects: this.wrappingCompartment.reconfigure(
        enabled ? EditorView.lineWrapping : []
      )
    });
  }

  setVimMode(enabled) {
    this.view.dispatch({
      effects: this.vimCompartment.reconfigure(enabled ? vim() : [])
    });
  }

  bindYjs(yText, undoManager, awareness) {
    if (!yText) return;
    this.view.dispatch({
      effects: this.collabCompartment.reconfigure(
        yCollab(yText, awareness, { undoManager })
      )
    });
  }

  unbindYjs() {
    this.view.dispatch({
      effects: this.collabCompartment.reconfigure([])
    });
  }

  focus() {
    this.view.focus();
  }

  onDocChange(fn) {
    this.onDocChangeCallback = fn;
  }

  onCursorChange(fn) {
    this.onCursorChangeCallback = fn;
  }

  onRotateTheme(fn) {
    this.onRotateThemeCallback = fn;
  }

  getWordCount() {
    return getLatexWordCount(this.getValue());
  }

  getOutline() {
    return getLatexOutline(this.getValue());
  }
}

function createCodeMirrorEditor(containerEl, options = {}) {
  return new CodeMirrorManager(containerEl, options);
}

module.exports = {
  createCodeMirrorEditor,
  CodeMirrorManager,
  getLatexWordCount,
  getLatexOutline,
  setSpellLanguage: setSpellLanguageInternal,
  addToUserDictionary,
  getSpellSuggestions,
  initSpellWorker
};
