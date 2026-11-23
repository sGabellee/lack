const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Titlebar & Navbar Drag Region Hygiene: Menus must never be blocked by drag regions on Linux/Windows', () => {
  const cssPath = path.join(__dirname, '../style.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Verify #navbar is not drag on Linux / Windows
  assert.match(
    css,
    /#navbar\s*\{[^}]*-webkit-app-region:\s*no-drag\s*!important/s,
    '#navbar must have -webkit-app-region: no-drag !important so it does not block menus'
  );

  // Verify only platform-darwin allows -webkit-app-region: drag on #navbar
  assert.match(
    css,
    /body\.platform-darwin\s+#navbar\s*\{[^}]*-webkit-app-region:\s*drag/s,
    'Only platform-darwin should set -webkit-app-region: drag on #navbar'
  );

  // Verify .titlebar-menu-content has no-drag !important
  assert.match(
    css,
    /\.titlebar-menu-content\s*\{[^}]*-webkit-app-region:\s*no-drag\s*!important/s,
    '.titlebar-menu-content must have -webkit-app-region: no-drag !important'
  );

  // Verify .titlebar-menu-item has no-drag !important
  assert.match(
    css,
    /\.titlebar-menu-item,\s*\.titlebar-menu-item\s*\*\s*\{[^}]*-webkit-app-region:\s*no-drag\s*!important/s,
    '.titlebar-menu-item and its children must have -webkit-app-region: no-drag !important'
  );
});

test('Titlebar File menu items: new-file and new-project exist and have proper bindings', () => {
  const htmlPath = path.join(__dirname, '../index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('data-action="new-file"'), 'File menu must include data-action="new-file"');
  assert.ok(html.includes('data-action="new-project"'), 'File menu must include data-action="new-project"');

  const rendererPath = path.join(__dirname, '../renderer.js');
  const renderer = fs.readFileSync(rendererPath, 'utf8');

  assert.ok(renderer.includes("case 'new-file': newFile();"), 'Titlebar menu click handler must handle new-file');
  assert.ok(renderer.includes("case 'new-project': openNewProjectModal();"), 'Titlebar menu click handler must handle new-project');
});
