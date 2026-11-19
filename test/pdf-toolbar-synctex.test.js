const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('PDF Toolbar and SyncTeX Pill Architecture Verification', async (t) => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

  await t.test('SyncTeX divider control pill is positioned cleanly above PDF canvas', () => {
    // 1. Must exist in HTML
    assert.match(indexHtml, /id="synctex-divider-control"/);
    assert.match(indexHtml, /id="btn-synctex-to-pdf"/);
    assert.match(indexHtml, /id="btn-synctex-to-code"/);

    // 2. CSS positioning: top <= 10px, row layout, height <= 30px so it fits inside toolbar height (38px)
    assert.match(styleCss, /\.synctex-control-pill\s*\{[^}]*top:\s*6px;/);
    assert.match(styleCss, /\.synctex-control-pill\s*\{[^}]*flex-direction:\s*row;/);
    assert.match(styleCss, /\.synctex-control-pill\s*\{[^}]*height:\s*26px;/);

    // 3. Toolbar clearance for the pill
    assert.match(styleCss, /\.pdf-toolbar-left\s*\{[^}]*margin-left:\s*32px;/);
  });

  await t.test('PDF toolbar has id="pdf-toolbar" and responsive overflow classes', () => {
    // 1. Toolbar element has id
    assert.match(indexHtml, /class="pdf-viewer-toolbar"\s+id="pdf-toolbar"/);

    // 2. Fit buttons marked with pdf-tool-fit
    assert.match(indexHtml, /id="pdf-btn-fit-width"\s+class="[^"]*pdf-tool-fit[^"]*"/);
    assert.match(indexHtml, /id="pdf-btn-fit-page"\s+class="[^"]*pdf-tool-fit[^"]*"/);

    // 3. Secondary tools marked with pdf-tool-secondary
    assert.match(indexHtml, /id="pdf-btn-download"\s+class="[^"]*pdf-tool-secondary[^"]*"/);
    assert.match(indexHtml, /id="pdf-btn-refresh"\s+class="[^"]*pdf-tool-secondary[^"]*"/);

    // 4. Overflow dropdown has id="pdf-overflow-dropdown" and menu items
    assert.match(indexHtml, /id="pdf-overflow-dropdown"/);
    assert.match(indexHtml, /id="pdf-menu-fit-width"/);
    assert.match(indexHtml, /id="pdf-menu-fit-page"/);
    assert.match(indexHtml, /id="pdf-menu-download"/);
    assert.match(indexHtml, /id="pdf-menu-refresh"/);
  });

  await t.test('ResizeObserver dynamically updates toolbar items based on container width', () => {
    assert.match(rendererJs, /const updateToolbarOverflow = \(\) =>/);
    assert.match(rendererJs, /const secondaries = pdfToolbarEl\.querySelectorAll\("\.pdf-tool-secondary"\);/);
    assert.match(rendererJs, /const fitBtns = pdfToolbarEl\.querySelectorAll\("\.pdf-tool-fit"\);/);
    assert.match(rendererJs, /const hideSecondary = width < 560;/);
    assert.match(rendererJs, /const hideFit = width < 320;/);
    assert.match(rendererJs, /toolbar-compact/);
  });
});
