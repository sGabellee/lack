const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

test('DIAGNOSTIC 1: latex-commands.json must be loadable from bundled location', () => {
  // When running inside renderer.bundle.js at root /home/sgabelli/github/lack
  const rootDir = path.resolve(__dirname, '..');
  const bundlePath = path.join(rootDir, 'renderer.bundle.js');
  // Check if linter-logic currently uses ../../data which breaks when bundled at root
  const linterLogicCode = fs.readFileSync(path.join(rootDir, 'src/editor/linter-logic.js'), 'utf8');
  assert.ok(
    linterLogicCode.includes('../../data/latex-commands.json'),
    'Expected linter-logic to contain the flawed relative path'
  );
  const resolvedFromBundle = path.join(rootDir, '../../data/latex-commands.json');
  assert.equal(fs.existsSync(resolvedFromBundle), false, 'Bundle relative path must fail to resolve');
});

test('DIAGNOSTIC 2: enterBeginEnvCommand logic bug with truthy { shouldExpand: false }', () => {
  const { checkBeginEnvEnter } = require('../src/editor/autopair-logic');
  const result = checkBeginEnvEnter('just a regular line of text', 10);
  assert.equal(result.shouldExpand, false);
  // In Javascript, if (result) is true!
  const isTruthy = Boolean(result);
  assert.equal(isTruthy, true, 'Object { shouldExpand: false } is truthy in JS');
  assert.equal(result.envName, undefined, 'envName is undefined');
  // This caused \end{undefined} insertion when checked as `if (enterInfo)`
});

test('DIAGNOSTIC 3: spell tokenizer does NOT split alphanumeric words at digits', () => {
  const { tokenizeLatexProse } = require('../src/editor/spell-tokenizer');
  const tokens = tokenizeLatexProse('Test with a4paper and utf8 options');
  const words = tokens.map(t => t.word);
  // Fixed: must NOT split a4paper into paper or utf8 into utf
  assert.ok(!words.includes('paper') && !words.includes('utf'), 'Fixed: does not split a4paper/utf8 into words');
});

test('DIAGNOSTIC 4: CmdOrCtrl+M rotates theme matching Mark and does NOT conflict with math', () => {
  const mainJs = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  assert.ok(
    mainJs.includes('accelerator: "CmdOrCtrl+M"'),
    'CmdOrCtrl+M accelerator must exist in main.js menu to rotate theme like Mark'
  );
});
