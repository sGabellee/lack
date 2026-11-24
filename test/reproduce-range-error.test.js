const test = require('node:test');
const assert = require('node:assert');
const { ChangeSet, EditorState } = require('@codemirror/state');
const { compilerIssueStateField, setCompilerIssuesEffect, setExtraHighlightEffect, tabSwitchAnnotation } = require('../src/editor/linter.js');

test('mapTrackedEntry does not crash with RangeError when entry positions exceed changeset length', () => {
  // Simulate an entry that had from: 103 (e.g. from an older larger document)
  const entry = {
    issue: { type: 'error', line: 5, message: 'Test issue' },
    from: 103,
    to: 110,
    line: 5,
    nonEmpty: true,
    origToken: '\\sect',
    deleted: false,
    anchor: 103
  };

  // Changeset computed on document of length 57
  const changes = ChangeSet.of({ from: 10, to: 15, insert: 'abc' }, 57);

  const state = EditorState.create({
    doc: 'x'.repeat(57),
    extensions: [compilerIssueStateField]
  });

  // Put entry into field
  const tr1 = state.update({
    effects: [setCompilerIssuesEffect.of([entry])]
  });

  // Now apply a doc change on length 57 WITHOUT tabSwitchAnnotation
  // It should NOT throw "Position 103 is out of range for changeset of length 57"
  assert.doesNotThrow(() => {
    const tr2 = tr1.state.update({ changes });
    // Force slot computation on new state
    const fieldVal = tr2.state.field(compilerIssueStateField);
    assert.ok(fieldVal);
    assert.strictEqual(fieldVal.entries[0].deleted, true);
  });
});

test('extraRanges does not crash with RangeError when ranges exceed changeset length', () => {
  const extraRange = {
    from: 103,
    to: 106,
    line: 5,
    nonEmpty: true,
    origToken: null,
    deleted: false,
    anchor: 103
  };

  const changes = ChangeSet.of({ from: 0, to: 5, insert: 'abc' }, 57);

  const state = EditorState.create({
    doc: 'x'.repeat(57),
    extensions: [compilerIssueStateField]
  });

  const tr1 = state.update({
    effects: [setExtraHighlightEffect.of([extraRange])]
  });

  assert.doesNotThrow(() => {
    const tr2 = tr1.state.update({ changes });
    const fieldVal = tr2.state.field(compilerIssueStateField);
    assert.ok(fieldVal);
    // Deleted ranges are filtered out
    assert.strictEqual(fieldVal.extraRanges.length, 0);
  });
});
