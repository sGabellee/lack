const test = require('node:test');
const assert = require('node:assert');
const { checkBackspacePair, checkBeginEnvEnter } = require('../src/editor/autopair-logic.js');

test('deletes 1-char empty pairs on Backspace', () => {
  // Test \section{|}
  const text1 = '\\section{}';
  const cursor1 = text1.indexOf('{') + 1; // position between { and }
  const res1 = checkBackspacePair(text1, cursor1);
  assert.strictEqual(res1.shouldDelete, true);
  assert.strictEqual(res1.from, cursor1 - 1);
  assert.strictEqual(res1.to, cursor1 + 1);

  // Applying the deletion
  const after1 = text1.slice(0, res1.from) + text1.slice(res1.to);
  assert.strictEqual(after1, '\\section');

  // Test $|$
  const text2 = 'Formula $$ finale';
  const cursor2 = 9; // between $ and $
  const res2 = checkBackspacePair(text2, cursor2);
  assert.strictEqual(res2.shouldDelete, true);
  assert.strictEqual(text2.slice(0, res2.from) + text2.slice(res2.to), 'Formula  finale');

  // Test [|]
  const text3 = '\\sqrt[]';
  const cursor3 = text3.indexOf('[') + 1;
  const res3 = checkBackspacePair(text3, cursor3);
  assert.strictEqual(res3.shouldDelete, true);
  assert.strictEqual(text3.slice(0, res3.from) + text3.slice(res3.to), '\\sqrt');
});

test('deletes 2-char LaTeX pairs on Backspace: \\(|\\) and \\([|\\)', () => {
  const text = 'test \\(\\) more';
  const cursor = text.indexOf('\\(') + 2;
  const res = checkBackspacePair(text, cursor);
  assert.strictEqual(res.shouldDelete, true);
  assert.strictEqual(text.slice(0, res.from) + text.slice(res.to), 'test  more');

  const textBracket = 'disp \\[\\] end';
  const cursorBracket = textBracket.indexOf('\\[') + 2;
  const resBracket = checkBackspacePair(textBracket, cursorBracket);
  assert.strictEqual(resBracket.shouldDelete, true);
  assert.strictEqual(textBracket.slice(0, resBracket.from) + textBracket.slice(resBracket.to), 'disp  end');
});

test('does not trigger deletion when characters do not match empty pair', () => {
  const text = 'non-matching {a} text';
  const res = checkBackspacePair(text, text.indexOf('a'));
  assert.strictEqual(res.shouldDelete, false);
});

test('auto-inserts matching \\end{env} after \\begin{env} on Enter', () => {
  const line = '  \\begin{itemize}';
  const res = checkBeginEnvEnter(line, line.length);
  assert.strictEqual(res.shouldExpand, true);
  assert.strictEqual(res.envName, 'itemize');
  assert.ok(res.insertText.includes('\\end{itemize}'));
  assert.ok(res.insertText.startsWith('\n    \n  \\end{itemize}'));
});
