const test = require('node:test');
const assert = require('node:assert');
const { parseLatexLog } = require('../latex-compiler.js');

test('parses file-line-error format correctly', () => {
  const sampleLog = `
(./chapters/intro.tex
./chapters/intro.tex:14: Undefined control sequence.
l.14 \\secction{Inizio}
)
`;
  const issues = parseLatexLog(sampleLog);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].file, 'intro.tex');
  assert.strictEqual(issues[0].line, 14);
  assert.strictEqual(issues[0].message, 'Undefined control sequence.');
});

test('parses standard TeX ! errors with l.NN context', () => {
  const sampleLog = `
This is pdfTeX, Version 3.141592653
(./main.tex
! Missing $ inserted.
<to be read again> 
                   \\alpha 
l.25 \\begin{equation} \\alpha
                              \\end{equation}
)
`;
  const issues = parseLatexLog(sampleLog);
  assert.ok(issues.length >= 1);
  assert.strictEqual(issues[0].line, 25);
  assert.strictEqual(issues[0].message, 'Missing $ inserted.');
});

test('detects missing package / sty file errors', () => {
  const sampleLog = `
(./main.tex
! LaTeX Error: File 'cleverref.sty' not found.

Type X to quit or <RETURN> to proceed.
`;
  const issues = parseLatexLog(sampleLog);
  assert.ok(issues.length >= 1);
  assert.ok(issues[0].message.includes("File 'cleverref.sty' not found"));
});

test('tracks multi-paren log lines accurately and deduplicates tectonic error summary', () => {
  const sampleLog = `Running TeX ...
error: report.tex:20: ! LaTeX Error: File 'utils/front.tex' not found.
error: something bad happened inside XeTeX; its output follows:
(report.tex
(article.cls (size12.clo)) (nameref.sty (refcount.sty) (gettitlestring.sty))
! ! LaTeX Error: File 'utils/front.tex' not found..
l.20 \\input{utils/front.tex}
`;
  const issues = parseLatexLog(sampleLog);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].file, 'report.tex');
  assert.strictEqual(issues[0].line, 20);
  assert.strictEqual(issues[0].type, 'error');
});

test('parses extensionless tectonic subfile warning preserving rawFile path', () => {
  const sampleLog = `warning: sections/Ass1_1:57: Overfull \\hbox (0.75818pt too wide) in paragraph at lines 56--57`;
  const issues = parseLatexLog(sampleLog);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].file, 'Ass1_1');
  assert.strictEqual(issues[0].rawFile, 'sections/Ass1_1');
  assert.strictEqual(issues[0].line, 57);
  assert.strictEqual(issues[0].type, 'box');
});
