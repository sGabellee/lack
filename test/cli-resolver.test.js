const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseCliArgs, resolveLaunchArg, resolveOpenAction } = require('../src/main/cli');

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
      existsSync: (p) => p === path.normalize('/workspace'),
      statSync: () => ({ isDirectory: () => false })
    }
  });

  assert.equal(res.action, 'create-linked');
  assert.equal(res.targetPath, path.normalize('/workspace/new-doc.pdf'));
  assert.equal(res.template, 'ieee');
});

test('Decision table: parent directory missing produces Italian error', async () => {
  const res = await resolveOpenAction({
    rawArgv: ['nonexistent-dir/sub/doc.pdf'],
    cwd: '/workspace',
    fsModule: {
      existsSync: () => false
    }
  });

  assert.equal(res.action, 'error');
  assert.ok(res.message.includes('non esiste'));
});

test('Phase 2 Decision Table: resolveLaunchArg rows', async () => {
  const cwd = path.normalize('/workspace/project');

  // Row 1: lack NAME, no extension, path does not exist -> target <cwd>/NAME.pdf, create-linked
  const resRow1 = await resolveLaunchArg('prova1', cwd, {
    existsSync: (p) => p === cwd, // parent exists, prova1 and prova1.pdf don't
    statSync: () => ({ isDirectory: () => false })
  });
  assert.equal(resRow1.action, 'create-linked');
  assert.equal(resRow1.targetPath, path.join(cwd, 'prova1.pdf'));
  assert.equal(resRow1.name, 'prova1');

  // Row 2: lack NAME, NAME is an existing directory -> Classic folder open, unchanged
  const dirPath = path.join(cwd, 'somedir');
  const resRow2 = await resolveLaunchArg('somedir', cwd, {
    existsSync: (p) => p === dirPath,
    statSync: (p) => ({ isDirectory: () => p === dirPath })
  });
  assert.equal(resRow2.action, 'classic');
  assert.equal(resRow2.openFolderPath, dirPath);
  assert.equal(resRow2.openFilePath, null);

  // Row 3: lack NAME, NAME is an existing regular file without extension -> Classic open as plain text
  const plainFilePath = path.join(cwd, 'mybinary');
  const resRow3 = await resolveLaunchArg('mybinary', cwd, {
    existsSync: (p) => p === plainFilePath,
    statSync: (p) => ({ isDirectory: () => false })
  });
  assert.equal(resRow3.action, 'classic');
  assert.equal(resRow3.openFilePath, plainFilePath);

  // Row 4: lack NAME, NAME.pdf exists and is linked -> Open that project
  const pdfLinkedPath = path.join(cwd, 'report.pdf');
  const resRow4 = await resolveLaunchArg('report', cwd, {
    existsSync: (p) => p === pdfLinkedPath || p === '/stores/proj-rep-1',
    statSync: () => ({ isDirectory: () => false })
  }, {
    getProject: (id) => id === 'id-rep' ? { storePath: '/stores/proj-rep-1', name: 'report' } : null
  }, async () => ({ id: 'id-rep', name: 'report' }));
  assert.equal(resRow4.action, 'open-linked');
  assert.equal(resRow4.targetPath, pdfLinkedPath);
  assert.equal(resRow4.projectId, 'id-rep');

  // Row 5: lack NAME, NAME.pdf exists, not linked -> Round-3 dialog (prompt-claim-pdf)
  const resRow5 = await resolveLaunchArg('report', cwd, {
    existsSync: (p) => p === pdfLinkedPath,
    statSync: () => ({ isDirectory: () => false })
  }, null, async () => null);
  assert.equal(resRow5.action, 'prompt-claim-pdf');
  assert.equal(resRow5.targetPath, pdfLinkedPath);

  // Row 6: lack a/b/NAME -> parent a/b must exist (else Italian error); target a/b/NAME.pdf
  const missingParent = path.join(cwd, 'missing', 'sub');
  const resRow6Missing = await resolveLaunchArg('missing/sub/doc', cwd, {
    existsSync: (p) => p === cwd
  });
  assert.equal(resRow6Missing.action, 'error');
  assert.ok(resRow6Missing.message.includes('non esiste'));

  const existingParent = path.join(cwd, 'a', 'b');
  const resRow6Ok = await resolveLaunchArg('a/b/doc', cwd, {
    existsSync: (p) => p === existingParent || p === cwd,
    statSync: () => ({ isDirectory: () => false })
  });
  assert.equal(resRow6Ok.action, 'create-linked');
  assert.equal(resRow6Ok.targetPath, path.join(existingParent, 'doc.pdf'));

  // Row 7: lack NAME.tex -> Classic, unchanged
  const texPath = path.join(cwd, 'paper.tex');
  const resRow7 = await resolveLaunchArg('paper.tex', cwd, {
    existsSync: () => false
  });
  assert.equal(resRow7.action, 'classic');
  assert.equal(resRow7.openFilePath, texPath);

  // Paths with spaces
  const spaceArg = 'my folder/my report';
  const spaceDir = path.join(cwd, 'my folder');
  const resSpace = await resolveLaunchArg(spaceArg, cwd, {
    existsSync: (p) => p === spaceDir || p === cwd,
    statSync: () => ({ isDirectory: () => false })
  });
  assert.equal(resSpace.action, 'create-linked');
  assert.equal(resSpace.targetPath, path.join(spaceDir, 'my report.pdf'));
});
