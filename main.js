const { app, BrowserWindow, Menu, dialog, clipboard, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const remoteMain = require("@electron/remote/main");
const { autoUpdater } = require("electron-updater");
const i18n = require("./i18n.js");
const latexCompiler = require("./latex-compiler.js");

app.setName("Lack");
if (process.platform === 'linux') {
  app.setDesktopName('Lack.desktop');
}
if (process.platform === 'win32') {
  app.setAppUserModelId("com.Giovanni.Lack");
}

let win;
let printWin = null;
let openFilePath = null;
let openFolderPath = null;

// Parse command line arguments (e.g. `lack document.tex` or `lack my-project/`)
const args = process.defaultApp ? process.argv.slice(2) : process.argv.slice(1);
const targetArg = args.find(arg => !arg.startsWith('--'));

if (targetArg) {
  const absolutePath = path.resolve(process.cwd(), targetArg);
  if (fs.existsSync(absolutePath)) {
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      openFolderPath = absolutePath;
    } else if (stat.isFile()) {
      openFilePath = absolutePath;
      openFolderPath = path.dirname(absolutePath);
    }
  } else {
    openFilePath = absolutePath;
    openFolderPath = path.dirname(absolutePath);
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    let targetFile = null;
    let targetFolder = null;
    const instanceArgs = argv.slice(process.defaultApp ? 2 : 1);
    const target = instanceArgs.find(arg => !arg.startsWith('--'));
    if (target) {
      const absPath = path.resolve(workingDirectory, target);
      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          targetFolder = absPath;
        } else if (stat.isFile()) {
          targetFile = absPath;
          targetFolder = path.dirname(absPath);
        }
      } else {
        targetFile = absPath;
        targetFolder = path.dirname(absPath);
      }
    }

    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (targetFolder) {
        win.webContents.send('open-folder', targetFolder);
      }
      if (targetFile) {
        const content = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
        win.webContents.send('load-tex', targetFile, content);
      }
    } else {
      if (targetFile) openFilePath = targetFile;
      if (targetFolder) openFolderPath = targetFolder;
      createWindow();
    }
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
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createWindow();

  win.webContents.once('did-finish-load', () => {
    if (openFolderPath && fs.existsSync(openFolderPath)) {
      win.webContents.send('open-folder', openFolderPath);
    }
    if (openFilePath) {
      const content = fs.existsSync(openFilePath) ? fs.readFileSync(openFilePath, 'utf8') : '';
      win.webContents.send('load-tex', openFilePath, content);
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

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (app.isReady() && win) {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        win.webContents.send('open-folder', filePath);
      } else if (stat.isFile()) {
        const content = fs.readFileSync(filePath, 'utf8');
        win.webContents.send('load-tex', filePath, content);
      }
    }
  } else {
    openFilePath = filePath;
  }
});
