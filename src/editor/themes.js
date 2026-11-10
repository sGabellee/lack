/**
 * src/editor/themes.js
 * CodeMirror 6 theme definitions driven by Lack's CSS variables and accessible palette.
 *
 * Rules:
 * - Commands & delimiters: Light #80007f (Lack purple), Dark #d98cd9 (accessible light purple)
 * - Arguments, environments, math: Light #1a4d8f (dark blue), Dark #7aa2e8 (light blue)
 * - Selection: Light #b3d4fc (classic blue), Dark #264f78 (classic dark blue)
 * - Inactive selection: Light #dcdcdc, Dark #383838
 * - Syntax foregrounds inside selection are preserved and unchanged
 * - Active line & gutter: neutral tint, NO pink/magenta
 * - Contrast ratios >= 4.5:1 against light (#ededed) and dark (#1f1f1f) backgrounds
 */

const { EditorView } = require('@codemirror/view');
const { HighlightStyle, syntaxHighlighting } = require('@codemirror/language');
const {
  latexCommandTag,
  latexArgumentTag,
  latexMathTag,
  latexDelimiterTag,
  latexCommentTag
} = require('./latex-syntax');
const { tags } = require('@lezer/highlight');

// Base structural theme applied to all modes
const lackBaseTheme = EditorView.theme({
  '&': {
    height: '100%',
    width: '100%',
    color: 'var(--fg)',
    backgroundColor: 'var(--editor-bg)',
    fontSize: '13.5px',
    lineHeight: '22px',
    fontFamily: 'var(--code-font-family, monospace)',
    textAlign: 'left'
  },
  '.cm-content': {
    caretColor: 'var(--fg)',
    padding: '12px 16px 50vh 16px',
    fontFamily: 'var(--code-font-family, monospace)',
    textAlign: 'left'
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--fg)',
    borderLeftWidth: '2px'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: '#777777',
    borderRight: '1px solid var(--explorer-border)',
    padding: '12px 0 50vh 0',
    minWidth: '44px',
    userSelect: 'none'
  },
  '.cm-gutterElement': {
    padding: '0 8px 0 4px',
    textAlign: 'right',
    fontSize: '13.5px',
    lineHeight: '22px',
    fontFamily: 'var(--code-font-family, monospace)',
    color: '#888888'
  },
  '.cm-foldGutter .cm-gutterElement': {
    cursor: 'pointer',
    color: '#888888',
    padding: '0 4px',
    fontSize: '12px'
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: '#80007f'
  },
  // Spell error: wavy red underline ONLY, no background or gutter dot
  '.cm-spell-error': {
    textDecoration: 'underline wavy #ef4444 !important',
    textDecorationSkipInk: 'none'
  },
  // Compiler / linter error line
  '.cm-lint-error-line': {
    backgroundColor: 'rgba(239, 68, 68, 0.12) !important'
  },
  '.cm-lint-error-gutter': {
    color: '#ef4444 !important',
    fontWeight: 'bold !important'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--editor-bg) !important',
    border: '1px solid var(--explorer-border) !important',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35) !important',
    borderRadius: '8px !important',
    color: 'var(--fg) !important'
  },
  '.cm-tooltip-autocomplete': {
    '& > ul': {
      fontFamily: 'var(--code-font-family, monospace)',
      maxHeight: '260px'
    },
    '& > ul > li': {
      padding: '4px 8px',
      lineHeight: '20px'
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: '#80007f !important',
      color: '#ffffff !important'
    }
  }
});

// Light Theme: Classic Blue selection, neutral active line, high contrast tokens
const lackLightTheme = EditorView.theme({
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: '#b3d4fc !important'
  },
  '.cm-selectionBackground': {
    backgroundColor: '#dcdcdc !important'
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(179, 212, 252, 0.45)',
    borderRadius: '2px'
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(0, 0, 0, 0.035)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    color: '#1e1e1e',
    fontWeight: 'bold'
  }
});

// Dark Theme: Classic Blue Dark selection, neutral active line, high contrast tokens
const lackDarkTheme = EditorView.theme({
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: '#264f78 !important'
  },
  '.cm-selectionBackground': {
    backgroundColor: '#383838 !important'
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(38, 79, 120, 0.55)',
    borderRadius: '2px'
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    color: '#eaeaea',
    fontWeight: 'bold'
  }
});

// Light syntax highlighting (contrast against #ededed)
// Commands: #80007f (ratio ~8.06:1), Arguments & Math: #0000CD (MediumBlue, ratio ~8.5:1)
const lightHighlightStyle = HighlightStyle.define([
  { tag: latexCommandTag, color: '#80007f', fontWeight: 'bold' },
  { tag: latexDelimiterTag, color: '#80007f' },
  { tag: latexArgumentTag, color: '#0000CD', fontWeight: '500' },
  { tag: latexMathTag, color: '#0000CD' },
  { tag: latexCommentTag, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#80007f', fontWeight: 'bold' },
  { tag: tags.name, color: '#0000CD' },
  { tag: tags.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.string, color: '#0000CD' },
  { tag: tags.number, color: '#0000CD' },
  { tag: tags.bracket, color: '#80007f' },
  { tag: tags.heading, color: '#80007f', fontWeight: 'bold' }
]);

// Dark syntax highlighting (contrast against #1f1f1f / #0d1117)
// Commands: #d98cd9 (ratio ~6.87:1), Arguments & Math: #7aa2e8 (ratio ~6.46:1)
const darkHighlightStyle = HighlightStyle.define([
  { tag: latexCommandTag, color: '#d98cd9', fontWeight: 'bold' },
  { tag: latexDelimiterTag, color: '#d98cd9' },
  { tag: latexArgumentTag, color: '#7aa2e8', fontWeight: '500' },
  { tag: latexMathTag, color: '#7aa2e8' },
  { tag: latexCommentTag, color: '#9ca3af', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#d98cd9', fontWeight: 'bold' },
  { tag: tags.name, color: '#7aa2e8' },
  { tag: tags.comment, color: '#9ca3af', fontStyle: 'italic' },
  { tag: tags.string, color: '#7aa2e8' },
  { tag: tags.number, color: '#7aa2e8' },
  { tag: tags.bracket, color: '#d98cd9' },
  { tag: tags.heading, color: '#d98cd9', fontWeight: 'bold' }
]);

function getThemeExtensions(themeName = 'light') {
  const isLight = themeName === 'light';
  return [
    lackBaseTheme,
    isLight ? lackLightTheme : lackDarkTheme,
    syntaxHighlighting(isLight ? lightHighlightStyle : darkHighlightStyle)
  ];
}

module.exports = {
  lackBaseTheme,
  lackLightTheme,
  lackDarkTheme,
  lightHighlightStyle,
  darkHighlightStyle,
  getThemeExtensions
};
