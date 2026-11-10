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

test('never spellchecks commands, package arguments, or alphanumeric words with digits', () => {
  const input = `
\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}

\\title{Document Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Write your content here...

\\section{Buongiorno}
Testo in italiano con a4paper e utf8 nel testo.
\\end{document}
`;
  const tokens = tokenizeLatexProse(input);
  const words = tokens.map(t => t.word);

  // Must NOT include LaTeX commands or arguments
  assert.ok(!words.includes('documentclass'), 'No commands');
  assert.ok(!words.includes('usepackage'), 'No commands');
  assert.ok(!words.includes('article'), 'No docclass arg');
  assert.ok(!words.includes('inputenc'), 'No package arg');
  assert.ok(!words.includes('amsmath'), 'No package arg');
  assert.ok(!words.includes('document'), 'No env arg');

  // Must NOT include words with digits (nor split them!)
  assert.ok(!words.includes('11pt'), 'No 11pt');
  assert.ok(!words.includes('pt'), 'No split pt from 11pt');
  assert.ok(!words.includes('a4paper'), 'No a4paper');
  assert.ok(!words.includes('paper'), 'No split paper from a4paper');
  assert.ok(!words.includes('utf8'), 'No utf8');
  assert.ok(!words.includes('utf'), 'No split utf from utf8');

  // MUST include actual prose words
  assert.ok(words.includes('Document'), 'Includes Document');
  assert.ok(words.includes('Title'), 'Includes Title');
  assert.ok(words.includes('Author'), 'Includes Author');
  assert.ok(words.includes('Name'), 'Includes Name');
  assert.ok(words.includes('Introduction'), 'Includes Introduction');
  assert.ok(words.includes('Write'), 'Includes Write');
  assert.ok(words.includes('content'), 'Includes content');
  assert.ok(words.includes('Buongiorno'), 'Includes Buongiorno');
  assert.ok(words.includes('italiano'), 'Includes italiano');
});
