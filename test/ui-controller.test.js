const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  formatBytes,
  calculateDirSize,
  isCompilableLatexFile,
  filterProjectEntries,
  validateItemName
} = require('../src/projects/ui-controller.js');

test('ui-controller: formatBytes', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(500), '500 B');
  assert.strictEqual(formatBytes(1024), '1 KB');
  assert.strictEqual(formatBytes(1536), '1.5 KB');
  assert.strictEqual(formatBytes(1048576), '1 MB');
  assert.strictEqual(formatBytes(1073741824), '1 GB');
});

test('ui-controller: calculateDirSize', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-calc-size-'));
  fs.writeFileSync(path.join(tmpDir, 'a.tex'), 'Hello'); // 5 bytes
  const sub = path.join(tmpDir, 'sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'b.txt'), 'World!'); // 6 bytes

  const size = calculateDirSize(tmpDir);
  assert.strictEqual(size, 11);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ui-controller: isCompilableLatexFile', () => {
  assert.strictEqual(isCompilableLatexFile('main.tex'), true);
  assert.strictEqual(isCompilableLatexFile('/path/to/ref.bib'), true);
  assert.strictEqual(isCompilableLatexFile('custom.sty'), true);
  assert.strictEqual(isCompilableLatexFile('article.cls'), true);
  assert.strictEqual(isCompilableLatexFile('plain.bst'), true);

  assert.strictEqual(isCompilableLatexFile('mac-install.sh'), false);
  assert.strictEqual(isCompilableLatexFile('package.json'), false);
  assert.strictEqual(isCompilableLatexFile('README.md'), false);
  assert.strictEqual(isCompilableLatexFile('image.png'), false);
  assert.strictEqual(isCompilableLatexFile(null), false);
  assert.strictEqual(isCompilableLatexFile(''), false);
});

test('ui-controller: filterProjectEntries excludes dotfiles and sorts directories first', () => {
  const entries = [
    { name: 'document.tex', isDirectory: () => false },
    { name: '.lack', isDirectory: () => true },
    { name: 'figures', isDirectory: () => true },
    { name: '.git', isDirectory: () => true },
    { name: 'chapters', isDirectory: () => true },
    { name: 'references.bib', isDirectory: () => false }
  ];

  const filtered = filterProjectEntries(entries);
  assert.deepStrictEqual(filtered.map(e => e.name), [
    'chapters',
    'figures',
    'document.tex',
    'references.bib'
  ]);
});

test('ui-controller: validateItemName', () => {
  assert.strictEqual(validateItemName('').valid, false);
  assert.strictEqual(validateItemName('   ').valid, false);
  assert.strictEqual(validateItemName('.').valid, false);
  assert.strictEqual(validateItemName('..').valid, false);
  assert.strictEqual(validateItemName('foo/bar').valid, false);
  assert.strictEqual(validateItemName('foo*bar').valid, false);
  assert.strictEqual(validateItemName('foo:bar').valid, false);

  const ok = validateItemName('  chapter1.tex  ');
  assert.strictEqual(ok.valid, true);
  assert.strictEqual(ok.name, 'chapter1.tex');
});
