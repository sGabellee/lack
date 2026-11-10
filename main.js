const { app, BrowserWindow, Menu, dialog, clipboard, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const remoteMain = require("@electron/remote/main");
const { autoUpdater } = require("electron-updater");
const i18n = require("./i18n.js");
const latexCompiler = require("./latex-compiler.js");
const { ProjectRegistry } = require("./src/projects/registry.js");
const { ProjectManager } = require("./src/projects/manager.js");
const { readLink, extractSnapshot, unlinkPdf } = require("./src/projects/pdf-link.js");
const { resolveOpenAction } = require("./src/main/cli.js");
const { installTectonic } = require("./src/main/engine-installer.js");

app.setName("Lack");
if (process.platform === 'linux') {
  app.setDesktopName('Lack.desktop');
}
if (process.platform === 'win32') {
  app.setAppUserModelId("com.Giovanni.Lack");
}

let win;
let printWin = null;
let initialAction = null;
const openProjectWindows = new Map(); // projectId -> BrowserWindow

// Initialize Linked Project Store & Registry
const defaultStoreRoot = path.join(app.getPath('documents'), 'Lack Projects');
const registryFile = path.join(app.getPath('userData'), 'projects.json');
const projectRegistry = new ProjectRegistry(registryFile, defaultStoreRoot);
const projectManager = new ProjectManager(projectRegistry, defaultStoreRoot);

// Determine invoking CWD (from lack.c or process.cwd)
const invocationCwd = process.env.LACK_CWD || process.cwd();

// Parse initial command line arguments
const rawCliArgs = process.defaultApp ? process.argv.slice(2) : process.argv.slice(1);

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', async (event, argv, workingDirectory) => {
    const cwd = workingDirectory || invocationCwd;
    const instanceArgs = argv.slice(process.defaultApp ? 2 : 1);
    const action = await resolveOpenAction({
      rawArgv: instanceArgs,
      cwd,
      registry: projectRegistry,
      readLinkFn: readLink,
      storeRoot: defaultStoreRoot
    });

    handleResolvedAction(action, null);
  });
}

function initializeRemote() {
  if (!remoteMain.isInitialized()) {
    remoteMain.initialize();
  }
}

