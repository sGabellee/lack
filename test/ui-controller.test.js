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
  validateItemName,
  isTexFilePath,
  isPathInsideDir,
  resolveMainRelativePath,
  canSetAsMainDocument,
  resolveClassicCompileTarget,
  resolveExportPdfDefaultName,
  listStoreTexFiles
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
    { name: 'project.json', isDirectory: () => false },
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

test('ui-controller: isTexFilePath and isPathInsideDir', () => {
  assert.strictEqual(isTexFilePath('main.tex'), true);
  assert.strictEqual(isTexFilePath('/tmp/CHAPTER.TEX'), true);
  assert.strictEqual(isTexFilePath('sections/intro.TeX'), true);
  assert.strictEqual(isTexFilePath('report.pdf'), false);
  assert.strictEqual(isTexFilePath('refs.bib'), false);
  assert.strictEqual(isTexFilePath(null), false);

  assert.strictEqual(isPathInsideDir('/tmp/proj/sections/ch1.tex', '/tmp/proj'), true);
  assert.strictEqual(isPathInsideDir('/tmp/proj', '/tmp/proj'), true);
  assert.strictEqual(isPathInsideDir('/tmp/proj2/main.tex', '/tmp/proj'), false);
  assert.strictEqual(isPathInsideDir(null, '/tmp/proj'), false);
});

test('ui-controller: resolveMainRelativePath and canSetAsMainDocument', () => {
  const store = path.join('/tmp', 'lack-store-1');
  assert.strictEqual(
    resolveMainRelativePath(store, path.join(store, 'sections', 'main2.tex')),
    'sections/main2.tex'
  );
  assert.strictEqual(
    resolveMainRelativePath(store, path.join('/tmp', 'elsewhere', 'main.tex')),
    null
  );

  assert.strictEqual(
    canSetAsMainDocument({
      filePath: path.join(store, 'altro.tex'),
      isDir: false,
      isMain: false,
      isLinkedProject: true,
      storePath: store
    }),
    true
  );
  assert.strictEqual(
    canSetAsMainDocument({
      filePath: path.join(store, 'altro.tex'),
      isDir: false,
      isMain: true,
      isLinkedProject: true,
      storePath: store
    }),
    false
  );
  assert.strictEqual(
    canSetAsMainDocument({
      filePath: '/tmp/outside/other.tex',
      isDir: false,
      isMain: false,
      isLinkedProject: true,
      storePath: store
    }),
    false
  );
  assert.strictEqual(
    canSetAsMainDocument({
      filePath: '/tmp/classic/chapter1.tex',
      isDir: false,
      isMain: false,
      isLinkedProject: false
    }),
    true
  );
  assert.strictEqual(
    canSetAsMainDocument({
      filePath: '/tmp/classic/chapter1.pdf',
      isDir: false,
      isMain: false,
      isLinkedProject: false
    }),
    false
  );
  assert.strictEqual(
    canSetAsMainDocument({
      filePath: '/tmp/classic/sections.tex',
      isDir: true,
      isMain: false,
      isLinkedProject: false
    }),
    false
  );
});

test('ui-controller: resolveClassicCompileTarget and resolveExportPdfDefaultName', () => {
  const projDir = '/tmp/my-classic';
  const mainTex = '/tmp/my-classic/custom_main.tex';
  const subTex = '/tmp/my-classic/sections/sec1.tex';
  const standaloneTex = '/tmp/my-classic/notes.tex';

  // Explicit main overrides even standalone active tab
  assert.strictEqual(
    resolveClassicCompileTarget({
      activeTab: { filePath: standaloneTex, content: '\\documentclass{article}\n\\begin{document}hi\\end{document}' },
      mainDocumentPath: mainTex,
      currentProjectDir: projDir,
      mainDocumentExplicit: true,
      fileExists: () => true
    }),
    mainTex
  );

  // Implicit main compiles when editing subfile without \documentclass
  assert.strictEqual(
    resolveClassicCompileTarget({
      activeTab: { filePath: subTex, content: '\\section{Intro}' },
      mainDocumentPath: mainTex,
      currentProjectDir: projDir,
      mainDocumentExplicit: false,
      fileExists: () => true
    }),
    mainTex
  );

  // Implicit main lets another standalone document in same folder compile itself
  assert.strictEqual(
    resolveClassicCompileTarget({
      activeTab: { filePath: standaloneTex, content: '\\documentclass[12pt]{report}' },
      mainDocumentPath: mainTex,
      currentProjectDir: projDir,
      mainDocumentExplicit: false,
      fileExists: () => true
    }),
    standaloneTex
  );

  // Export PDF keeps targetPath name in linked project even after switching main .tex
  assert.strictEqual(
    resolveExportPdfDefaultName({
      isLinkedProject: true,
      targetPath: '/home/user/docs/report.pdf',
      currentCompiledPdfPath: '/home/user/store/.lack/build/altro_main.pdf'
    }),
    'report.pdf'
  );
  assert.strictEqual(
    resolveExportPdfDefaultName({
      isLinkedProject: false,
      targetPath: null,
      currentCompiledPdfPath: '/home/user/docs/.lack/build/tesi.pdf'
    }),
    'tesi.pdf'
  );
});

test('ui-controller: listStoreTexFiles discovers root and nested tex files cleanly', () => {
  const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-list-tex-'));
  try {
    fs.mkdirSync(path.join(tmpStore, '.lack', 'build'), { recursive: true });
    fs.mkdirSync(path.join(tmpStore, 'sections'), { recursive: true });
    fs.writeFileSync(path.join(tmpStore, '.lack', 'build', 'temp.tex'), '');
    fs.writeFileSync(path.join(tmpStore, 'project.json'), '{}');
    fs.writeFileSync(path.join(tmpStore, 'report.tex'), '\\documentclass{article}');
    fs.writeFileSync(path.join(tmpStore, 'altro.TEX'), '\\documentclass{article}');
    fs.writeFileSync(path.join(tmpStore, 'notes.md'), '# ignore');
    fs.writeFileSync(path.join(tmpStore, 'sections', 'sub.tex'), '\\section{Sub}');

    const listed = listStoreTexFiles(tmpStore);
    assert.deepStrictEqual(
      listed.map(x => x.relPath),
      ['sections/sub.tex', 'altro.TEX', 'report.tex']
    );
  } finally {
    fs.rmSync(tmpStore, { recursive: true, force: true });
  }
});
