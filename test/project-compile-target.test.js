const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ProjectRegistry } = require('../src/projects/registry');
const { ProjectManager } = require('../src/projects/manager');
const { PDFDocument } = require('pdf-lib');
const { parseCliArgs, resolveLaunchArg } = require('../src/main/cli');

test('ProjectRegistry: targetPath is always normalized and exposed on project records', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-target-test-'));
  const regFile = path.join(tmpDir, 'projects.json');
  const storeRoot = path.join(tmpDir, 'Lack Projects');
  fs.mkdirSync(storeRoot, { recursive: true });

  const registry = new ProjectRegistry(regFile, storeRoot);

  const saved = registry.saveProjectEntry('proj-uuid-999', {
    storePath: path.join(storeRoot, 'test-proj'),
    name: 'Research Paper',
    lastPdfPath: '/home/user/docs/research.pdf'
  });

  assert.equal(saved.targetPath, '/home/user/docs/research.pdf');
  assert.equal(saved.lastPdfPath, '/home/user/docs/research.pdf');

  const retrieved = registry.getProject('proj-uuid-999');
  assert.ok(retrieved);
  assert.equal(retrieved.targetPath, '/home/user/docs/research.pdf');

  const list = registry.listProjects();
  assert.equal(list.length, 1);
  assert.equal(list[0].targetPath, '/home/user/docs/research.pdf');

  const hit = registry.findProjectByTarget('/home/user/docs/research.pdf');
  assert.ok(hit);
  assert.equal(hit.id, 'proj-uuid-999');
  assert.equal(hit.targetPath, '/home/user/docs/research.pdf');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ProjectManager: saves target into manifest and updates target PDF on compile post-process', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-postprocess-test-'));
  const regFile = path.join(tmpDir, 'projects.json');
  const storeRoot = path.join(tmpDir, 'Lack Projects');
  const userDocs = path.join(tmpDir, 'Documents');
  fs.mkdirSync(storeRoot, { recursive: true });
  fs.mkdirSync(userDocs, { recursive: true });

  const registry = new ProjectRegistry(regFile, storeRoot);
  const manager = new ProjectManager(registry, storeRoot);

  const targetPdf = path.join(userDocs, 'relazione.pdf');
  const { id, storePath, manifest } = manager.createProject({
    name: 'Relazione',
    targetPath: targetPdf
  });

  assert.equal(manifest.target, path.resolve(targetPdf));

  // Verify registry was also updated with the target
  const regEntry = registry.getProject(id);
  assert.ok(regEntry);
  assert.equal(regEntry.targetPath, path.resolve(targetPdf));

  // Simulate compiled PDF
  const baseDoc = await PDFDocument.create();
  baseDoc.addPage([200, 200]);
  const pdfBytes1 = await baseDoc.save();

  const fakeCompiledPdf = path.join(storePath, '.lack', 'build', 'relazione.pdf');
  fs.writeFileSync(fakeCompiledPdf, pdfBytes1);

  // Post process compilation to the target PDF
  await manager.postProcessCompile({
    storePath,
    compiledPdfPath: fakeCompiledPdf,
    targetPdfPath: targetPdf
  });

  // Verify target PDF exists and is overwritten at the exact same location
  assert.ok(fs.existsSync(targetPdf));
  assert.ok(fs.readFileSync(targetPdf).length > 0);

  // Re-compile simulation: overwrite the same target PDF without -1 suffix
  const baseDoc2 = await PDFDocument.create();
  baseDoc2.addPage([300, 300]);
  const pdfBytes2 = await baseDoc2.save();
  fs.writeFileSync(fakeCompiledPdf, pdfBytes2);
  await manager.postProcessCompile({
    storePath,
    compiledPdfPath: fakeCompiledPdf,
    targetPdfPath: targetPdf
  });

  // Target PDF should still be at targetPdf and contain updated content
  assert.ok(fs.existsSync(targetPdf));
  assert.ok(!fs.existsSync(path.join(userDocs, 'relazione-1.pdf')), 'Should not create -1.pdf when updating the project PDF');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI launch: opening an existing .tex file does not trigger promptConvertTexToProject', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-cli-test-'));
  const texFile = path.join(tmpDir, 'appunti.tex');
  fs.writeFileSync(texFile, '\\documentclass{article}\n\\begin{document}\nTest\n\\end{document}');

  const fsProbe = {
    existsSync: (p) => fs.existsSync(p),
    statSync: (p) => fs.statSync(p),
    readdirSync: (p) => fs.readdirSync(p)
  };

  const action = await resolveLaunchArg(texFile, tmpDir, fsProbe, null, async () => null, {
    storeRoot: '/tmp/nonexistent-store'
  });

  assert.equal(action.action, 'classic');
  assert.equal(action.openFilePath, texFile);
  assert.equal(action.promptConvertTexToProject, null, 'Opening .tex directly must never ask to convert to new project');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
