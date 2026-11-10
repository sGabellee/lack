const test = require('node:test');
const assert = require('node:assert');
const { tokenizeLatexProse } = require('../src/editor/spell-tokenizer.js');

test('excludes comments from spellchecking', () => {
  const input = 'Questa è una parola. % commento con errorre\nAltra parola.';
  const tokens = tokenizeLatexProse(input);
  const words = tokens.map(t => t.word);

  assert.ok(words.includes('Questa'));
  assert.ok(words.includes('parola'));
  assert.ok(words.includes('Altra'));
  assert.ok(!words.includes('commento'), 'Should exclude comment words');
  assert.ok(!words.includes('errorre'), 'Should exclude comment words');
});

test('excludes inline and display math', () => {
  const input = 'Formula $x + y = z$ e anche \\[ \\int_a^b f(x) dx \\] nel testo.';
  const tokens = tokenizeLatexProse(input);
  const words = tokens.map(t => t.word);

  assert.ok(words.includes('Formula'));
  assert.ok(words.includes('anche'));
  assert.ok(words.includes('testo'));
  assert.ok(!words.includes('int'), 'Should exclude math commands');
});

test('excludes math and verbatim environments', () => {
  const input = `
Testo iniziale.
\\begin{equation}
  E = mc^2 + \\alpha
\\end{equation}
\\begin{verbatim}
  console.log("erroreeee");
\\end{verbatim}
Testo finale.
`;
  const tokens = tokenizeLatexProse(input);
  const words = tokens.map(t => t.word);

  assert.ok(words.includes('Testo'));
  assert.ok(words.includes('iniziale'));
  assert.ok(words.includes('finale'));
  assert.ok(!words.includes('alpha'));
  assert.ok(!words.includes('console'));
  assert.ok(!words.includes('erroreeee'));
});

test('excludes citation keys, labels and refs', () => {
  const input = 'Come visto in \\cite{einstein1905} e nella figura \\ref{fig:diagramma}.';
  const tokens = tokenizeLatexProse(input);
  const words = tokens.map(t => t.word);

  assert.ok(words.includes('Come'));
  assert.ok(words.includes('visto'));
  assert.ok(words.includes('nella'));
  assert.ok(words.includes('figura'));
  assert.ok(!words.includes('einstein1905'));
  assert.ok(!words.includes('diagramma'));
});

test('excludes ALL-CAPS words and words shorter than 3 characters', () => {
  const input = 'Un file PDF ed il testo HTML per la NASA.';
  const tokens = tokenizeLatexProse(input);
  const words = tokens.map(t => t.word);

  assert.ok(!words.includes('Un')); // < 3 chars
  assert.ok(!words.includes('il')); // < 3 chars
  assert.ok(!words.includes('la')); // < 3 chars
  assert.ok(!words.includes('PDF')); // ALL CAPS
  assert.ok(!words.includes('HTML')); // ALL CAPS
  assert.ok(!words.includes('NASA')); // ALL CAPS
  assert.ok(words.includes('file'));
  assert.ok(words.includes('testo'));
});
