/**
 * scripts/verify-compiler-error-and-folders.js
 * Headless verification script for:
 * 1. Compilation/linter errors on LaTeX commands (\endmd):
 *    - Red dot in gutter (.cm-lint-marker-error)
 *    - Command text highlighted in red (.cm-lintRange-error)
 * 2. Explorer folder isolation:
 *    - Folder pane strictly shows real folder on disk
 *    - Project pane strictly shows virtual project store
 *    - No folder mixing
 * 3. Zero console errors
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
ipcMain.handle('stop-compilation', () => true);
ipcMain.handle('get-install-command', () => 'sudo apt install texlive-full');

const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-store-test-'));
const tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-folder-test-'));
const targetPdf = path.join(tmpFolder, 'prova1.pdf');

// Put an asset in tmpFolder
fs.writeFileSync(path.join(tmpFolder, 'image.png'), 'fake-png');

// Put source in tmpStore
const mainTex = path.join(tmpStore, 'prova1.tex');
fs.writeFileSync(mainTex, `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}

\\title{Test}
\\author{Author}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Write your content here...
provaprovaa
\\endmd
\\end{document}
`);

fs.writeFileSync(path.join(tmpStore, 'project.json'), JSON.stringify({
  schema: 1,
  id: 'test-123',
  name: 'prova1',
  main: 'prova1.tex',
  target: targetPdf
}));

ipcMain.handle('project-get-store-root', () => path.dirname(tmpStore));
ipcMain.handle('project-set-store-root', (_e, newRoot) => newRoot);
ipcMain.handle('project-acquire-lock', () => ({ acquired: true }));
ipcMain.handle('project-release-lock', () => true);
ipcMain.handle('project-reveal-item', () => true);
ipcMain.handle('project-trash-item', () => true);
ipcMain.handle('project-unlink', () => true);
ipcMain.handle('project-post-process-compile', () => true);
ipcMain.handle('project-load-manifest', () => ({
  schema: 1,
  id: 'test-123',
  name: 'prova1',
  main: 'prova1.tex',
  target: targetPdf
}));

// Mock compiler returning LaTeX errors for \endmd
ipcMain.handle('compile-latex', async () => ({
  success: false,
  pdfPath: '',
  issues: [
    {
      type: 'error',
      file: 'prova1.tex',
      line: 16,
      command: '\\endmd',
      message: 'Undefined control sequence.'
    }
  ],
  log: `! Undefined control sequence.\nl.16 \\endmd`
}));

const ARTIFACTS_DIR = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
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

  // Open the linked project
  await win.webContents.executeJavaScript(`
    window.openLinkedProject({
      projectId: 'test-123',
      name: 'prova1',
      storePath: ${JSON.stringify(tmpStore)},
      targetPath: ${JSON.stringify(targetPdf)},
      mainFile: 'prova1.tex',
      compileImmediate: false
    });
  `);

  await new Promise(r => setTimeout(r, 800));

  // Verify Folder Pane vs Project Pane separation
  const folderCheck = await win.webContents.executeJavaScript(`
    (() => {
      const folderItems = Array.from(document.querySelectorAll('#folder-tree .tree-label')).map(el => el.textContent);
      const projectItems = Array.from(document.querySelectorAll('#project-tree .tree-label')).map(el => el.textContent);
      const folderHeader = document.getElementById('folder-path').textContent;
      const projectHeader = document.getElementById('project-pane-name').textContent;

      return {
        folderHeader,
        projectHeader,
        folderItems,
        projectItems
      };
    })()
  `);

  console.log('[FOLDER ISOLATION CHECK]:', JSON.stringify(folderCheck, null, 2));

  // Assert folder items contains 'image.png' and NOT 'project.json'
  if (!folderCheck.folderItems.includes('image.png') || folderCheck.folderItems.includes('project.json')) {
    console.error('FAIL: Folder pane rendered wrong directory!');
    process.exit(1);
  }
  // Assert project items contains 'prova1.tex' and NOT 'project.json'
  if (folderCheck.projectItems.includes('project.json') || !folderCheck.projectItems.includes('prova1.tex')) {
    console.error('FAIL: Project pane rendered wrong directory or revealed project.json!');
    process.exit(1);
  }

  // Trigger compilation to simulate compiler error on \endmd
  await win.webContents.executeJavaScript(`
    document.getElementById('btn-recompile').click();
  `);

  await new Promise(r => setTimeout(r, 1000));

  // Verify red dot in gutter and red highlight on \endmd
  const errorDiagnosticsCheck = await win.webContents.executeJavaScript(`
    (() => {
      const markers = document.querySelectorAll('.cm-lint-marker, .cm-lint-marker-error');
      const redUnderlines = document.querySelectorAll('.cm-lintRange-error');
      const errorLines = document.querySelectorAll('.cm-lint-error-line');

      const markerFound = markers.length > 0;
      let highlightedText = '';
      if (redUnderlines.length > 0) {
        highlightedText = redUnderlines[0].textContent;
      }

      return {
        markerCount: markers.length,
        redUnderlineCount: redUnderlines.length,
        errorLineCount: errorLines.length,
        highlightedText
      };
    })()
  `);

  console.log('[ERROR DIAGNOSTICS CHECK]:', JSON.stringify(errorDiagnosticsCheck, null, 2));

  if (errorDiagnosticsCheck.markerCount === 0) {
    console.error('FAIL: Red dot marker was not found in the gutter!');
    process.exit(1);
  }

  if (errorDiagnosticsCheck.redUnderlineCount === 0 || !errorDiagnosticsCheck.highlightedText.includes('endmd')) {
    console.error('FAIL: Command \\endmd was not highlighted in red!');
    process.exit(1);
  }

  // Capture screenshot of the error with red dot and red highlight
  const imgError = await win.webContents.capturePage();
  const screenPath = path.join(ARTIFACTS_DIR, 'verify_compiler_error_gutter_and_red_highlight.png');
  fs.writeFileSync(screenPath, imgError.toPNG());
  console.log('Saved screenshot to:', screenPath);

  const errors = consoleLogs.filter(l => l.level >= 3);
  console.log('Total console errors:', errors.length);
  if (errors.length > 0) {
    console.error('Console errors:', errors);
    process.exit(1);
  }

  console.log('SUCCESS: All checks passed!');
  app.quit();
});
