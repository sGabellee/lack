/**
 * scripts/verify-placeholder-centering.js
 * Verifies that #pdf-empty-placeholder and its contents (icon, text, compile button)
 * are perfectly centered horizontally and vertically in #pdf-viewport regardless of pane width.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

remoteMain.initialize();

ipcMain.on('get-platform', (event) => { event.returnValue = 'linux'; });
ipcMain.on('is-window-maximized', (event) => { event.returnValue = false; });
ipcMain.handle('detect-latex-engines', async () => [{ id: 'pdflatex', name: 'pdfLaTeX', available: true }]);
ipcMain.handle('compile-latex', async () => ({ success: true, pdfPath: '' }));
ipcMain.handle('stop-compilation', () => true);
ipcMain.handle('get-install-command', () => 'sudo apt install texlive-full');

const tmpStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-verify-placeholder-'));
ipcMain.handle('project-get-store-root', () => tmpStoreRoot);
ipcMain.handle('project-set-store-root', (_e, newRoot) => newRoot);
ipcMain.handle('project-acquire-lock', () => ({ acquired: true }));
ipcMain.handle('project-release-lock', () => true);
ipcMain.handle('project-reveal-item', () => true);
ipcMain.handle('project-trash-item', () => true);
ipcMain.handle('project-unlink', () => true);
ipcMain.handle('project-post-process-compile', () => true);
ipcMain.handle('project-find-by-target', () => null);
ipcMain.handle('project-load-manifest', () => null);
ipcMain.handle('project-list', () => []);
ipcMain.handle('project-auto-detect-main', () => 'main.tex');
ipcMain.handle('project-set-main', () => true);
ipcMain.handle('project-create', () => ({ id: 'test1', storePath: tmpStoreRoot }));

const ARTIFACTS_DIR = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  remoteMain.enable(win.webContents);

  const consoleLogs = [];
  win.webContents.on('console-message', (e, level, msg) => {
    consoleLogs.push({ level, msg });
  });

  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await new Promise(r => setTimeout(r, 1200));

  // Verify placeholder centering at default 50/50 split
  const metricsDefault = await win.webContents.executeJavaScript(`
    (() => {
      const viewport = document.getElementById('pdf-viewport');
      const placeholder = document.getElementById('pdf-empty-placeholder');
      const btn = document.getElementById('btn-placeholder-compile');
      const text = placeholder.querySelector('p');
      const icon = placeholder.querySelector('svg');
      
      const vRect = viewport.getBoundingClientRect();
      const pRect = placeholder.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      const tRect = text.getBoundingClientRect();
      const iRect = icon.getBoundingClientRect();
      
      const vCenterX = vRect.left + vRect.width / 2;
      const bCenterX = bRect.left + bRect.width / 2;
      const tCenterX = tRect.left + tRect.width / 2;
      const iCenterX = iRect.left + iRect.width / 2;
      
      return {
        viewportWidth: vRect.width,
        viewportHeight: vRect.height,
        vCenterX,
        bCenterX,
        tCenterX,
        iCenterX,
        btnDiffX: Math.abs(vCenterX - bCenterX),
        textDiffX: Math.abs(vCenterX - tCenterX),
        iconDiffX: Math.abs(vCenterX - iCenterX),
        btnWidth: bRect.width,
        placeholderHidden: placeholder.classList.contains('hidden'),
        canvasHidden: document.getElementById('pdf-canvas-container').classList.contains('hidden')
      };
    })()
  `);

  console.log('[METRICS DEFAULT 50/50]:', JSON.stringify(metricsDefault, null, 2));

  // Capture screenshot of centered placeholder in default light theme
  const imgLight = await win.webContents.capturePage();
  const screenLightPath = path.join(ARTIFACTS_DIR, 'verify_placeholder_centered_light.png');
  fs.writeFileSync(screenLightPath, imgLight.toPNG());
  console.log('Saved screenshot to:', screenLightPath);

  // Resize preview container to 320px width (narrow right pane)
  const metricsNarrow = await win.webContents.executeJavaScript(`
    (() => {
      const previewContainer = document.getElementById('preview-container');
      previewContainer.style.width = '320px';
      previewContainer.style.flex = '0 0 320px';
      
      const viewport = document.getElementById('pdf-viewport');
      const placeholder = document.getElementById('pdf-empty-placeholder');
      const btn = document.getElementById('btn-placeholder-compile');
      const text = placeholder.querySelector('p');
      const icon = placeholder.querySelector('svg');
      
      const vRect = viewport.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      const tRect = text.getBoundingClientRect();
      const iRect = icon.getBoundingClientRect();
      
      const vCenterX = vRect.left + vRect.width / 2;
      const bCenterX = bRect.left + bRect.width / 2;
      const tCenterX = tRect.left + tRect.width / 2;
      const iCenterX = iRect.left + iRect.width / 2;
      
      return {
        viewportWidth: vRect.width,
        vCenterX,
        bCenterX,
        btnDiffX: Math.abs(vCenterX - bCenterX),
        textDiffX: Math.abs(vCenterX - tCenterX),
        iconDiffX: Math.abs(vCenterX - iCenterX)
      };
    })()
  `);

  console.log('[METRICS NARROW 320px]:', JSON.stringify(metricsNarrow, null, 2));

  // Resize preview container to 800px width (wide right pane)
  const metricsWide = await win.webContents.executeJavaScript(`
    (() => {
      const previewContainer = document.getElementById('preview-container');
      previewContainer.style.width = '800px';
      previewContainer.style.flex = '0 0 800px';
      
      const viewport = document.getElementById('pdf-viewport');
      const placeholder = document.getElementById('pdf-empty-placeholder');
      const btn = document.getElementById('btn-placeholder-compile');
      const text = placeholder.querySelector('p');
      const icon = placeholder.querySelector('svg');
      
      const vRect = viewport.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      const tRect = text.getBoundingClientRect();
      const iRect = icon.getBoundingClientRect();
      
      const vCenterX = vRect.left + vRect.width / 2;
      const bCenterX = bRect.left + bRect.width / 2;
      const tCenterX = tRect.left + tRect.width / 2;
      const iCenterX = iRect.left + iRect.width / 2;
      
      return {
        viewportWidth: vRect.width,
        vCenterX,
        bCenterX,
        btnDiffX: Math.abs(vCenterX - bCenterX),
        textDiffX: Math.abs(vCenterX - tCenterX),
        iconDiffX: Math.abs(vCenterX - iCenterX)
      };
    })()
  `);

  console.log('[METRICS WIDE 800px]:', JSON.stringify(metricsWide, null, 2));

  // Reset to 50/50 and switch to dark mode to capture dark theme screenshot
  await win.webContents.executeJavaScript(`
    (() => {
      const previewContainer = document.getElementById('preview-container');
      previewContainer.style.width = '';
      previewContainer.style.flex = '1 1 50%';
      document.body.className = 'dark theme-dark';
    })()
  `);
  await new Promise(r => setTimeout(r, 400));

  const imgDark = await win.webContents.capturePage();
  const screenDarkPath = path.join(ARTIFACTS_DIR, 'verify_placeholder_centered_dark.png');
  fs.writeFileSync(screenDarkPath, imgDark.toPNG());
  console.log('Saved screenshot to:', screenDarkPath);

  const errors = consoleLogs.filter(l => l.level >= 3);
  console.log('Total console errors:', errors.length);
  if (errors.length > 0) {
    console.error('Errors:', errors);
    process.exit(1);
  }

  // Check diffs are < 1.5 px
  if (metricsDefault.btnDiffX > 1.5 || metricsNarrow.btnDiffX > 1.5 || metricsWide.btnDiffX > 1.5) {
    console.error('FAIL: Button is not centered horizontally!');
    process.exit(1);
  }

  console.log('SUCCESS: Placeholder elements are perfectly centered horizontally regardless of width!');
  app.quit();
});
