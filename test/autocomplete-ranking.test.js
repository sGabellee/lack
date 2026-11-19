const test = require('node:test');
const assert = require('node:assert');
const {
  createLatexCompletionSource,
  levenshtein,
  getCommandSignature,
  getSourceBadge
} = require('../src/editor/autocomplete.js');

test('Autocomplete: 4-tier ranking rules and exact prefix matching for \\sect', () => {
  const source = createLatexCompletionSource();
  const mockState = {
    doc: {
      lineAt: () => ({ text: '\\sect', from: 0, to: 5 }),
      toString: () => '\\documentclass{article}\n\\begin{document}\n\\sect'
    }
  };

  const result = source({ state: mockState, pos: 5 });
  assert.ok(result, 'Completion result must be returned');
  assert.strictEqual(result.filter, false, 'Custom ranking handles filtering; CM6 fuzzy filter must be disabled');

  const labels = result.options.map(o => o.label);
  
  // 1. Must include \section{} and \subsection{}
  assert.ok(labels.some(l => l.startsWith('\\section{')), 'Must include \\section{}');
  assert.ok(labels.some(l => l.includes('section')), 'Must include section variants');
  assert.ok(labels.some(l => l.includes('subsection')), 'Must include subsection variants');

  // 2. CRITICAL: Must NEVER include scattered subsequence matches like setcounter or usecounter
  assert.ok(!labels.some(l => l.startsWith('\\setcounter')), 'Must NOT include \\setcounter for query \\sect');
  assert.ok(!labels.some(l => l.startsWith('\\usecounter')), 'Must NOT include \\usecounter for query \\sect');

  // 3. Must collapse * variants unless user query ends with *
  assert.ok(!labels.includes('\\section*{}') && !labels.includes('\\section*'), 'Must collapse \\section* when query is \\sect');
});

test('Autocomplete: typing \\section* shows starred variant', () => {
  const source = createLatexCompletionSource();
  const mockState = {
    doc: {
      lineAt: () => ({ text: '\\section*', from: 0, to: 9 }),
      toString: () => '\\documentclass{article}\n\\begin{document}\n\\section*'
    }
  };

  const result = source({ state: mockState, pos: 9 });
  assert.ok(result);
  const labels = result.options.map(o => o.label);
  assert.ok(labels.some(l => l.includes('section*')), 'Must show section* when query ends with *');
});

test('Autocomplete: argument signatures derived accurately', () => {
  assert.strictEqual(getCommandSignature({ name: 'section', args: 'm' }), '{}');
  assert.strictEqual(getCommandSignature({ name: 'frac', args: 'm m' }), '{}{}');
  assert.strictEqual(getCommandSignature({ name: 'includegraphics', args: 'o m' }), '[]{}');
  assert.strictEqual(getCommandSignature({ name: 'textbf' }), '{}');
});

test('Autocomplete: source badges cleanly classified', () => {
  assert.strictEqual(getSourceBadge({ name: 'section', package: 'latex2e' }), 'cmd');
  assert.strictEqual(getSourceBadge({ name: 'section' }), 'cmd');
  assert.strictEqual(getSourceBadge({ name: 'eqref', package: 'amsmath' }), 'amsmath-cmd');
  assert.strictEqual(getSourceBadge({ name: 'autoref', package: 'hyperref' }), 'hyperref-cmd');
});

test('Autocomplete: Levenshtein distance calculations', () => {
  assert.strictEqual(levenshtein('sect', 'section'), 3);
  assert.strictEqual(levenshtein('textbf', 'textbff'), 1);
  assert.strictEqual(levenshtein('author', 'authr'), 1);
  assert.strictEqual(levenshtein('same', 'same'), 0);
});
