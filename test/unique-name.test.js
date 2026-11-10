const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { uniqueName, validateItemName } = require('../src/projects/ui-controller');

test('uniqueName table: free, taken, taken with suffixes, gaps, case-insensitive, ending in -3', () => {
  // Mock FS probe
  const makeMockFs = (existingFiles) => ({
    existsSync: (dir) => true,
    readdirSync: (dir) => [...existingFiles]
  });

  // 1. Free name
  let mockFs = makeMockFs([]);
  assert.equal(uniqueName('/tmp', 'new_file', '.tex', mockFs), 'new_file.tex');

  // 2. Taken once
  mockFs = makeMockFs(['new_file.tex']);
  assert.equal(uniqueName('/tmp', 'new_file', '.tex', mockFs), 'new_file-1.tex');

  // 3. Taken with suffixes -1, -2
  mockFs = makeMockFs(['new_file.tex', 'new_file-1.tex', 'new_file-2.tex']);
  assert.equal(uniqueName('/tmp', 'new_file', '.tex', mockFs), 'new_file-3.tex');

  // 4. Gaps in suffixes: -1 is missing, -2 exists
  mockFs = makeMockFs(['new_file.tex', 'new_file-2.tex']);
  assert.equal(uniqueName('/tmp', 'new_file', '.tex', mockFs), 'new_file-1.tex');

  // 5. Name already ending in -3: strips -3 and finds smallest free n >= 1
  mockFs = makeMockFs(['new_file.tex']);
  assert.equal(uniqueName('/tmp', 'new_file-3', '.tex', mockFs), 'new_file-1.tex');

  mockFs = makeMockFs([]);
  assert.equal(uniqueName('/tmp', 'new_file-3', '.tex', mockFs), 'new_file.tex');

  // 6. Case-insensitive filesystem check on darwin/win32
  mockFs = makeMockFs(['NEW_FILE.TEX']);
  assert.equal(uniqueName('/tmp', 'new_file', '.tex', mockFs, 'darwin'), 'new_file-1.tex');
  assert.equal(uniqueName('/tmp', 'new_file', '.tex', mockFs, 'win32'), 'new_file-1.tex');

  // 7. Folder uniqueName without extension
  mockFs = makeMockFs(['new_folder']);
  assert.equal(uniqueName('/tmp', 'new_folder', '', mockFs), 'new_folder-1');
});

test('validateItemName checks Windows reserved names, invalid chars, dot/dotdot, and length', () => {
  assert.strictEqual(validateItemName('').valid, false);
  assert.strictEqual(validateItemName('   ').valid, false);
  assert.strictEqual(validateItemName('.').valid, false);
  assert.strictEqual(validateItemName('..').valid, false);
  assert.strictEqual(validateItemName('foo/bar').valid, false);
  assert.strictEqual(validateItemName('foo\\bar').valid, false);
  assert.strictEqual(validateItemName('test:file').valid, false);
  assert.strictEqual(validateItemName('file*name').valid, false);
  assert.strictEqual(validateItemName('CON').valid, false);
  assert.strictEqual(validateItemName('con.tex').valid, false);
  assert.strictEqual(validateItemName('aux').valid, false);
  assert.strictEqual(validateItemName('NUL').valid, false);
  assert.strictEqual(validateItemName('prn.bib').valid, false);
  assert.strictEqual(validateItemName('COM1').valid, false);
  assert.strictEqual(validateItemName('a'.repeat(256)).valid, false);

  const ok = validateItemName('valid_filename.tex');
  assert.strictEqual(ok.valid, true);
  assert.strictEqual(ok.name, 'valid_filename.tex');
});

test('selection range: new_file.tex selection range is [0, 8]', () => {
  const defaultFileName = 'new_file.tex';
  const dotIndex = defaultFileName.lastIndexOf('.tex');
  assert.equal(dotIndex, 8);
  const selStart = 0;
  const selEnd = dotIndex;
  assert.equal(defaultFileName.slice(selStart, selEnd), 'new_file');
});
