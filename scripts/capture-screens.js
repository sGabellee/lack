/**
 * scripts/capture-screens.js
 * Headless Electron runner to:
 * 1. Capture 3 theme screenshots in docs/screens/:
 *    - docs/screens/screen-light.png
 *    - docs/screens/screen-dark.png
 *    - docs/screens/screen-github.png
 * 2. Verify 0 DevTools console errors.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');
const fs = require('fs');

remoteMain.initialize();

ipcMain.on('get-platform', (event) => { event.returnValue = 'linux'; });
ipcMain.on('is-window-maximized', (event) => { event.returnValue = false; });
ipcMain.handle('detect-latex-engines', async () => [{ id: 'pdflatex', name: 'pdfLaTeX', available: true }]);
ipcMain.handle('compile-latex', async () => ({ success: true, pdfPath: '' }));
ipcMain.handle('stop-compilation', () => true);
ipcMain.handle('get-install-command', () => 'sudo apt install texlive-full');
ipcMain.handle('project-get-store-root', () => '/tmp/store');
ipcMain.handle('project-set-store-root', (_e, root) => root);
ipcMain.handle('project-list', () => []);

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const consoleErrors = [];

async function flushFrames(window, delayMs = 400) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  remoteMain.enable(win.webContents);

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 3) {
      console.error(`[DEVTOOLS CONSOLE ERROR L${level}] ${message} (${sourceId}:${line})`);
      consoleErrors.push({ level, message, line, sourceId });
    }
  });

  const screensDir = path.resolve(__dirname, '../docs/screens');
  fs.mkdirSync(screensDir, { recursive: true });

  await win.loadFile(path.resolve(__dirname, '../index.html'));
  await flushFrames(win, 1000);

  // Set sample document text with syntax highlighting
  await win.webContents.executeJavaScript(`
    (() => {
      const sample = [
        '\\\\documentclass[11pt,a4paper]{article}',
        '\\\\usepackage[utf8]{inputenc}',
        '\\\\usepackage{amsmath,amssymb}',
        '',
        '\\\\title{Sample Scientific Document}',
        '\\\\author{Giovanni Doe \\\\and Jane Smith}',
        '\\\\date{\\\\today}',
        '',
        '\\\\begin{document}',
        '\\\\maketitle',
        '',
        '\\\\section{Introduction}',
        'This is a demonstration of the accessible palette in Lack.',
        '\\\\begin{equation}',
        '  E = mc^2',
        '\\\\end{equation}',
        '',
        '\\\\end{document}'
      ].join('\\n');
      window.createTab('sample.tex', sample, '/tmp/sample.tex');
    })()
  `);
  await flushFrames(win, 500);

  // 1. Light Theme
  await win.webContents.executeJavaScript(`window.applyTheme('light');`);
  await flushFrames(win, 400);
  const imgLight = await win.webContents.capturePage();
  fs.writeFileSync(path.join(screensDir, 'screen-light.png'), imgLight.toPNG());
  console.log('[SCREENS] Captured docs/screens/screen-light.png');

  // 2. Dark Theme
  await win.webContents.executeJavaScript(`window.applyTheme('dark');`);
  await flushFrames(win, 400);
  const imgDark = await win.webContents.capturePage();
  fs.writeFileSync(path.join(screensDir, 'screen-dark.png'), imgDark.toPNG());
  console.log('[SCREENS] Captured docs/screens/screen-dark.png');

  // 3. GitHub Dark Theme
  await win.webContents.executeJavaScript(`window.applyTheme('github');`);
  await flushFrames(win, 400);
  const imgGithub = await win.webContents.capturePage();
  fs.writeFileSync(path.join(screensDir, 'screen-github.png'), imgGithub.toPNG());
  console.log('[SCREENS] Captured docs/screens/screen-github.png');

  console.log('[SCREENS] Total console errors:', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.error('[SCREENS] DevTools reported console errors:', consoleErrors);
    app.exit(1);
  } else {
    console.log('[SCREENS] Verification successful: 0 console errors!');
    app.exit(0);
  }
});
