const test = require('node:test');
const assert = require('node:assert');
const Y = require('yjs');
const {
  generateRoomId,
  startCollaboration,
  leaveCollaboration,
  getCollabState,
  DEFAULT_SIGNALING_SERVERS,
  DEFAULT_ICE_SERVERS
} = require('../collaboration.js');

test('Collaboration: generateRoomId creates unique lack-xxxxxx codes', () => {
  const set = new Set();
  for (let i = 0; i < 50; i++) {
    const id = generateRoomId();
    assert.match(id, /^lack-[a-z0-9]{6}$/);
    set.add(id);
  }
  assert.strictEqual(set.size, 50, 'Generated room IDs must be unique');
});

test('Collaboration: in-process two-peer CRDT edit synchronization', () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const text1 = doc1.getText('latex-content');
  const text2 = doc2.getText('latex-content');

  // Peer 1 types initial document
  text1.insert(0, '\\documentclass{article}\n\\begin{document}\nInitial text\n\\end{document}');

  // Peer 2 receives full state
  const state1 = Y.encodeStateAsUpdate(doc1);
  Y.applyUpdate(doc2, state1);
  assert.strictEqual(text2.toString(), text1.toString());

  // Peer 2 appends a section
  text2.insert(text2.length, '\n\\section{Peer Section}');

  // Peer 1 receives incremental update
  const state2 = Y.encodeStateAsUpdate(doc2, Y.encodeStateVector(doc1));
  Y.applyUpdate(doc1, state2);

  assert.strictEqual(text1.toString(), text2.toString());
  assert.ok(text1.toString().includes('\\section{Peer Section}'));
});

test('Collaboration: defaults for signaling and ICE are properly exported and populated', () => {
  assert.ok(Array.isArray(DEFAULT_SIGNALING_SERVERS));
  assert.ok(DEFAULT_SIGNALING_SERVERS.length >= 2);
  assert.ok(DEFAULT_SIGNALING_SERVERS.some(s => s.includes('y-webrtc.fly.dev')));

  assert.ok(Array.isArray(DEFAULT_ICE_SERVERS));
  assert.ok(DEFAULT_ICE_SERVERS.length >= 1);
  assert.ok(DEFAULT_ICE_SERVERS.some(i => i.urls && i.urls.includes('stun.l.google.com')));
});
