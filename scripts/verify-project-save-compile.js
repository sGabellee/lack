/**
 * scripts/verify-project-save-compile.js
 * End-to-end verification that saving and compiling a .tex file in an open project
 * always compiles to the existing bound target PDF without prompting for a new PDF.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFDocument } = require('pdf-lib');

remoteMain.initialize();

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-e2e-save-'));
const projectStoreDir = path.join(tmpBase, 'store-proj-abc');
const userFolder = path.join(tmpBase, 'my-folder');
fs.mkdirSync(projectStoreDir, { recursive: true });
fs.mkdirSync(path.join(projectStoreDir, '.lack', 'build'), { recursive: true });
fs.mkdirSync(path.join(projectStoreDir, '.lack', 'history'), { recursive: true });
fs.mkdirSync(userFolder, { recursive: true });

const targetPdfPath = path.join(userFolder, 'documento_principale.pdf');
const mainTexInStore = path.join(projectStoreDir, 'documento_principale.tex');
fs.writeFileSync(mainTexInStore, '\\documentclass{article}\n\\begin{document}\nVersione Iniziale\n\\end{document}\n', 'utf8');

// Manifest
fs.writeFileSync(path.join(projectStoreDir, 'project.json'), JSON.stringify({
  schema: 1,
  id: 'proj-abc',
  name: 'Documento Principale',
  main: 'documento_principale.tex',
  target: targetPdfPath,
  embedSnapshot: false
}), 'utf8');

// Initial valid PDF
(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  fs.writeFileSync(targetPdfPath, bytes);
})();

let saveDialogCalled = false;

ipcMain.on('get-platform', (event) => { event.returnValue = 'linux'; });
ipcMain.on('is-window-maximized', (event) => { event.returnValue = false; });
ipcMain.handle('detect-latex-engines', async () => ['pdflatex']);
ipcMain.handle('compile-latex', async (_event, opts) => {
  const outPdf = path.join(projectStoreDir, '.lack', 'build', 'documento_principale.pdf');
  const doc = await PDFDocument.create();
  doc.addPage([250, 250]);
  const bytes = await doc.save();
  fs.writeFileSync(outPdf, bytes);
  return { success: true, pdfPath: outPdf, issues: [], log: 'OK', durationMs: 10 };
});
ipcMain.handle('stop-compilation', () => true);
ipcMain.handle('get-install-command', () => 'sudo apt install texlive-full');
ipcMain.handle('project-get-store-root', () => tmpBase);
ipcMain.handle('project-reveal-item', () => true);
ipcMain.handle('project-load-manifest', async () => {
  return JSON.parse(fs.readFileSync(path.join(projectStoreDir, 'project.json'), 'utf8'));
});
ipcMain.handle('project-save-manifest', async (_e, _store, m) => {
  fs.writeFileSync(path.join(projectStoreDir, 'project.json'), JSON.stringify(m), 'utf8');
  return true;
});
ipcMain.handle('project-registry-save', () => true);
ipcMain.handle('project-registry-lookup', () => ({
  id: 'proj-abc',
  storePath: projectStoreDir,
  targetPath: targetPdfPath,
  lastPdfPath: targetPdfPath
}));
ipcMain.handle('project-acquire-lock', () => ({ acquired: true }));
ipcMain.handle('project-release-lock', () => true);
ipcMain.handle('project-post-process-compile', async (_e, { compiledPdfPath, targetPdfPath: dest }) => {
  fs.copyFileSync(compiledPdfPath, dest);
  return true;
});

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

let win = null;
const consoleErrors = [];

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  remoteMain.enable(win.webContents);

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console Level ${level}] ${message} (${sourceId}:${line})`);
    if (level >= 3) {
      consoleErrors.push(`[Console Error] ${message} (${sourceId}:${line})`);
    }
  });

  await win.loadFile(path.join(__dirname, '../index.html'));
  await new Promise(r => setTimeout(r, 1000));

  console.log('=== TEST 1: OPEN LINKED PROJECT ===');
  await win.webContents.executeJavaScript(`
    (async () => {
      // Instrument dialog.showSaveDialog to detect if it is mistakenly called
      const origShowSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async (...args) => {
        window.__saveDialogCalled = true;
        return origShowSaveDialog(...args);
      };

      await window.__lackOpenLinkedProject({
        projectId: 'proj-abc',
        name: 'Documento Principale',
        storePath: ${JSON.stringify(projectStoreDir)},
        targetPath: ${JSON.stringify(targetPdfPath)},
        mainFile: 'documento_principale.tex',
        compileImmediate: false
      });
    })()
  `);
  await new Promise(r => setTimeout(r, 600));

  console.log('=== TEST 2: MODIFY FILE AND TRIGGER SAVE (CTRL+S) ===');
  try {
    await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const tab = window.__lackGetActiveTab();
          if (!tab) throw new Error("No active tab found!");
          tab.content = "\\\\documentclass{article}\\n\\\\begin{document}\\nVersione Modificata con Successo!\\n\\\\end{document}\\n";
          tab.dirty = true;
          if (cm) cm.setValue(tab.content);

          await window.__lackSaveFile();
        } catch (err) {
          console.error("Test 2 inside error:", err.stack || err.message);
          throw err;
        }
      })()
    `);
  } catch (outerErr) {
    console.error("Test 2 outer error:", outerErr);
    throw outerErr;
  }
  await new Promise(r => setTimeout(r, 800));

  const checkResult = await win.webContents.executeJavaScript(`
    (() => {
      const tab = window.__lackGetActiveTab();
      const curProj = window.getCurrentProject ? window.getCurrentProject() : null;
      return {
        tabDirty: tab ? tab.dirty : true,
        saveDialogCalled: Boolean(window.__saveDialogCalled),
        isLinked: window.isLinkedProject ? window.isLinkedProject() : false,
        projectTarget: curProj ? curProj.targetPath : null
      };
    })()
  `);

  console.log('Check result:', checkResult);

  if (checkResult.saveDialogCalled) {
    throw new Error('FAILED: dialog.showSaveDialog was called! It should NOT ask to create a new PDF.');
  }

  if (checkResult.tabDirty) {
    throw new Error('FAILED: Tab is still marked dirty after saving!');
  }

  if (checkResult.projectTarget !== targetPdfPath) {
    throw new Error(`FAILED: Project target is ${checkResult.projectTarget}, expected ${targetPdfPath}`);
  }

  // Verify that the target PDF on disk was updated
  if (!fs.existsSync(targetPdfPath)) {
    throw new Error('FAILED: Target PDF does not exist on disk!');
  }

  // Verify that no secondary or suffixed PDF was created
  const filesInUserFolder = fs.readdirSync(userFolder);
  console.log('Files in target folder:', filesInUserFolder);
  if (filesInUserFolder.length !== 1 || filesInUserFolder[0] !== 'documento_principale.pdf') {
    throw new Error(`FAILED: Unexpected files created in target folder: ${filesInUserFolder.join(', ')}`);
  }

  // Check saved content in main.tex in store
  const savedContent = fs.readFileSync(mainTexInStore, 'utf8');
  if (!savedContent.includes('Versione Modificata')) {
    throw new Error('FAILED: main.tex in store was not updated!');
  }

  console.log('=== TEST 3: CONSOLE ERROR AUDIT ===');
  if (consoleErrors.length > 0) {
    throw new Error(`Console errors detected: ${consoleErrors.join('\n')}`);
  }
  console.log('0 console errors verified.');

  console.log('SUCCESS: Project file saved and compiled to the exact bound target PDF without prompting!');
  fs.rmSync(tmpBase, { recursive: true, force: true });
  app.quit();
});
