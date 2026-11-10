const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ProjectRegistry } = require('../src/projects/registry');

test('ProjectRegistry: basic CRUD operations and atomic saving', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-reg-test-'));
  const regFile = path.join(tmpDir, 'projects.json');
  const storeRoot = path.join(tmpDir, 'Lack Projects');
  fs.mkdirSync(storeRoot, { recursive: true });

  const registry = new ProjectRegistry(regFile, storeRoot);
  assert.equal(registry.listProjects().length, 0);

  // Add project
  const p1 = registry.saveProjectEntry('proj-1234-abcd', {
    storePath: path.join(storeRoot, 'proj-1234-abcd'),
    name: 'Thesis Paper',
    lastPdfPath: '/home/user/paper.pdf'
  });
  assert.equal(p1.id, 'proj-1234-abcd');
  assert.equal(p1.name, 'Thesis Paper');

  // Verify file was written
  assert.ok(fs.existsSync(regFile));
  const fileContent = JSON.parse(fs.readFileSync(regFile, 'utf8'));
  assert.equal(fileContent['proj-1234-abcd'].name, 'Thesis Paper');

  // Find by target
  const found = registry.findProjectByTarget('/home/user/paper.pdf');
  assert.ok(found);
  assert.equal(found.id, 'proj-1234-abcd');

  // Remove
  const removed = registry.removeProjectEntry('proj-1234-abcd');
  assert.equal(removed, true);
  assert.equal(registry.listProjects().length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ProjectRegistry: self-healing scan from store directories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-heal-test-'));
  const regFile = path.join(tmpDir, 'projects.json');
  const storeRoot = path.join(tmpDir, 'Lack Projects');
  fs.mkdirSync(storeRoot, { recursive: true });

  // Create two projects in store on disk
  const p1Dir = path.join(storeRoot, 'my-thesis-1111');
  fs.mkdirSync(p1Dir, { recursive: true });
  fs.writeFileSync(path.join(p1Dir, 'project.json'), JSON.stringify({
    schema: 1,
    id: 'uuid-1111',
    name: 'My Thesis',
    target: '/path/thesis.pdf'
  }));

  const p2Dir = path.join(storeRoot, 'lab-report-2222');
  fs.mkdirSync(p2Dir, { recursive: true });
  fs.writeFileSync(path.join(p2Dir, 'project.json'), JSON.stringify({
    schema: 1,
    id: 'uuid-2222',
    name: 'Lab Report',
    target: '/path/report.pdf'
  }));

  // Corrupted regFile
  fs.writeFileSync(regFile, '{ invalid json garbage');

  // Constructing registry should heal and load both
  const registry = new ProjectRegistry(regFile, storeRoot);
  const list = registry.listProjects();
  assert.equal(list.length, 2);

  const thesis = registry.getProject('uuid-1111');
  assert.ok(thesis);
  assert.equal(thesis.name, 'My Thesis');

  const report = registry.getProject('uuid-2222');
  assert.ok(report);
  assert.equal(report.name, 'Lab Report');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
