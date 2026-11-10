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
ipcMain.handle('project-acquire-lock', () => ({ acquired: true }));
ipcMain.handle('project-release-lock', () => true);
ipcMain.handle('project-reveal-item', () => true);
ipcMain.handle('project-trash-item', (_e, itemPath) => {
  if (fs.existsSync(itemPath)) {
    fs.rmSync(itemPath, { recursive: true, force: true });
  }
  return true;
});
ipcMain.handle('project-unlink', () => true);
ipcMain.handle('project-load-manifest', () => ({ schema: 1, name: 'TestProj', main: 'main.tex' }));
ipcMain.handle('compile-latex', async () => ({ success: true, pdfPath: '', issues: [] }));

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-verify-multiselect-'));
const folderDir = path.join(tmpBase, 'prove');
fs.mkdirSync(folderDir, { recursive: true });

// Create folder items: subfolder and files
const subfolder = path.join(folderDir, 'subfolder');
fs.mkdirSync(subfolder);
fs.writeFileSync(path.join(folderDir, 'a.tex'), '% LaTeX A\n');
fs.writeFileSync(path.join(folderDir, 'b.txt'), 'Text file B\n');
fs.writeFileSync(path.join(folderDir, 'c.pdf'), '%PDF-1.4\n');

// Create mock store
const storeDir = path.join(tmpBase, 'store');
fs.mkdirSync(storeDir, { recursive: true });
fs.writeFileSync(path.join(storeDir, 'project.json'), JSON.stringify({ schema: 1, name: 'TestProj', main: 'main.tex' }));
fs.writeFileSync(path.join(storeDir, 'main.tex'), '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  remoteMain.enable(win.webContents);

  win.webContents.on('console-message', (e, level, msg) => console.log('[RENDERER]', msg));

  win.loadFile(path.join(__dirname, '..', 'index.html'));

  win.webContents.once('did-finish-load', async () => {
    try {
      // 1. Open linked project
      await win.webContents.executeJavaScript(`
        openLinkedProject({
          projectId: 'test-uuid-1',
          name: 'TestProj',
          storePath: ${JSON.stringify(storeDir)},
          targetPath: ${JSON.stringify(path.join(folderDir, 'c.pdf'))}
        });
      `);

      await new Promise(r => setTimeout(r, 600));

      // 2. Check that folder items do NOT contain project.json
      const folderItems = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('#folder-tree .tree-label')).map(el => el.textContent.trim())
      `);
      console.log('Folder items:', folderItems);
      if (folderItems.includes('project.json')) {
        throw new Error('project.json should NOT be visible in folder tree!');
      }

      // Check project tree also does NOT show project.json
      const projectItems = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('#project-tree .tree-label')).map(el => el.textContent.trim())
      `);
      console.log('Project items:', projectItems);
      if (projectItems.includes('project.json')) {
        throw new Error('project.json should NOT be visible in project tree!');
      }

      // 3. Test Shift-click range multi-selection
      const rangeResult = await win.webContents.executeJavaScript(`
        (() => {
          const items = Array.from(document.querySelectorAll('#folder-tree .tree-item'));
          if (items.length < 3) return { error: 'Not enough items: ' + items.length };

          // Click first item (subfolder)
          items[0].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: false, ctrlKey: false }));

          // Shift+click third item (b.txt)
          items[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, ctrlKey: false }));

          const selected = Array.from(document.querySelectorAll('#folder-tree .tree-item.selected')).map(el => el.dataset.path);
          return {
            selectedCount: selected.length,
            selectedPaths: selected
          };
        })()
      `);
      console.log('Range selection result:', rangeResult);
      if (rangeResult.selectedCount !== 3) {
        throw new Error('Expected 3 items selected in range (including subfolder), got: ' + rangeResult.selectedCount);
      }

      // 4. Test Ctrl-click toggle selection
      const ctrlResult = await win.webContents.executeJavaScript(`
        (() => {
          const items = Array.from(document.querySelectorAll('#folder-tree .tree-item'));
          // Ctrl+click fourth item (c.pdf) -> adds it (now 4 items)
          items[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: false, ctrlKey: true }));
          let selected = Array.from(document.querySelectorAll('#folder-tree .tree-item.selected')).map(el => el.dataset.path);
          const countAfterAdd = selected.length;

          // Ctrl+click second item (a.tex) -> removes it (now 3 items)
          items[1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: false, ctrlKey: true }));
          selected = Array.from(document.querySelectorAll('#folder-tree .tree-item.selected')).map(el => el.dataset.path);
          const countAfterRemove = selected.length;

          return { countAfterAdd, countAfterRemove, selected };
        })()
      `);
      console.log('Ctrl-click result:', ctrlResult);
      if (ctrlResult.countAfterAdd !== 4 || ctrlResult.countAfterRemove !== 3) {
        throw new Error('Ctrl-click toggle did not work as expected!');
      }

      // 5. Test Delete key prompts confirm dialog
      const deleteKeyPrompted = await win.webContents.executeJavaScript(`
        (() => {
          const items = Array.from(document.querySelectorAll('#folder-tree .tree-item'));
          if (items.length > 0) items[0].focus();

          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }));
          const modal = document.getElementById('app-confirm-modal');
          const isVisible = modal && !modal.classList.contains('hidden');
          const msg = document.getElementById('app-confirm-message')?.textContent || '';
          return { isVisible, msg };
        })()
      `);
      console.log('Delete key prompt result:', deleteKeyPrompted);
      if (!deleteKeyPrompted.isVisible) {
        throw new Error('Delete key did not open confirm modal!');
      }

      // 6. Test top header + button targets folderTreeEl and folderDir
      const topPlusResult = await win.webContents.executeJavaScript(`
        (() => {
          const cancelBtn = document.querySelector('.app-confirm-btn-cancel');
          if (cancelBtn) cancelBtn.click();

          document.getElementById('new-file').click();
          const row = document.querySelector('.tree-inline-input-row');
          const input = row?.querySelector('.tree-inline-input');
          const parentContainer = row?.parentElement?.id;
          return {
            rowPresent: !!row,
            parentContainer,
            inputValue: input?.value,
            selStart: input?.selectionStart,
            selEnd: input?.selectionEnd
          };
        })()
      `);
      console.log('Top + result:', topPlusResult);
      if (!topPlusResult.rowPresent || topPlusResult.parentContainer !== 'folder-tree') {
        throw new Error('Top + did not open inline input inside folder-tree!');
      }
      if (topPlusResult.inputValue !== 'new_file.tex' || topPlusResult.selStart !== 0 || topPlusResult.selEnd !== 8) {
        throw new Error('Top + selection range was not [0, 8] on new_file.tex!');
      }

      // 7. Test bottom #proj-btn-add-file targets projectTreeEl
      const bottomPlusResult = await win.webContents.executeJavaScript(`
        (() => {
          const input = document.querySelector('.tree-inline-input');
          if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

          document.getElementById('proj-btn-add-file').click();
          const row = document.querySelector('.tree-inline-input-row');
          const parentContainer = row?.parentElement?.id;
          return {
            rowPresent: !!row,
            parentContainer
          };
        })()
      `);
      console.log('Bottom + result:', bottomPlusResult);
      if (!bottomPlusResult.rowPresent || bottomPlusResult.parentContainer !== 'project-tree') {
        throw new Error('Bottom + did not open inline input inside project-tree!');
      }

      // Capture screenshot
      const artDir = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5';
      const image = await win.capturePage();
      fs.writeFileSync(path.join(artDir, 'verify_multiselect_and_explorer.png'), image.toPNG());
      console.log('ALL VERIFICATIONS PASSED SUCCESSFULLY!');
      process.exit(0);
    } catch (err) {
      console.error('VERIFICATION ERROR:', err);
      process.exit(1);
    }
  });
});
