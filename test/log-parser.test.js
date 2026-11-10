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
