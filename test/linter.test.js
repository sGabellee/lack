const test = require('node:test');
const assert = require('node:assert');
const { lintLatexDocument, levenshteinDistance } = require('../src/editor/linter-logic.js');

test('flags misspelled command and offers Levenshtein fix', () => {
  const input = `\\documentclass{article}
\\begin{document}
\\secction{Introduzione}
Testo del documento.
\\end{document}`;

  const diags = lintLatexDocument(input);
  assert.ok(diags.length > 0, 'Should find diagnostic for \\secction');

  const secDiag = diags.find(d => d.message.includes('\\secction'));
  assert.ok(secDiag, 'Should flag \\secction');
  assert.ok(secDiag.message.includes('! Undefined control sequence.'));
  assert.ok(secDiag.message.includes('Did you mean \\section?'));
  assert.strictEqual(secDiag.actions[0].name, 'Did you mean \\section?');
});

test('recognizes package-specific commands when package is loaded', () => {
  const withoutPkg = `\\documentclass{article}
\\begin{document}
$\\mathbb{R}$
\\end{document}`;
  const diagsWithout = lintLatexDocument(withoutPkg);
  assert.ok(diagsWithout.some(d => d.message.includes('\\mathbb')), 'Should flag \\mathbb without amssymb');

  const withPkg = `\\documentclass{article}
\\usepackage{amssymb}
\\begin{document}
$\\mathbb{R}$
\\end{document}`;
  const diagsWith = lintLatexDocument(withPkg);
  assert.ok(!diagsWith.some(d => d.message.includes('\\mathbb')), 'Should allow \\mathbb when amssymb is loaded');
});

test('recognizes amsthm and amsmath commands without false positives', () => {
  const amsDoc = `\\documentclass{article}
\\usepackage{amsmath,amssymb,amsthm}
\\theoremstyle{plain}
\\newtheorem{theorem}{Theorem}
\\theoremstyle{definition}
\\newtheorem{definition}{Definition}
\\begin{document}
\\langle x, y \\rangle \\implies \\hbar \\mkern 2mu
\\begin{proof}
Proof content.
\\end{proof}
\\end{document}`;

  const diags = lintLatexDocument(amsDoc);
  assert.strictEqual(diags.length, 0, 'Should have 0 diagnostics for standard amsthm/amsmath document');
});

test('recognizes locally defined macros', () => {

  const input = `\\documentclass{article}
\\newcommand{\\custommacro}{Valore}
\\def\\anothermacro{Test}
\\begin{document}
\\custommacro e \\anothermacro
\\end{document}`;

  const diags = lintLatexDocument(input);
  assert.strictEqual(diags.length, 0, 'Should allow locally defined macros');
});

test('flags mismatched begin and end environments', () => {
  const input = `\\documentclass{article}
\\begin{document}
\\begin{itemize}
\\item elemento
\\end{enumerate}
\\end{document}`;

  const diags = lintLatexDocument(input);
  const mismatch = diags.find(d => d.message.includes('ended by \\end{enumerate}'));
  assert.ok(mismatch, 'Should flag environment mismatch');
});

test('flags unbalanced braces', () => {
  const input = `\\documentclass{article}
\\begin{document}
Testo con {parentesi aperta non chiusa.
\\end{document}`;

  const diags = lintLatexDocument(input);
  const braceDiag = diags.find(d => d.message.includes('Missing }'));
  assert.ok(braceDiag, 'Should flag unclosed brace');
});

test('recognizes pgfplots/siunitx packages and ignores text after \\\\ linebreaks', () => {
  const input = `\\documentclass{article}
\\usepackage{pgfplots}
\\usepackage{siunitx}
\\pgfplotsset{compat=1.17}
\\sisetup{output-decimal-marker={.}}
\\begin{document}
{\\large \\textbf{Students} \\\\Alice Smith \\\\Bob Jones\\\\}
Power: \\SI{27.6}{mW}, \\micro s, \\percent.
\\end{document}`;

  const diags = lintLatexDocument(input);
  assert.strictEqual(diags.length, 0, 'Should produce 0 false diagnostics for pgfplots, siunitx, and \\\\ linebreaks');
});

test('subfiles inherit loaded packages and macros from preambleText', () => {
  const mainDoc = `\\documentclass{article}
\\usepackage{graphicx,booktabs,siunitx}
\\newcommand{\\mybadge}{OK}`;
  const subfile = `\\section{Results}
\\includegraphics[width=5cm]{images/logo.png}
\\begin{tabular}{cc}\\toprule A & \\SI{10}{ms} \\\\ \\bottomrule\\end{tabular}
\\mybadge`;

  const diags = lintLatexDocument(subfile, { preambleText: mainDoc });
  assert.strictEqual(diags.length, 0, 'Subfile should inherit packages and macros from main preamble');
});
