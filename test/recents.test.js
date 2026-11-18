const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { RecentsStore } = require('../src/projects/recents');

test('RecentsStore: add, deduplicate, limit and query', () => {
  const tmpFile = path.join(os.tmpdir(), `lack-recents-${Date.now()}.json`);
  const store = new RecentsStore(tmpFile, 3);

  store.addRecent({ itemPath: '/tmp/doc1.tex', type: 'file' });
  store.addRecent({ itemPath: '/tmp/doc2.tex', type: 'file' });
  store.addRecent({ itemPath: '/tmp/doc1.tex', type: 'file' }); // Re-adds doc1, moving to top

  let list = store.getRecents({ probeFs: { existsSync: (p) => p === '/tmp/doc1.tex' } });
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].path, '/tmp/doc1.tex');
  assert.strictEqual(list[0].exists, true);
  assert.strictEqual(list[1].path, '/tmp/doc2.tex');
  assert.strictEqual(list[1].exists, false);

  // Exceed max items
  store.addRecent({ itemPath: '/tmp/doc3.tex', type: 'file' });
  store.addRecent({ itemPath: '/tmp/doc4.tex', type: 'file' });

  list = store.getRecents();
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0].path, '/tmp/doc4.tex');

  // Remove recent
  store.removeRecent('/tmp/doc4.tex');
  assert.strictEqual(store.getRecents().length, 2);

  try { fs.unlinkSync(tmpFile); } catch (_) {}
});

test('RecentsStore: filterDir restricts to specific folder', () => {
  const tmpFile = path.join(os.tmpdir(), `lack-recents-filter-${Date.now()}.json`);
  const store = new RecentsStore(tmpFile, 10);

  store.addRecent({ itemPath: '/home/user/projectA/main.tex', type: 'file' });
  store.addRecent({ itemPath: '/home/user/projectB/main.tex', type: 'file' });

  const filtered = store.getRecents({ filterDir: '/home/user/projectA' });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].path, '/home/user/projectA/main.tex');

  try { fs.unlinkSync(tmpFile); } catch (_) {}
});
