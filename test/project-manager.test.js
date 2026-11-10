const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const { ProjectRegistry } = require('../src/projects/registry');
const { ProjectManager } = require('../src/projects/manager');

test('ProjectManager: create project, manifest schema, safe path confinement', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-pm-test-'));
  const regFile = path.join(tmpDir, 'projects.json');
  const storeRoot = path.join(tmpDir, 'Lack Projects');
  const registry = new ProjectRegistry(regFile, storeRoot);
  const manager = new ProjectManager(registry, storeRoot);

  const { id, storePath, manifest } = manager.createProject({
    name: 'Neural Network Report',
    targetPath: path.join(tmpDir, 'output.pdf')
  });

  assert.ok(id);
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.name, 'Neural Network Report');
  assert.equal(manifest.main, 'output.tex');
  assert.ok(fs.existsSync(path.join(storePath, 'output.tex')));
  assert.ok(fs.existsSync(path.join(storePath, '.lack', 'build')));

  // Safe path confinement
  const safePath = manager.resolveSafeStorePath(storePath, 'output.tex');
  assert.equal(safePath, path.join(storePath, 'output.tex'));

  // Path escape attempt should throw security error
  assert.throws(() => {
    manager.resolveSafeStorePath(storePath, '../../etc/passwd');
  }, /Security Violation/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ProjectManager: acquireLock detects alive vs stale pid', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-lock-test-'));
  const regFile = path.join(tmpDir, 'projects.json');
  const storeRoot = path.join(tmpDir, 'stores');
  const registry = new ProjectRegistry(regFile, storeRoot);
  const manager = new ProjectManager(registry, storeRoot);

  const { storePath } = manager.createProject({ name: 'Locked Proj' });

  // First lock by current process succeeds
  const lock1 = manager.acquireLock(storePath, 1);
  assert.equal(lock1.acquired, true);

  // Stale lock with dead PID (e.g. 999999) should be replaced
  const lockPath = path.join(storePath, '.lack', 'lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, windowId: 99, timestamp: 1 }));

  const lock2 = manager.acquireLock(storePath, 2);
  assert.equal(lock2.acquired, true);

  manager.releaseLock(storePath);
  assert.equal(fs.existsSync(lockPath), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ProjectManager: linked assets and standalone export', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-export-test-'));
  const regFile = path.join(tmpDir, 'projects.json');
  const storeRoot = path.join(tmpDir, 'stores');
  const externalRepo = path.join(tmpDir, 'my-repo');
  fs.mkdirSync(externalRepo, { recursive: true });

  // Create an external asset in repository
  const extPlot = path.join(externalRepo, 'plot.png');
  fs.writeFileSync(extPlot, 'fake-png-binary-data');

  const registry = new ProjectRegistry(regFile, storeRoot);
  const manager = new ProjectManager(registry, storeRoot);
  const { storePath } = manager.createProject({ name: 'Experiment' });

  // Add linked asset
  manager.addLinkedAsset(storePath, extPlot, 'figures/plot.png');
  assert.ok(fs.existsSync(path.join(storePath, 'figures', 'plot.png')));

  // Export as standalone directory
  const exportDir = path.join(tmpDir, 'exported-folder');
  await manager.exportProject(storePath, exportDir, false);

  assert.ok(fs.existsSync(path.join(exportDir, 'Experiment.tex')));
  assert.ok(fs.existsSync(path.join(exportDir, 'figures', 'plot.png')));
  assert.equal(fs.readFileSync(path.join(exportDir, 'figures', 'plot.png'), 'utf8'), 'fake-png-binary-data');
  // .lack should NOT be exported
  assert.equal(fs.existsSync(path.join(exportDir, '.lack')), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ProjectManager: atomic compile post-processing preserves target on error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-atomic-test-'));
  const regFile = path.join(tmpDir, 'projects.json');
  const storeRoot = path.join(tmpDir, 'stores');
  const registry = new ProjectRegistry(regFile, storeRoot);
  const manager = new ProjectManager(registry, storeRoot);

  const targetDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPdf = path.join(targetDir, 'report.pdf');

  // Existing target PDF
  const baseDoc = await PDFDocument.create();
  baseDoc.addPage([100, 100]);
  const originalBytes = await baseDoc.save();
  fs.writeFileSync(targetPdf, originalBytes);

  const { storePath } = manager.createProject({ name: 'Atomic Test', targetPath: targetPdf });

  // Failed compile test: compiledPdfPath doesn't exist
  await assert.rejects(async () => {
    await manager.postProcessCompile({
      storePath,
      compiledPdfPath: '/invalid/nonexistent.pdf',
      targetPdfPath: targetPdf
    });
  });

  // Target PDF should be completely untouched
  assert.equal(fs.readFileSync(targetPdf).length, originalBytes.length);

  // Successful compile test
  const buildPdf = path.join(storePath, '.lack', 'build', 'main.pdf');
  fs.writeFileSync(buildPdf, originalBytes);

  const res = await manager.postProcessCompile({
    storePath,
    compiledPdfPath: buildPdf,
    targetPdfPath: targetPdf
  });

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(targetPdf));
  // No leftover .tmp-* files
  const leftoverTmp = fs.readdirSync(targetDir).filter(f => f.includes('.tmp-'));
  assert.equal(leftoverTmp.length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
