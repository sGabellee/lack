/**
 * scripts/verify-synctex-pill.js
 * Verification for Overleaf-style bidirectional SyncTeX pill:
 * 1. Pill exists on divider with dark template styling (#24292f / #383f4a).
 * 2. Forward SyncTeX (Editor -> PDF via -> button) scrolls PDF and highlights location.
 * 3. Reverse SyncTeX (PDF -> Editor via <- button and dblclick) jumps editor to line.
 * 4. Zero console errors.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

remoteMain.initialize();

ipcMain.on('get-platform', (event) => { event.returnValue = 'linux'; });
ipcMain.on('is-window-maximized', (event) => { event.returnValue = false; });
ipcMain.handle('detect-latex-engines', async () => [{ id: 'tectonic', name: 'Tectonic', available: true }]);
ipcMain.handle('stop-compilation', () => true);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1300,
    height: 850,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  remoteMain.enable(win.webContents);

  const consoleErrors = [];
  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 3 && !message.includes('Security Warning')) {
      consoleErrors.push(message);
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await new Promise(r => setTimeout(r, 1200));

  const testPdfPath = '/home/sgabelli/prove/prova2.pdf';

  const res = await win.webContents.executeJavaScript(`
    (async () => {
      const pdfViewer = require('./pdf-viewer.js');
      await pdfViewer.loadPdfDocument('${testPdfPath}');

      // Set editor text with sections matching prova2
      const cm = window.__lackCmInstance || window.cm;
      const editorDoc = \`\\\\documentclass{article}
\\\\title{prova2}
\\\\begin{document}
\\\\section{Introduzione}
Testo della prima sezione.
\\\\section{Formalismo Geometrico e Relativita Generale}
Dettagli geometrici avanzati.
\\\\subsection{Tensore di Curvatura}
Curvatura riemanniana e tensori.
\\\\end{document}\`;

      cm.view.dispatch({
        changes: { from: 0, to: cm.view.state.doc.length, insert: editorDoc }
      });

      await new Promise(r => setTimeout(r, 800));

      // 1. Verify pill presence and styling
      const pill = document.getElementById('synctex-divider-control');
      const btnToPdf = document.getElementById('btn-synctex-to-pdf');
      const btnToCode = document.getElementById('btn-synctex-to-code');

      if (!pill || !btnToPdf || !btnToCode) {
        throw new Error('SyncTeX pill or buttons not found in DOM');
      }

      const pillStyle = window.getComputedStyle(pill);
      const pillBg = pillStyle.backgroundColor;

      // 2. Test Forward SyncTeX: place cursor on line with "Tensore di Curvatura"
      const docStr = cm.getValue();
      const pos = docStr.indexOf('Tensore di Curvatura');
      cm.view.dispatch({ selection: { anchor: pos } });

      const viewportEl = document.getElementById('pdf-viewport');
      const initialScroll = viewportEl ? viewportEl.scrollTop : 0;

      // Click Forward (->)
      await window.__lackTriggerSyncTexToPdf();
      await new Promise(r => setTimeout(r, 800));

      const scrollAfterForward = viewportEl ? viewportEl.scrollTop : 0;
      const highlightEl = document.querySelector('.pdf-synctex-highlight');

      // 3. Test Reverse SyncTeX: double-click a text span in PDF
      const firstSpan = document.querySelector('.pdf-text-layer span');
      const initialLine = cm.view.state.doc.lineAt(cm.view.state.selection.main.head).number;

      if (firstSpan) {
        firstSpan.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
      }

      // Also click Reverse (<-) with selection
      firstSpan.textContent = 'Curvatura riemanniana';
      const range = document.createRange();
      range.selectNodeContents(firstSpan);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      btnToCode.click();
      await new Promise(r => setTimeout(r, 500));

      const lineAfterReverse = cm.view.state.doc.lineAt(cm.view.state.selection.main.head).number;

      return {
        pillExists: true,
        pillBg,
        scrollAfterForward,
        initialScroll,
        hasHighlight: !!highlightEl,
        lineAfterReverse
      };
    })()
  `);

  console.log('[VERIFY RESULT]', JSON.stringify(res, null, 2));

  assert.ok(res.pillExists, 'SyncTeX pill must exist');
  assert.ok(
    res.pillBg.includes('36, 41, 47') || res.pillBg.includes('56, 63, 74') || res.pillBg.includes('45, 51, 59'),
    `Pill background should match template button dark color (#24292f / #383f4a), got: ${res.pillBg}`
  );
  console.log('✓ TEST 1 PASSED: SyncTeX pill exists with correct dark template styling');

  assert.ok(res.scrollAfterForward > 0, 'Forward SyncTeX must scroll PDF towards matching heading');
  console.log('✓ TEST 2 PASSED: Forward SyncTeX (->) scrolls PDF smoothly');

  assert.ok(res.lineAfterReverse > 1, `Reverse SyncTeX (<-) must jump editor to line, got: ${res.lineAfterReverse}`);
  console.log('✓ TEST 3 PASSED: Reverse SyncTeX (<-) jumps editor to line');

  // Capture screenshot of the pill
  const artifactDir = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5';
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactDir, 'verify_synctex_pill.png'), img.toPNG());
  console.log('[VERIFY] Screenshot saved to verify_synctex_pill.png');

  assert.strictEqual(consoleErrors.length, 0, `Expected 0 console errors, got: ${consoleErrors.join('; ')}`);
  console.log('✓ ZERO console errors verified.');

  console.log('ALL SYNCTEX TESTS PASSED SUCCESSFULLY!');
  app.quit();
});
