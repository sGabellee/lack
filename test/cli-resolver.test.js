const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseCliArgs, resolveOpenAction } = require('../src/main/cli');

test('parseCliArgs extracts flags, positional arguments, and options', () => {
  const res1 = parseCliArgs(['report.pdf', '--template', 'ieee', '--name', 'My Paper', '--debug']);
  assert.equal(res1.positional, 'report.pdf');
  assert.equal(res1.template, 'ieee');
  assert.equal(res1.name, 'My Paper');
  assert.equal(res1.debug, true);

  const res2 = parseCliArgs(['--template=beamer', 'slides.pdf']);
  assert.equal(res2.positional, 'slides.pdf');
  assert.equal(res2.template, 'beamer');
});

test('Decision table: non-pdf files and empty args resolve to classic mode', async () => {
  const resEmpty = await resolveOpenAction({ rawArgv: [] });
  assert.equal(resEmpty.action, 'classic');

  const resTex = await resolveOpenAction({
    rawArgv: ['main.tex'],
    cwd: '/workspace',
    fsModule: {
      existsSync: () => true,
      statSync: () => ({ isDirectory: () => false })
    }
  });
  assert.equal(resTex.action, 'classic');
  assert.equal(resTex.openFilePath, path.normalize('/workspace/main.tex'));
});

test('Decision table: existing PDF with link and registry hit -> open-linked', async () => {
  const res = await resolveOpenAction({
    rawArgv: ['paper.pdf'],
    cwd: '/workspace',
    registry: {
      getProject: (id) => id === 'uuid-123' ? { storePath: '/stores/proj-uuid-123', name: 'Paper' } : null
    },
    readLinkFn: async () => ({ id: 'uuid-123', name: 'Paper', hasSnapshot: false }),
    fsModule: {
      existsSync: (p) => true,
      statSync: () => ({ isDirectory: () => false })
    }
  });

  assert.equal(res.action, 'open-linked');
  assert.equal(res.projectId, 'uuid-123');
  assert.equal(res.storePath, '/stores/proj-uuid-123');
});

test('Decision table: existing PDF with link but registry miss -> prompt-relink-or-restore', async () => {
  const res = await resolveOpenAction({
    rawArgv: ['foreign.pdf'],
    cwd: '/workspace',
    registry: {
      getProject: () => null
    },
    readLinkFn: async () => ({ id: 'uuid-missing', name: 'Lost Proj', hasSnapshot: true }),
    fsModule: {
      existsSync: () => true,
      statSync: () => ({ isDirectory: () => false })
    }
  });

  assert.equal(res.action, 'prompt-relink-or-restore');
  assert.equal(res.hasSnapshot, true);
});

test('Decision table: existing foreign PDF with no link -> prompt-claim-pdf', async () => {
  const res = await resolveOpenAction({
    rawArgv: ['foreign.pdf'],
    cwd: '/workspace',
    readLinkFn: async () => null,
    fsModule: {
      existsSync: () => true,
      statSync: () => ({ isDirectory: () => false })
    }
  });

  assert.equal(res.action, 'prompt-claim-pdf');
  assert.equal(res.targetPath, path.normalize('/workspace/foreign.pdf'));
});

test('Decision table: non-existent PDF creates new linked project', async () => {
  const res = await resolveOpenAction({
    rawArgv: ['new-doc.pdf', '--template', 'ieee'],
    cwd: '/workspace',
    fsModule: {
      existsSync: (p) => p === path.normalize('/workspace'), // parent exists, file doesn't
      statSync: () => ({ isDirectory: () => false })
    }
  });

  assert.equal(res.action, 'create-linked');
  assert.equal(res.targetPath, path.normalize('/workspace/new-doc.pdf'));
  assert.equal(res.template, 'ieee');
});

test('Decision table: parent directory missing produces Italian error', async () => {
  const res = await resolveOpenAction({
    rawArgv: ['nonexistent_dir/report.pdf'],
    cwd: '/workspace',
    fsModule: {
      existsSync: () => false
    }
  });

  assert.equal(res.action, 'error');
  assert.ok(res.message.includes('cartella genitore'));
});
