const test = require('node:test');
const assert = require('assert');
const path = require('path');
const { resolveLaunch, extractPositional } = require('../src/main/launch-resolver');

test('extractPositional separates flags and positional targets', () => {
  const { positional, flags } = extractPositional(['node', 'main.js', '--debug', '--template=ieee', 'my-doc.pdf']);
  assert.strictEqual(positional, 'my-doc.pdf');
  assert.strictEqual(flags.debug, true);
  assert.strictEqual(flags.template, 'ieee');
});

test('Decision table: CLI lack (no args) -> Start screen', () => {
  const res = resolveLaunch({
    argv: ['lack'],
    env: { LACK_LAUNCHED_FROM: 'cli', LACK_CWD: '/home/user/work' },
    probe: {}
  });
  assert.strictEqual(res.action, 'start-screen');
  assert.strictEqual(res.openFolder, null);
  assert.strictEqual(res.openFile, null);
  assert.strictEqual(res.isCli, true);
});

test('Decision table: CLI lack . (current folder) -> Open folder with conversion check', () => {
  const mockDirs = new Set(['/home/user/work']);
  const res = resolveLaunch({
    argv: ['lack', '.'],
    env: { LACK_LAUNCHED_FROM: 'cli', LACK_CWD: '/home/user/work' },
    probe: {
      existsSync: (p) => mockDirs.has(p),
      statSync: (p) => ({ isDirectory: () => mockDirs.has(p), isFile: () => !mockDirs.has(p) }),
      hasTexFiles: (p) => p === '/home/user/work'
    }
  });
  assert.strictEqual(res.action, 'open-folder');
  assert.strictEqual(res.openFolder, '/home/user/work');
  assert.strictEqual(res.openFile, null);
  assert.strictEqual(res.offerConversion, true);
});

test('Decision table: CLI lack file.tex (exists) -> Open file, parent folder, no conversion offer', () => {
  const mockFiles = new Set(['/home/user/work/main.tex']);
  const res = resolveLaunch({
    argv: ['lack', 'main.tex'],
    env: { LACK_LAUNCHED_FROM: 'cli', LACK_CWD: '/home/user/work' },
    probe: {
      existsSync: (p) => mockFiles.has(p),
      statSync: (p) => ({ isDirectory: () => false, isFile: () => true })
    }
  });
  assert.strictEqual(res.action, 'open-file');
  assert.strictEqual(res.openFile, '/home/user/work/main.tex');
  assert.strictEqual(res.openFolder, '/home/user/work');
  assert.strictEqual(res.offerConversion, false);
});

test('Decision table: CLI lack new.tex (does not exist, parent exists) -> bind-buffer createOnSave', () => {
  const mockDirs = new Set(['/home/user/work']);
  const res = resolveLaunch({
    argv: ['lack', 'new.tex'],
    env: { LACK_LAUNCHED_FROM: 'cli', LACK_CWD: '/home/user/work' },
    probe: {
      existsSync: (p) => mockDirs.has(p),
      statSync: (p) => ({ isDirectory: () => mockDirs.has(p), isFile: () => !mockDirs.has(p) })
    }
  });
  assert.strictEqual(res.action, 'bind-buffer');
  assert.strictEqual(res.openFile, '/home/user/work/new.tex');
  assert.strictEqual(res.openFolder, '/home/user/work');
  assert.strictEqual(res.createOnSave, true);
});

test('Decision table: CLI lack NAME (extensionless, does not exist) -> create-linked PDF', () => {
  const mockDirs = new Set(['/home/user/work']);
  const res = resolveLaunch({
    argv: ['lack', 'report'],
    env: { LACK_LAUNCHED_FROM: 'cli', LACK_CWD: '/home/user/work' },
    probe: {
      existsSync: (p) => mockDirs.has(p),
      statSync: (p) => ({ isDirectory: () => mockDirs.has(p), isFile: () => !mockDirs.has(p) })
    }
  });
  assert.strictEqual(res.action, 'create-linked');
  assert.strictEqual(res.targetPath, '/home/user/work/report.pdf');
  assert.strictEqual(res.name, 'report');
});

test('Decision table: GUI launch with no args (Dock, .desktop, npm start) -> Start screen, cwd ignored', () => {
  const res = resolveLaunch({
    argv: ['electron', '.'],
    env: { PWD: '/home/user/random-folder' }, // Notice: LACK_LAUNCHED_FROM is NOT 'cli'
    probe: {
      existsSync: () => true,
      statSync: () => ({ isDirectory: () => true })
    }
  });
  assert.strictEqual(res.action, 'start-screen');
  assert.strictEqual(res.openFolder, null);
  assert.strictEqual(res.openFile, null);
  assert.strictEqual(res.isCli, false);
});

test('Decision table: GUI launch with absolute path to file -> open-file', () => {
  const filePath = '/home/user/documents/paper.tex';
  const mockFiles = new Set([filePath]);
  const res = resolveLaunch({
    argv: ['lack', filePath],
    env: {}, // GUI launch
    probe: {
      existsSync: (p) => mockFiles.has(p),
      statSync: (p) => ({ isDirectory: () => false, isFile: () => true })
    }
  });
  assert.strictEqual(res.action, 'open-file');
  assert.strictEqual(res.openFile, filePath);
  assert.strictEqual(res.openFolder, '/home/user/documents');
});

test('Decision table: GUI launch with absolute path to folder -> open-folder', () => {
  const folderPath = '/home/user/documents/my-project';
  const mockDirs = new Set([folderPath]);
  const res = resolveLaunch({
    argv: ['lack', folderPath],
    env: {}, // GUI launch
    probe: {
      existsSync: (p) => mockDirs.has(p),
      statSync: (p) => ({ isDirectory: () => true, isFile: () => false }),
      hasTexFiles: (p) => true
    }
  });
  assert.strictEqual(res.action, 'open-folder');
  assert.strictEqual(res.openFolder, folderPath);
  assert.strictEqual(res.offerConversion, true);
});
