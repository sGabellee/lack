const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('FIX 1: Default theme is light across index.html, renderer.js, themes.js, and index.js', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(
    indexHtml.includes("localStorage.getItem('lack-theme') || 'light'"),
    'index.html must default to light theme'
  );

  const rendererJs = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  assert.ok(
    rendererJs.includes("localStorage.getItem('lack-theme') || 'light'"),
    'renderer.js must default to light theme'
  );

  const themesJs = fs.readFileSync(path.join(ROOT, 'src/editor/themes.js'), 'utf8');
  assert.ok(
    themesJs.includes("function getThemeExtensions(themeName = 'light')"),
    'themes.js getThemeExtensions must default to light'
  );

  const editorIndexJs = fs.readFileSync(path.join(ROOT, 'src/editor/index.js'), 'utf8');
  assert.ok(
    editorIndexJs.includes("this.options.theme || 'light'"),
    'editor/index.js must default to light theme'
  );
});

test('FIX 2: Ctrl+M rotates theme at main level; Mod-Shift-M and Mod-Alt-M bound to math', () => {
  const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.ok(
    mainJs.includes("input.key === 'm' || input.key === 'M' || input.code === 'KeyM'") &&
    mainJs.includes("win.webContents.send('toggle-theme')"),
    'main.js before-input-event must intercept Ctrl+M to rotate theme reliably on Linux'
  );

  const editorIndexJs = fs.readFileSync(path.join(ROOT, 'src/editor/index.js'), 'utf8');
  assert.ok(
    editorIndexJs.includes("key: 'Mod-Shift-m'") && editorIndexJs.includes("key: 'Mod-Alt-m'"),
    'CodeMirror keymap must bind Mod-Shift-m and Mod-Alt-m to toggleMath'
  );
  assert.ok(
    editorIndexJs.includes("key: 'Mod-m'") && editorIndexJs.includes("onRotateThemeCallback"),
    'Mod-m must trigger onRotateThemeCallback and never insert math'
  );
});

test('FIX 3: PDF deletion and unlinking offers options to keep sources intact', () => {
  const rendererJs = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  assert.ok(
    rendererJs.includes("Mantieni sorgenti") || rendererJs.includes("Mantieni dati sorgente"),
    'renderer.js must offer option to keep sources intact when deleting or unlinking PDF'
  );
  assert.ok(
    rendererJs.includes("Elimina anche dati") || rendererJs.includes("Elimina tutti i dati"),
    'renderer.js must offer option to delete all data if confirmed'
  );
});

test('FIX 4: No raw emojis in project pane header, link badges, or action buttons', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!indexHtml.includes('&#128193;'), 'No folder emoji &#128193;');
  assert.ok(!indexHtml.includes('&#128279;'), 'No link emoji &#128279;');
  assert.ok(!indexHtml.includes('&#128065;'), 'No eye emoji &#128065;');
  assert.ok(!indexHtml.includes('<span class="project-chip-glyph">🔗</span>'), 'No 🔗 in project chip');

  const rendererJs = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  assert.ok(!rendererJs.includes('"📁"'), 'No raw 📁 emoji in tree input');
  assert.ok(!rendererJs.includes('"📄"'), 'No raw 📄 emoji in tree input');
  assert.ok(!rendererJs.includes('>🔗<'), 'No raw 🔗 in link badges');
});

test('FIX 5: Explorer tree containers have flex: 1, min-height: 0, and overflow-y: auto for wheel scrolling', () => {
  const styleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(
    styleCss.includes('.tree-container {') &&
    styleCss.includes('overflow-y: auto !important;') &&
    styleCss.includes('min-height: 0;'),
    'tree-container must have overflow-y: auto and min-height: 0 for mouse wheel scrolling'
  );
  assert.ok(
    styleCss.includes('.sidebar-pane {') &&
    styleCss.includes('min-height: 0;'),
    'sidebar-pane must have min-height: 0 to allow child flex scroll'
  );
});
