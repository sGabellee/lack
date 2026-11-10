const test = require('node:test');
const assert = require('node:assert/strict');

// Logic controller for Save & Compile
function isCompilableLatexFile(filePath) {
  if (!filePath) return false;
  return /\.(tex|bib|sty|cls|bst|dtx|ins)$/i.test(filePath);
}

async function handleSaveAndCompile({
  tab,
  compileOnSave = true,
  saveFileFn,
  triggerCompileFn,
  cancelAutoCompileFn
}) {
  if (!tab) return { saved: false, compiled: false };

  // 1. Cancel pending auto-compile timer
  if (typeof cancelAutoCompileFn === 'function') {
    cancelAutoCompileFn();
  }

  // 2. Perform file save
  let saveResult;
  try {
    saveResult = await saveFileFn(tab);
  } catch (err) {
    return { saved: false, compiled: false, error: err };
  }

  if (!saveResult || !saveResult.success) {
    return { saved: false, compiled: false };
  }

  // 3. Check if compilable file and compileOnSave is active
  const filePath = tab.filePath || saveResult.filePath;
  if (!isCompilableLatexFile(filePath) || !compileOnSave) {
    return { saved: true, compiled: false };
  }

  // 4. Trigger compile (never block or fail save if compile throws)
  let compileResult = false;
  try {
    compileResult = await triggerCompileFn();
  } catch (err) {
    // Log error, but save remains successful
    compileResult = false;
  }

  return { saved: true, compiled: compileResult };
}

test('isCompilableLatexFile identifies latex sources', () => {
  assert.equal(isCompilableLatexFile('main.tex'), true);
  assert.equal(isCompilableLatexFile('refs.bib'), true);
  assert.equal(isCompilableLatexFile('style.sty'), true);
  assert.equal(isCompilableLatexFile('book.cls'), true);
  assert.equal(isCompilableLatexFile('plain.bst'), true);
  assert.equal(isCompilableLatexFile('mac-install.sh'), false);
  assert.equal(isCompilableLatexFile('app.js'), false);
  assert.equal(isCompilableLatexFile('readme.md'), false);
  assert.equal(isCompilableLatexFile('doc.pdf'), false);
});

test('Ctrl+S saves and compiles once when compileOnSave is true', async () => {
  let saveCount = 0;
  let compileCount = 0;
  let timerCancelled = false;

  const tab = { title: 'main.tex', filePath: '/path/main.tex', content: '\\hello' };

  const res = await handleSaveAndCompile({
    tab,
    compileOnSave: true,
    saveFileFn: async () => { saveCount++; return { success: true }; },
    triggerCompileFn: async () => { compileCount++; return true; },
    cancelAutoCompileFn: () => { timerCancelled = true; }
  });

  assert.equal(res.saved, true);
  assert.equal(res.compiled, true);
  assert.equal(saveCount, 1);
  assert.equal(compileCount, 1);
  assert.equal(timerCancelled, true);
});

test('Ctrl+S saves but does NOT compile when compileOnSave is false', async () => {
  let saveCount = 0;
  let compileCount = 0;

  const tab = { title: 'main.tex', filePath: '/path/main.tex', content: '\\hello' };

  const res = await handleSaveAndCompile({
    tab,
    compileOnSave: false,
    saveFileFn: async () => { saveCount++; return { success: true }; },
    triggerCompileFn: async () => { compileCount++; return true; }
  });

  assert.equal(res.saved, true);
  assert.equal(res.compiled, false);
  assert.equal(saveCount, 1);
  assert.equal(compileCount, 0);
});

test('Ctrl+S saves non-latex files without compiling', async () => {
  let saveCount = 0;
  let compileCount = 0;

  const tab = { title: 'mac-install.sh', filePath: '/path/mac-install.sh', content: '#!/bin/bash' };

  const res = await handleSaveAndCompile({
    tab,
    compileOnSave: true,
    saveFileFn: async () => { saveCount++; return { success: true }; },
    triggerCompileFn: async () => { compileCount++; return true; }
  });

  assert.equal(res.saved, true);
  assert.equal(res.compiled, false);
  assert.equal(saveCount, 1);
  assert.equal(compileCount, 0);
});

test('Save succeeds even if compile throws an exception', async () => {
  let saveCount = 0;

  const tab = { title: 'main.tex', filePath: '/path/main.tex', content: '\\invalid' };

  const res = await handleSaveAndCompile({
    tab,
    compileOnSave: true,
    saveFileFn: async () => { saveCount++; return { success: true }; },
    triggerCompileFn: async () => { throw new Error('TeX engine crashed'); }
  });

  assert.equal(res.saved, true);
  assert.equal(res.compiled, false);
  assert.equal(saveCount, 1);
});

module.exports = {
  isCompilableLatexFile,
  handleSaveAndCompile
};
