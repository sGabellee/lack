const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const { writeLink, readLink, extractSnapshot, unlinkPdf } = require('../src/projects/pdf-link');

test('pdf-link: writeLink stamps LackProjectID & Keywords, readLink round-trips correctly', async () => {
  // Create a minimal PDF fixture
  const baseDoc = await PDFDocument.create();
  baseDoc.addPage([300, 300]);
  const baseBytes = await baseDoc.save();

  const linkedBytes = await writeLink(baseBytes, {
    id: 'proj-uuid-9988-7766',
    name: 'Research Paper',
    embedSnapshot: false
  });

  assert.ok(linkedBytes.length > 0);

  // Read back link
  const link = await readLink(linkedBytes);
  assert.ok(link);
  assert.equal(link.id, 'proj-uuid-9988-7766');
  assert.equal(link.name, 'Research Paper');
  assert.equal(link.hasSnapshot, false);
});

test('pdf-link: embedSnapshot attaches zip and extractSnapshot unpacks files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-snap-test-'));
  const storeDir = path.join(tmpDir, 'store');
  const restoreDir = path.join(tmpDir, 'restore');
  fs.mkdirSync(storeDir, { recursive: true });

  fs.writeFileSync(path.join(storeDir, 'main.tex'), '\\documentclass{article}\n\\begin{document}Hello\\end{document}');
  fs.writeFileSync(path.join(storeDir, 'refs.bib'), '@article{test, title={Test}}');
  fs.mkdirSync(path.join(storeDir, '.lack'), { recursive: true });
  fs.writeFileSync(path.join(storeDir, '.lack', 'lock'), '{"pid": 123}');

  // Create base PDF
  const baseDoc = await PDFDocument.create();
  baseDoc.addPage([200, 200]);
  const baseBytes = await baseDoc.save();

  // Write link with embedded snapshot
  const linkedBytes = await writeLink(baseBytes, {
    id: 'proj-snap-1122',
    name: 'Snapshot Project',
    embedSnapshot: true,
    storePath: storeDir
  });

  const link = await readLink(linkedBytes);
  assert.ok(link);
  assert.equal(link.id, 'proj-snap-1122');
  assert.equal(link.hasSnapshot, true);

  // Extract snapshot
  const extracted = await extractSnapshot(linkedBytes, restoreDir);
  assert.equal(extracted, true);

  assert.ok(fs.existsSync(path.join(restoreDir, 'main.tex')));
  assert.ok(fs.existsSync(path.join(restoreDir, 'refs.bib')));
  // Private .lack/ should NOT be embedded in snapshot
  assert.equal(fs.existsSync(path.join(restoreDir, '.lack')), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('pdf-link: unlinkPdf removes project metadata', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-unlink-test-'));
  const pdfPath = path.join(tmpDir, 'sample.pdf');

  const baseDoc = await PDFDocument.create();
  baseDoc.addPage([200, 200]);
  const baseBytes = await baseDoc.save();
  const linkedBytes = await writeLink(baseBytes, { id: 'proj-unlink-1234', name: 'Test' });
  fs.writeFileSync(pdfPath, linkedBytes);

  let link = await readLink(pdfPath);
  assert.equal(link?.id, 'proj-unlink-1234');

  await unlinkPdf(pdfPath);
  link = await readLink(pdfPath);
  assert.equal(link, null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
