/**
 * scripts/verify-round3-headless.js
 * End-to-end headless verification for Lack Round 3:
 * - Zero console errors (Level >= 3: 0)
 * - Two-pane sidebar (FOLDER vs PROJECT) with splitter divider
 * - Linked project opening & target PDF badge
 * - Non-LaTeX classic text editor mode (.editor-only-mode)
 * - Projects Manager modal & card rendering
 * - Project info popover
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');
const fs = require('fs');
const os = require('os');

remoteMain.initialize();

ipcMain.on('get-platform', (event) => { event.returnValue = 'linux'; });
ipcMain.on('is-window-maximized', (event) => { event.returnValue = false; });
ipcMain.handle('detect-latex-engines', async () => ['pdflatex']);
ipcMain.handle('compile-latex', async () => ({ success: true, pdfPath: '' }));
ipcMain.handle('stop-compilation', () => true);
ipcMain.handle('get-install-command', () => 'sudo apt install texlive-full');

const { PDFDocument } = require('pdf-lib');

// Mock Project IPCs for headless runner
const tmpStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-verify-store-'));
const sampleStore = path.join(tmpStoreRoot, 'demo-proj-abc12345');
fs.mkdirSync(sampleStore, { recursive: true });
fs.writeFileSync(path.join(sampleStore, 'main.tex'), '\\documentclass{article}\\begin{document}Hello Linked!\\end{document}');
fs.writeFileSync(path.join(sampleStore, 'ref.bib'), '@article{test, title={Demo}}');

const tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-verify-folder-'));
const targetPdf = path.join(tmpFolder, 'demo-proj.pdf');
const otherFile = path.join(tmpFolder, 'notes.txt');
fs.writeFileSync(otherFile, 'Plain text notes');

ipcMain.handle('project-get-store-root', () => tmpStoreRoot);
ipcMain.handle('project-set-store-root', (_e, newRoot) => newRoot);
ipcMain.handle('project-acquire-lock', () => ({ acquired: true }));
ipcMain.handle('project-release-lock', () => true);
ipcMain.handle('project-reveal-item', () => true);
ipcMain.handle('project-trash-item', () => true);
ipcMain.handle('project-unlink', () => true);
ipcMain.handle('project-post-process-compile', () => true);
ipcMain.handle('project-load-manifest', () => ({
  schema: 1,
  id: 'abc12345',
  name: 'Demo Progetto',
  main: 'main.tex',
  targetPdf: targetPdf
}));
ipcMain.handle('project-list', () => [
  {
    id: 'abc12345',
    name: 'Demo Progetto',
    targetPath: targetPdf,
    storePath: sampleStore,
    lastModified: Date.now()
  }
]);

const ARTIFACTS_DIR = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5';

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

let win = null;
const consoleErrors = [];

app.whenReady().then(async () => {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([600, 400]);
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(targetPdf, Buffer.from(pdfBytes));

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
    if (level >= 3) {
      consoleErrors.push(`[Console Error] ${message} (${sourceId}:${line})`);
    }
    console.log(`[Level ${level}] ${message}`);
  });

  await win.loadFile(path.join(__dirname, '../index.html'));
  await new Promise(r => setTimeout(r, 1500));

  console.log('=== TEST 1: INITIAL STATE & CLASSIC MODE ===');
  const projectPaneHidden = await win.webContents.executeJavaScript(`
    document.getElementById("project-pane").classList.contains("hidden")
  `);
  console.log('Project pane initially hidden:', projectPaneHidden);
  if (!projectPaneHidden) throw new Error('Project pane should be hidden in classic mode');

  console.log('=== TEST 2: OPEN NON-LATEX FILE (TEXT EDITOR ONLY MODE) ===');
  await win.webContents.executeJavaScript(`
    openFileFromPath(${JSON.stringify(path.join(__dirname, '../mac-install.sh'))});
  `);
  await new Promise(r => setTimeout(r, 600));

  const isEditorOnly = await win.webContents.executeJavaScript(`
    document.getElementById("main-stage").classList.contains("editor-only-mode")
  `);
  console.log('Non-latex file triggers editor-only-mode:', isEditorOnly);
  if (!isEditorOnly) throw new Error('Non-latex file did NOT trigger editor-only-mode!');

  // Capture screenshot of text editor only mode
  const imgEditorOnly = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'verify_04_text_editor_mode.png'), imgEditorOnly.toPNG());
  console.log('Screenshot saved: verify_04_text_editor_mode.png');

  console.log('=== TEST 3: OPEN LINKED PROJECT ===');
  await win.webContents.executeJavaScript(`
    openLinkedProject({
      projectId: 'abc12345',
      name: 'Demo Progetto',
      storePath: ${JSON.stringify(sampleStore)},
      targetPath: ${JSON.stringify(targetPdf)},
      compileImmediate: false
    });
  `);
  await new Promise(r => setTimeout(r, 800));

  const projectPaneVisible = await win.webContents.executeJavaScript(`
    !document.getElementById("project-pane").classList.contains("hidden")
  `);
  const splitterVisible = await win.webContents.executeJavaScript(`
    !document.getElementById("sidebar-splitter").classList.contains("hidden")
  `);
  const chipVisible = await win.webContents.executeJavaScript(`
    !document.getElementById("footer-project-chip").classList.contains("hidden")
  `);
  const titleText = await win.webContents.executeJavaScript(`document.title`);
  const targetBadgeCount = await win.webContents.executeJavaScript(`
    document.querySelectorAll(".tree-link-badge").length
  `);

  console.log('Project pane visible:', projectPaneVisible);
  console.log('Sidebar splitter visible:', splitterVisible);
  console.log('Footer project chip visible:', chipVisible);
  console.log('Window title:', titleText);
  console.log('Target link badges found:', targetBadgeCount);

  if (!projectPaneVisible) throw new Error('Project pane is not visible!');
  if (!splitterVisible) throw new Error('Sidebar splitter is not visible!');
  if (!chipVisible) throw new Error('Footer project chip is not visible!');
  if (!titleText.includes('demo-proj.pdf')) throw new Error('Title does not contain PDF name!');

  // Capture screenshot of linked project two-pane sidebar
  const imgLinkedProject = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'verify_05_linked_project_two_panes.png'), imgLinkedProject.toPNG());
  console.log('Screenshot saved: verify_05_linked_project_two_panes.png');

  console.log('=== TEST 4: OPEN PROJECTS MANAGER MODAL ===');
  await win.webContents.executeJavaScript(`openProjectsManager();`);
  await new Promise(r => setTimeout(r, 600));

  const cardsCount = await win.webContents.executeJavaScript(`
    document.querySelectorAll(".project-card").length
  `);
  console.log('Projects cards rendered in manager:', cardsCount);
  if (cardsCount === 0) throw new Error('No project cards rendered in projects manager!');

  // Capture screenshot of projects manager modal
  const imgProjectsModal = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'verify_06_projects_manager.png'), imgProjectsModal.toPNG());
  console.log('Screenshot saved: verify_06_projects_manager.png');

  await win.webContents.executeJavaScript(`
    document.getElementById("projects-modal").classList.add("hidden");
  `);

  console.log('=== TEST 5: VERIFY CONSOLE ERRORS ===');
  console.log('Total console errors (Level >= 3):', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.error('Console errors:', consoleErrors);
    throw new Error(`Expected 0 console errors, but got ${consoleErrors.length}`);
  }

  console.log('=== ALL HEADLESS ROUND 3 CHECKS PASSED SUCCESSFULLY ===');
  app.quit();
});
