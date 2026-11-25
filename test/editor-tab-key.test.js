const test = require('node:test');
const assert = require('node:assert/strict');
const { EditorState } = require('@codemirror/state');
const { insertTab, indentMore, indentLess } = require('@codemirror/commands');

test('Tab key: insertTab inserts tab character at cursor without selection', () => {
  const initial = 'Hello world';
  const cursor = 5;
  const state = EditorState.create({
    doc: initial,
    selection: { anchor: cursor }
  });

  let nextState = null;
  const handled = insertTab({
    state,
    dispatch: (tr) => {
      nextState = state.update(tr).state;
    }
  });

  assert.strictEqual(handled, true);
  assert.strictEqual(nextState.doc.toString(), 'Hello\t world');
  assert.strictEqual(nextState.selection.main.head, 6);
});

test('Tab key: multi-line selection indents all selected lines with indentMore', () => {
  const initial = 'Alpha\nBeta\nGamma';
  const state = EditorState.create({
    doc: initial,
    selection: { anchor: 0, head: initial.length }
  });

  let nextState = null;
  const handled = insertTab({
    state,
    dispatch: (tr) => {
      nextState = state.update(tr).state;
    }
  });

  assert.strictEqual(handled, true);
  assert.strictEqual(nextState.doc.toString(), '  Alpha\n  Beta\n  Gamma');
});

test('Shift-Tab key: indentLess un-indents lines cleanly', () => {
  const initial = '  Alpha\n  Beta\n  Gamma';
  const state = EditorState.create({
    doc: initial,
    selection: { anchor: 0, head: initial.length }
  });

  let nextState = null;
  const handled = indentLess({
    state,
    dispatch: (tr) => {
      nextState = state.update(tr).state;
    }
  });

  assert.strictEqual(handled, true);
  assert.strictEqual(nextState.doc.toString(), 'Alpha\nBeta\nGamma');
});
