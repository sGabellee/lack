const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  computeFileSha256,
  moveFileSafe,
  scanLatexFolder,
  findLatexDependencies,
  recordMoveJournal,
  undoMoveJournal,
  resolveCollisionSafePdfTarget
} = require('../src/projects/import');

test('moveFileSafe: copy -> verify size + sha256 -> delete original', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-safe-move-'));
  const srcFile = path.join(tmpDir, 'source.txt');
  const destFile = path.join(tmpDir, 'subdir', 'dest.txt');

  const content = 'Hello Data Safety Rule!';
  fs.writeFileSync(srcFile, content, 'utf8');
  const origHash = computeFileSha256(srcFile);

  const res = moveFileSafe(srcFile, destFile);
  assert.strictEqual(res.sha256, origHash);
  assert.strictEqual(fs.existsSync(srcFile), false, 'Original must be deleted after verification');
  assert.strictEqual(fs.existsSync(destFile), true);
  assert.strictEqual(fs.readFileSync(destFile, 'utf8'), content);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scanLatexFolder: discovers main.tex and candidate with documentclass', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-scan-'));
  fs.writeFileSync(path.join(tmpDir, 'chapter.tex'), '\\section{Chapter 1}\nSome content');
  fs.writeFileSync(path.join(tmpDir, 'main.tex'), '\\documentclass{article}\n\\begin{document}\n\\input{chapter}\n\\end{document}');

  const res = scanLatexFolder(tmpDir);
  assert.strictEqual(res.candidateMain, 'main.tex');
  assert.strictEqual(res.texFiles.length, 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('findLatexDependencies: captures inputs, graphics, and bibs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-deps-'));
  const mainPath = path.join(tmpDir, 'main.tex');
  const subPath = path.join(tmpDir, 'intro.tex');
  const imgPath = path.join(tmpDir, 'fig1.png');
  const bibPath = path.join(tmpDir, 'refs.bib');

  fs.writeFileSync(mainPath, '\\documentclass{article}\n\\input{intro}\n\\includegraphics{fig1}\n\\bibliography{refs}\n');
  fs.writeFileSync(subPath, 'Intro section');
  fs.writeFileSync(imgPath, 'PNG_DATA');
  fs.writeFileSync(bibPath, '@article{...}');

  const deps = findLatexDependencies(mainPath, tmpDir);
  assert.strictEqual(deps.has(path.resolve(subPath)), true);
  assert.strictEqual(deps.has(path.resolve(imgPath)), true);
  assert.strictEqual(deps.has(path.resolve(bibPath)), true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Move Journal and Undo: reverts moved files safely', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-journal-'));
  const journalDir = path.join(tmpDir, 'journal');
  const origFile = path.join(tmpDir, 'original.tex');
  const storeFile = path.join(tmpDir, 'store', 'original.tex');

  fs.writeFileSync(origFile, 'Content to be moved and undone');
  const op = moveFileSafe(origFile, storeFile);

  const jPath = recordMoveJournal(journalDir, {
    operations: [op]
  });

  assert.strictEqual(fs.existsSync(jPath), true);
  assert.strictEqual(fs.existsSync(origFile), false);

  const reverted = undoMoveJournal(jPath);
  assert.strictEqual(reverted.length, 1);
  assert.strictEqual(fs.existsSync(origFile), true);
  assert.strictEqual(fs.existsSync(storeFile), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveCollisionSafePdfTarget: target-collision rule creates uniqueName for unlinked collision', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-collision-'));
  const existingPdf = path.join(tmpDir, 'report.pdf');
  fs.writeFileSync(existingPdf, '%PDF-1.4 dummy');

  // Case 1: unlinked existing PDF -> collision detected, returns uniqueName
  const res1 = resolveCollisionSafePdfTarget(tmpDir, 'report', 'proj-123', () => null);
  assert.strictEqual(res1.collided, true);
  assert.strictEqual(path.basename(res1.targetPath), 'report-1.pdf');

  // Case 2: existing PDF is linked to the same project -> overwrite allowed
  const res2 = resolveCollisionSafePdfTarget(tmpDir, 'report', 'proj-123', () => ({ id: 'proj-123' }));
  assert.strictEqual(res2.collided, false);
  assert.strictEqual(res2.targetPath, existingPdf);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