// Window control IPC handlers
ipcMain.on('window-minimize', () => {
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.on('window-maximize', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.on('window-close-confirmed', () => {
  if (win && !win.isDestroyed()) win.destroy();
});

ipcMain.on('update-theme-menu-label', (_event, isDark) => {
  const menu = Menu.getApplicationMenu();
  if (menu) {
    const item = menu.getMenuItemById('menu-item-theme-toggle');
    if (item) {
      item.label = isDark ? (i18n.t("menu_light_mode") || "Light Mode") : (i18n.t("menu_dark_mode") || "Dark Mode");
    }
  }
});

ipcMain.on('get-platform', (event) => {
  event.returnValue = process.platform;
});

ipcMain.on('is-window-maximized', (event) => {
  event.returnValue = (win && !win.isDestroyed()) ? win.isMaximized() : false;
});

// LaTeX Compiler IPC handlers
ipcMain.handle('detect-latex-engines', async () => {
  return latexCompiler.detectEngines();
});

ipcMain.handle('compile-latex', async (_event, compileOptions) => {
  return await latexCompiler.compileLatex(compileOptions);
});

ipcMain.handle('stop-compilation', () => {
  return latexCompiler.stopCompilation();
});

ipcMain.handle('get-install-command', () => {
  return latexCompiler.getInstallCommand();
});

ipcMain.handle('install-tectonic', async () => {
  return await installTectonic(app.getPath('userData'), (prog) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('install-tectonic-progress', prog);
    }
  });
});

// Project Store & Manager IPC Handlers
ipcMain.handle('project-get-store-root', () => {
  return projectManager.getStoreRoot();
});

ipcMain.handle('project-set-store-root', (_e, newRoot) => {
  projectManager.setStoreRoot(newRoot);
  return projectManager.getStoreRoot();
});

ipcMain.handle('project-create', async (_e, opts) => {
  return projectManager.createProject(opts);
});

ipcMain.handle('project-load-manifest', (_e, storePath) => {
  return projectManager.loadManifest(storePath);
});

ipcMain.handle('project-save-manifest', (_e, storePath, manifest) => {
  projectManager.saveManifest(storePath, manifest);
  return true;
});

ipcMain.handle('project-list', () => {
  return projectRegistry.listProjects();
});

ipcMain.handle('project-relink', async (_e, { pdfPath, projectId }) => {
  const proj = projectRegistry.getProject(projectId);
  if (!proj) throw new Error('Progetto non trovato nel registro');
  await projectManager.postProcessCompile({
    storePath: proj.storePath,
    compiledPdfPath: pdfPath,
    targetPdfPath: pdfPath
  });
  return true;
});

ipcMain.handle('project-unlink', async (_e, pdfPath) => {
  return await unlinkPdf(pdfPath);
});

ipcMain.handle('project-post-process-compile', async (_e, opts) => {
  return await projectManager.postProcessCompile(opts);
});

ipcMain.handle('project-read-link', async (_e, pdfPath) => {
  return await readLink(pdfPath);
});

ipcMain.handle('project-registry-lookup', (_e, idOrTarget) => {
  if (!idOrTarget) return null;
  return projectRegistry.getProject(idOrTarget) || projectRegistry.findByTarget(idOrTarget) || null;
});

ipcMain.handle('project-extract-snapshot', async (_e, { pdfPath, targetDir }) => {
  return await extractSnapshot(pdfPath, targetDir);
});

ipcMain.handle('project-add-linked-asset', (_e, { storePath, sourcePath, relDest }) => {
  return projectManager.addLinkedAsset(storePath, sourcePath, relDest);
});

ipcMain.handle('project-export', async (_e, { storePath, exportDest, asZip }) => {
  return await projectManager.exportProject(storePath, exportDest, asZip);
});

ipcMain.handle('project-trash-item', async (_e, itemPath) => {
  if (fs.existsSync(itemPath)) {
    await shell.trashItem(itemPath);
    return true;
  }
  return false;
});

ipcMain.handle('project-reveal-item', (_e, itemPath) => {
  shell.showItemInFolder(itemPath);
  return true;
});

ipcMain.handle('project-acquire-lock', (_e, { storePath, windowId }) => {
  return projectManager.acquireLock(storePath, windowId);
});

ipcMain.handle('project-release-lock', (_e, storePath) => {
  projectManager.releaseLock(storePath);
  return true;
});

function handleResolvedAction(action, targetWin) {
  const currentWin = targetWin || win;
  if (!action) return;

  if (action.action === 'open-linked') {
    // If window already open for this project, bring to front
    const existing = openProjectWindows.get(action.projectId);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return;
    }

    if (currentWin && !currentWin.isDestroyed()) {
      openProjectWindows.set(action.projectId, currentWin);
      let manifest = null;
      try { manifest = projectManager.loadManifest(action.storePath); } catch (_) {}
      currentWin.webContents.send('open-linked-project', {
        projectId: action.projectId,
        name: action.name,
        storePath: action.storePath,
        targetPath: action.targetPath,
        mainFile: manifest ? manifest.main : null
      });
    }
  } else if (action.action === 'create-linked') {
    const { id, storePath, manifest } = projectManager.createProject({
      name: action.name,
      targetPath: action.targetPath,
      template: action.template
    });
    if (currentWin && !currentWin.isDestroyed()) {
      openProjectWindows.set(id, currentWin);
      currentWin.webContents.send('open-linked-project', {
        projectId: id,
        name: manifest.name,
        storePath,
        targetPath: action.targetPath,
        mainFile: manifest ? manifest.main : null,
        compileImmediate: true
      });
    }
  } else if (action.action === 'prompt-relink-or-restore') {
    if (currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('prompt-relink-or-restore', {
        projectId: action.projectId,
        name: action.name,
        targetPath: action.targetPath,
        hasSnapshot: action.hasSnapshot
      });
    }
  } else if (action.action === 'prompt-claim-pdf') {
    if (currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('prompt-claim-pdf', {
        targetPath: action.targetPath,
        name: action.name,
        template: action.template
      });
    }
  } else if (action.action === 'error') {
    if (currentWin && !currentWin.isDestroyed()) {
      dialog.showErrorBox("Errore Apertura Lack", action.message);
    }
  } else if (action.action === 'classic') {
    if (currentWin && !currentWin.isDestroyed()) {
      if (action.openFolderPath) {
        currentWin.webContents.send('open-folder', action.openFolderPath);
      }
      if (action.openFilePath) {
        const content = fs.existsSync(action.openFilePath) ? fs.readFileSync(action.openFilePath, 'utf8') : '';
        currentWin.webContents.send('load-tex', action.openFilePath, content);
      }
      if (action.promptConvertTexToProject) {
        currentWin.webContents.send('prompt-convert-tex-to-project', { texPath: action.promptConvertTexToProject });
      }
    }
  }
}

