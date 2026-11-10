const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('pdf-lib');

const { resolveLaunchArg } = require('../src/main/cli.js');
const { ProjectRegistry } = require('../src/projects/registry.js');
const { ProjectManager } = require('../src/projects/manager.js');
const { readLink } = require('../src/projects/pdf-link.js');
const { compileLatex } = require('../latex-compiler.js');

test('E2E Launch: lack prova1 creates linked project, compiles to store, links target, handles re-launch and rename', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-e2e-suite-'));
  const tmpCwd = path.join(tmpRoot, 'prove');
  fs.mkdirSync(tmpCwd, { recursive: true });

  const tmpStoreRoot = path.join(tmpRoot, 'store-root');
  fs.mkdirSync(tmpStoreRoot, { recursive: true });

  const registryFile = path.join(tmpRoot, 'projects.json');
  const registry = new ProjectRegistry(registryFile, tmpStoreRoot);
  const manager = new ProjectManager(registry, tmpStoreRoot);

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
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
`;
  fs.writeFileSync(stubScriptPath, stubContent, { mode: 0o755 });
  const prevEngineCmd = process.env.LACK_ENGINE_CMD;
  process.env.LACK_ENGINE_CMD = stubScriptPath;

  try {
    // 1. Resolve `lack prova1`
    const initialAction = await resolveLaunchArg('prova1', tmpCwd, fs, registry, readLink);
    assert.strictEqual(initialAction.action, 'create-linked');
    const expectedTargetPdf = path.join(tmpCwd, 'prova1.pdf');
    assert.strictEqual(path.resolve(initialAction.targetPath), path.resolve(expectedTargetPdf));
    assert.strictEqual(initialAction.name, 'prova1');

    // 2. Create project
    const { id, storePath, manifest } = manager.createProject({
      name: initialAction.name,
      targetPath: initialAction.targetPath,
      template: initialAction.template
    });
    assert.strictEqual(manifest.main, 'prova1.tex');
    assert.strictEqual(fs.existsSync(path.join(storePath, 'prova1.tex')), true);
    assert.strictEqual(fs.existsSync(path.join(storePath, 'main.tex')), false);
    assert.strictEqual(fs.existsSync(path.join(storePath, '.lack')), true);

    // 3. Compile
    const buildDir = path.join(storePath, '.lack', 'build');
    const compileRes = await compileLatex({
      filePath: path.join(storePath, 'prova1.tex'),
      content: fs.readFileSync(path.join(storePath, 'prova1.tex'), 'utf8'),
      projectDir: storePath,
      outputDir: buildDir,
      engine: 'tectonic'
    });
    assert.strictEqual(compileRes.success, true);
    assert.strictEqual(fs.existsSync(path.join(tmpCwd, 'build')), false, 'No rogue build/ in cwd');

    // 4. Post-process compile
    await manager.postProcessCompile({
      storePath,
      compiledPdfPath: compileRes.pdfPath,
      targetPdfPath: initialAction.targetPath
    });
    assert.strictEqual(fs.existsSync(expectedTargetPdf), true);

    const link = await readLink(expectedTargetPdf);
    assert.ok(link);
    assert.strictEqual(link.id, manifest.id);

    // 5. Re-launch `prova1` -> open-linked same ID
    const reAction = await resolveLaunchArg('prova1', tmpCwd, fs, registry, readLink);
    assert.strictEqual(reAction.action, 'open-linked');
    assert.strictEqual(reAction.projectId, manifest.id);

    // 6. Rename prova1.pdf -> x.pdf and launch x.pdf -> open-linked same ID
    const renamedPdf = path.join(tmpCwd, 'x.pdf');
    fs.renameSync(expectedTargetPdf, renamedPdf);
    const renameAction = await resolveLaunchArg('x.pdf', tmpCwd, fs, registry, readLink);
    assert.strictEqual(renameAction.action, 'open-linked');
    assert.strictEqual(renameAction.projectId, manifest.id);
  } finally {
    if (prevEngineCmd !== undefined) {
      process.env.LACK_ENGINE_CMD = prevEngineCmd;
    } else {
      delete process.env.LACK_ENGINE_CMD;
    }
  }
});
