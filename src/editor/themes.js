/**
 * src/editor/themes.js
 * CodeMirror 6 theme definitions driven by Lack's CSS variables
 */

const { EditorView } = require('@codemirror/view');
const { Extension } = require('@codemirror/state');
const { HighlightStyle, syntaxHighlighting } = require('@codemirror/language');
const { tags } = require('@lezer/highlight');

// Base theme structure: matches Lack's CSS variables
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
  '&.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(128, 0, 127, 0.35) !important'
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(128, 0, 127, 0.22)',
    borderRadius: '2px'
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
  '.cm-activeLine': {
    backgroundColor: 'rgba(128, 0, 127, 0.05)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(128, 0, 127, 0.12)',
    color: 'var(--fg)',
    fontWeight: 'bold'
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
  '.cm-spell-error': {
    textDecoration: 'underline wavy #ef4444 !important',
    textDecorationSkipInk: 'none'
  },
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

// Syntax highlighting style for LaTeX tokens
const lackHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#e070e0', fontWeight: 'bold' },
  { tag: tags.name, color: '#60a5fa' },
  { tag: tags.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.string, color: '#f59e0b' },
  { tag: tags.number, color: '#10b981' },
  { tag: tags.operator, color: '#f43f5e' },
  { tag: tags.punctuation, color: '#94a3b8' },
  { tag: tags.bracket, color: '#38bdf8' },
  { tag: tags.heading, color: '#ec4899', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.link, color: '#818cf8', textDecoration: 'underline' }
]);

module.exports = {
  lackBaseTheme,
  lackHighlightStyle,
  lackSyntaxHighlighting: syntaxHighlighting(lackHighlightStyle)
};