function createWindow() {
  initializeRemote();

  const isMac = process.platform === 'darwin';
  const iconPath = fs.existsSync(path.join(__dirname, 'images', 'lack.png'))
    ? path.join(__dirname, 'images', 'lack.png')
    : path.join(__dirname, 'build', 'lack.png');

  const windowOptions = {
    width: 1280,
    height: 850,
    minWidth: 700,
    minHeight: 450,
    backgroundColor: '#1f1f1f',
    icon: iconPath,
    autoHideMenuBar: true,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 15, y: 19 } }
      : { frame: false }),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      clipboard: true,
      webSecurity: false // allow local PDF file preview
    }
  };

  win = new BrowserWindow(windowOptions);
  remoteMain.enable(win.webContents);

  // Suppress native menubar completely on Linux/Windows so custom in-DOM titlebar is used exclusively
  if (!isMac) {
    win.setMenuBarVisibility(false);
    win.removeMenu();
  }

  // Global reliable zoom interceptor across all keyboard layouts (IT, US, EU)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const isCtrlOrCmd = process.platform === 'darwin' ? input.meta : input.control;
    if (!isCtrlOrCmd || input.alt) return;

    // Zoom In: Ctrl + Plus, Ctrl + =, NumpadAdd
    if (input.key === '+' || input.key === '=' || input.code === 'NumpadAdd' || (input.shift && input.code === 'Equal')) {
      if (!win.isDestroyed()) win.webContents.send('zoom-in');
      event.preventDefault();
      return;
    }

    // Zoom Out: Ctrl + Minus, Ctrl + _, NumpadSubtract
    if (input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract' || input.code === 'Minus') {
      if (!win.isDestroyed()) win.webContents.send('zoom-out');
      event.preventDefault();
      return;
    }

    // Zoom Reset: Ctrl + 0, Numpad0
    if (input.key === '0' || input.code === 'Numpad0' || input.code === 'Digit0') {
      if (!win.isDestroyed()) win.webContents.send('zoom-reset');
      event.preventDefault();
      return;
    }

    // Rotate Theme: Ctrl + M (without Shift or Alt)
    if ((input.key === 'm' || input.key === 'M' || input.code === 'KeyM') && !input.shift && !input.alt) {
      if (!win.isDestroyed()) win.webContents.send('toggle-theme');
      event.preventDefault();
      return;
    }
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.error(`[RENDERER CONSOLE] [Level ${level}] ${message} (${sourceId}:${line})`);
  });

  win.loadFile("index.html");

  win.on('maximize', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window-maximize-changed', true);
    }
  });

  win.on('unmaximize', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window-maximize-changed', false);
    }
  });

  win.on('closed', () => {
    win = null;
  });

  buildApplicationMenu();
}

ipcMain.on('app-language-changed', (event, lang) => {
  i18n.setLanguage(lang);
  buildApplicationMenu();
});

