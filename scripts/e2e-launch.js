/**
 * scripts/e2e-launch.js
 * End-to-end verification for extension-less launch (`lack prova1`),
 * linked project creation, compilation via LACK_ENGINE_CMD stub,
 * stamping of target PDF, re-launch identity, and rename tracking.
 */

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('pdf-lib');

const { resolveLaunchArg } = require('../src/main/cli.js');
const { ProjectRegistry } = require('../src/projects/registry.js');
const { ProjectManager } = require('../src/projects/manager.js');
const { readLink, writeLink } = require('../src/projects/pdf-link.js');
const { compileLatex } = require('../latex-compiler.js');

async function run() {
  console.log('[E2E-LAUNCH] Starting Phase 2 E2E Launch Verification...');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-e2e-launch-'));
  const tmpCwd = path.join(tmpRoot, 'prove');
  fs.mkdirSync(tmpCwd, { recursive: true });

  const tmpStoreRoot = path.join(tmpRoot, 'store-root');
  fs.mkdirSync(tmpStoreRoot, { recursive: true });

  const registryFile = path.join(tmpRoot, 'projects.json');
  const registry = new ProjectRegistry(registryFile, tmpStoreRoot);
  const manager = new ProjectManager(registry, tmpStoreRoot);

  // 1. Create compiler stub executable
  const pdfLibPath = require.resolve('pdf-lib');
  const stubScriptPath = path.join(tmpRoot, 'compiler-stub.sh');
  const stubContent = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require(${JSON.stringify(pdfLibPath)});

async function main() {
  const args = process.argv.slice(2);
  const outDir = args[0];
  const srcFile = args[1];
  const baseName = path.basename(srcFile, path.extname(srcFile));
  const outPdf = path.join(outDir, baseName + '.pdf');
  fs.mkdirSync(outDir, { recursive: true });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([595, 842]);
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outPdf, Buffer.from(pdfBytes));
  console.log('Compiled to ' + outPdf);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
`;
  fs.writeFileSync(stubScriptPath, stubContent, { mode: 0o755 });
  process.env.LACK_ENGINE_CMD = stubScriptPath;

  // 2. Resolve `lack prova1` in tmpCwd
  console.log('[E2E-LAUNCH] Resolving launch argument "prova1" in CWD:', tmpCwd);
  const initialAction = await resolveLaunchArg('prova1', tmpCwd, fs, registry, readLink);

  assert.strictEqual(initialAction.action, 'create-linked', 'Must resolve to create-linked');
  const expectedTargetPdf = path.join(tmpCwd, 'prova1.pdf');
  assert.strictEqual(path.resolve(initialAction.targetPath), path.resolve(expectedTargetPdf));
  assert.strictEqual(initialAction.name, 'prova1');

  // 3. Create linked project
  const { id, storePath, manifest } = manager.createProject({
    name: initialAction.name,
    targetPath: initialAction.targetPath,
    template: initialAction.template
  });

  console.log('[E2E-LAUNCH] Created linked project ID:', id, 'Store path:', storePath);
  assert.strictEqual(manifest.main, 'prova1.tex', 'Main file in manifest must be prova1.tex');
  assert.strictEqual(fs.existsSync(path.join(storePath, 'prova1.tex')), true, 'Store must contain prova1.tex');
  assert.strictEqual(fs.existsSync(path.join(storePath, 'main.tex')), false, 'Store must NOT contain main.tex');
  assert.strictEqual(fs.existsSync(path.join(storePath, '.lack')), true, 'Store must contain .lack folder');

  // 4. Compile project with store outputDir: <store>/.lack/build
  const buildDir = path.join(storePath, '.lack', 'build');
  const compileRes = await compileLatex({
    filePath: path.join(storePath, 'prova1.tex'),
    content: fs.readFileSync(path.join(storePath, 'prova1.tex'), 'utf8'),
    projectDir: storePath,
    outputDir: buildDir,
    engine: 'tectonic'
  });

  if (!compileRes.success) {
    console.error('[E2E-LAUNCH] compileRes failure:', compileRes);
  }

  assert.strictEqual(compileRes.success, true, 'Compilation must succeed with stub');
  const expectedCompiledPdf = path.join(buildDir, 'prova1.pdf');
  assert.strictEqual(path.resolve(compileRes.pdfPath), path.resolve(expectedCompiledPdf));
  assert.strictEqual(fs.existsSync(compileRes.pdfPath), true, 'Compiled PDF must exist in build dir');

  // Crucial check: Assert NO build directory created in cwd!
  const rogueBuildDir = path.join(tmpCwd, 'build');
  assert.strictEqual(fs.existsSync(rogueBuildDir), false, 'No build directory must be created in user CWD');

  // 5. Post-process compile: publish and link target PDF
  await manager.postProcessCompile({
    storePath,
    compiledPdfPath: compileRes.pdfPath,
    targetPdfPath: initialAction.targetPath
  });

  assert.strictEqual(fs.existsSync(expectedTargetPdf), true, 'Published prova1.pdf must exist in tmpCwd');

  const link = await readLink(expectedTargetPdf);
  assert.ok(link, 'Published PDF must contain Lack link metadata');
  assert.strictEqual(link.id, manifest.id, 'Stamped link ID must match manifest.id');
  assert.strictEqual(link.name, 'prova1', 'Stamped link name must be prova1');

  // 6. Re-launch `prova1` in same CWD -> MUST resolve to open-linked for same project!
  console.log('[E2E-LAUNCH] Testing re-launch of "prova1"...');
  const reAction = await resolveLaunchArg('prova1', tmpCwd, fs, registry, readLink);
  assert.strictEqual(reAction.action, 'open-linked', 'Re-launch must resolve to open-linked');
  assert.strictEqual(reAction.projectId, manifest.id, 'Must reference the same project ID');
  assert.strictEqual(path.resolve(reAction.storePath), path.resolve(storePath));

  // 7. Rename `prova1.pdf` to `x.pdf` and launch `x.pdf` -> MUST resolve to open-linked for same project!
  console.log('[E2E-LAUNCH] Testing rename prova1.pdf -> x.pdf and launch "x.pdf"...');
  const renamedPdf = path.join(tmpCwd, 'x.pdf');
  fs.renameSync(expectedTargetPdf, renamedPdf);

  const renameAction = await resolveLaunchArg('x.pdf', tmpCwd, fs, registry, readLink);
  assert.strictEqual(renameAction.action, 'open-linked', 'Launch of renamed PDF must resolve to open-linked');
  assert.strictEqual(renameAction.projectId, manifest.id, 'Must reference the same project ID despite filename change');

  console.log('[E2E-LAUNCH] All Phase 2 launch and linking assertions PASSED successfully!');
}

run().catch((err) => {
  console.error('[E2E-LAUNCH] FAILED:', err);
  process.exit(1);
});