function buildApplicationMenu() {
  if (!win) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "New LaTeX File",
          accelerator: "CmdOrCtrl+N",
          click: () => { win.webContents.send("new-file"); }
        },
        {
          label: "New Project...",
          click: () => { win.webContents.send("menu-new-project"); }
        },
        {
          label: "Projects...",
          click: () => { win.webContents.send("open-projects-manager"); }
        },
        {
          label: "Export Project...",
          click: () => { win.webContents.send("menu-export-project"); }
        },
        { type: "separator" },
        {
          label: "Open File...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              filters: [{ name: "LaTeX Files", extensions: ["tex", "bib", "cls", "sty", "txt"] }],
              properties: ["openFile", "multiSelections"]
            });
            if (!result.canceled && result.filePaths.length > 0) {
              for (const filePath of result.filePaths) {
                const content = fs.readFileSync(filePath, "utf8");
                win.webContents.send("load-tex", filePath, content);
              }
            }
          }
        },
        {
          label: "Open Project Folder...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              properties: ["openDirectory"]
            });
            if (!result.canceled && result.filePaths.length > 0) {
              win.webContents.send("open-folder", result.filePaths[0]);
            }
          }
        },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => { win.webContents.send("trigger-save"); }
        },
        {
          label: "Save as Template...",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => { win.webContents.send("save-as-template"); }
        },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => { win.webContents.send("close-active-tab"); }
        },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => { win.webContents.send("open-settings"); }
        },
        { type: "separator" },
        { role: "quit", label: "Quit", accelerator: "CmdOrCtrl+Q" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "Redo", accelerator: "CmdOrCtrl+Y", role: "redo" },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "Select All", accelerator: "CmdOrCtrl+A", role: "selectAll" },
        { type: "separator" },
        {
          label: "Choose Template...",
          accelerator: "CmdOrCtrl+T",
          click: () => { win.webContents.send("choose-template"); }
        },
        {
          label: "Find",
          accelerator: "CmdOrCtrl+F",
          click: () => { win.webContents.send("open-search"); }
        }
      ]
    },
    {
      label: "Compile",
      submenu: [
        {
          label: "Recompile Document",
          accelerator: "CmdOrCtrl+Enter",
          click: () => { win.webContents.send("trigger-compile"); }
        },
        {
          id: "menu-item-compile-on-save",
          label: "Compile on Save (Ctrl+S)",
          type: "checkbox",
          checked: true,
          click: (item) => { win.webContents.send("toggle-compile-on-save", item.checked); }
        },
        {
          id: "menu-item-auto-compile",
          label: "Auto-compile",
          type: "checkbox",
          checked: false,
          click: (item) => { win.webContents.send("toggle-auto-compile", item.checked); }
        },
        {
          label: "Recompile from Scratch",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => { win.webContents.send("recompile-from-scratch"); }
        },
        {
          label: "Stop Compilation",
          click: () => { win.webContents.send("stop-compile"); }
        },
        { type: "separator" },
        {
          label: "Toggle Logs and Issues Drawer",
          accelerator: "CmdOrCtrl+Shift+U",
          click: () => { win.webContents.send("toggle-logs"); }
        },
        {
          label: "Clean Auxiliary Files",
          click: () => { win.webContents.send("clean-aux-files"); }
        }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Explorer",
          accelerator: "CmdOrCtrl+R",
          click: () => { win.webContents.send("toggle-explorer"); }
        },
        {
          label: "Outline",
          click: () => { win.webContents.send("toggle-outline"); }
        },
        { type: "separator" },
        {
          label: "Solo Editor",
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => { win.webContents.send("set-view-editor"); }
        },
        {
          label: "Split View",
          accelerator: "CmdOrCtrl+Shift+K",
          click: () => { win.webContents.send("set-view-split"); }
        },
        {
          label: "Solo Preview",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => { win.webContents.send("set-view-preview"); }
        },
        { type: "separator" },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: () => { if (win && !win.isDestroyed()) win.webContents.send("zoom-in"); }
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => { if (win && !win.isDestroyed()) win.webContents.send("zoom-out"); }
        },
        {
          label: "Reset Zoom",
          accelerator: "CmdOrCtrl+0",
          click: () => { if (win && !win.isDestroyed()) win.webContents.send("zoom-reset"); }
        },
        { type: "separator" },
        {
          label: "Theme",
          submenu: [
            {
              label: "Light Mode",
              click: () => { if (win && !win.isDestroyed()) win.webContents.send("set-theme-light"); }
            },
            {
              label: "Dark Mode",
              click: () => { if (win && !win.isDestroyed()) win.webContents.send("set-theme-dark"); }
            },
            {
              label: "GitHub Mode",
              click: () => { if (win && !win.isDestroyed()) win.webContents.send("set-theme-github"); }
            },
            { type: "separator" },
            {
              label: "Rotate Theme",
              accelerator: "CmdOrCtrl+M",
              click: () => { if (win && !win.isDestroyed()) win.webContents.send("toggle-theme"); }
            }
          ]
        }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Install TeX Engine Guide",
          click: () => { win.webContents.send("open-install-guide"); }
        },
        {
          label: "About Lack",
          click: () => { win.webContents.send("open-about"); }
        }
      ]
    }
  ]);
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(menu);
  } else {
    Menu.setApplicationMenu(null);
    if (win && !win.isDestroyed()) {
      win.setMenu(null);
      win.setMenuBarVisibility(false);
    }
  }
}

app.whenReady().then(async () => {
  createWindow();

  initialAction = await resolveOpenAction({
    rawArgv: rawCliArgs,
    cwd: invocationCwd,
    registry: projectRegistry,
    readLinkFn: readLink,
    storeRoot: defaultStoreRoot
  });

  win.webContents.once('did-finish-load', () => {
    if (initialAction) {
      handleResolvedAction(initialAction, win);
    }
  });

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    if (win && !win.isDestroyed()) win.webContents.send('update-available', info);
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[AutoUpdater] Check for updates failed:', err);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("open-file", async (event, filePath) => {
  event.preventDefault();
  const action = await resolveOpenAction({
    rawArgv: [filePath],
    cwd: invocationCwd,
    registry: projectRegistry,
    readLinkFn: readLink,
    storeRoot: defaultStoreRoot
  });
  handleResolvedAction(action, win);
});
