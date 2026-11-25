// ====== LACK RENDERER PROCESS ======
const i18n = require("./i18n.js");
const { ipcRenderer, webFrame, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { dialog, clipboard } = require("@electron/remote");

// CodeMirror 6 bundle & PDF.js viewer
const editorLib = require("./renderer.bundle.js");
const pdfViewer = require("./pdf-viewer.js");

// --- INITIAL THEME & LANGUAGE ---
const savedTheme = localStorage.getItem('lack-theme') || 'light';
if (savedTheme === 'dark') {
  document.documentElement.classList.add('dark');
  document.body.classList.add('dark');
} else if (savedTheme === 'github') {
  document.documentElement.classList.add('dark', 'theme-github');
  document.body.classList.add('dark', 'theme-github');
} else {
  document.documentElement.classList.remove('dark', 'theme-github');
  document.body.classList.remove('dark', 'theme-github');
}

const savedLang = localStorage.getItem('lack.lang') || 'it';
i18n.setLanguage(savedLang);

// --- MODULE IMPORTS ---
const createDOMPurify = require("dompurify");
let domPurifyInstance = null;
function getDOMPurify() {
  if (!domPurifyInstance && typeof window !== 'undefined') {
    domPurifyInstance = createDOMPurify(window);
  }
  return domPurifyInstance;
}

// Collaboration is lazy-loaded on demand via getCollabModule()

const LackTemplates = (typeof window !== 'undefined' && window.LackTemplates) || (typeof require === 'function' ? require('./templates.js') : null);
const latexCompiler = require("./latex-compiler.js");
const {
  formatBytes,
  calculateDirSize,
  isCompilableLatexFile,
  filterProjectEntries,
  validateItemName,
  uniqueName,
  isTexFilePath,
  isPathInsideDir,
  resolveMainRelativePath,
  canSetAsMainDocument,
  resolveClassicCompileTarget,
  resolveExportPdfDefaultName,
  listStoreTexFiles,
  computeRange
} = require("./src/projects/ui-controller.js");

const {
  moveFileSafe,
  recordMoveJournal,
  undoMoveJournal
} = require("./src/projects/import.js");

const {
  createNotificationController
} = require("./src/ui/notifications.js");

// ====== UTILS ======
function escapeHtml(s) {
  if (typeof s !== 'string') return String(s);
  return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function debounce(func, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// ====== CLOUD POPUP NOTIFICATIONS ======
const notificationController = createNotificationController({
  doc: document,
  escapeHtml
});

function getOrCreateNotificationContainer() {
  return notificationController.getOrCreateContainer();
}

function showNotification(message, type = 'info', options = {}) {
  return notificationController.showNotification(message, type, options);
}

function showNotificationWithAction(message, actionText, onAction, type = 'info', duration = 8000) {
  const container = getOrCreateNotificationContainer();
  const notification = document.createElement('div');
  notification.className = `cloud-notification ${type} has-action`;
  notification.style.display = 'flex';
  notification.style.alignItems = 'center';
  notification.style.justifyContent = 'space-between';
  notification.style.gap = '10px';
  notification.innerHTML = `
    <span class="cloud-notification-text">${escapeHtml(message)}</span>
    <button class="cloud-notification-action" style="background: rgba(255,255,255,0.2); border: 1px solid currentColor; color: inherit; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 11px; font-weight: bold; flex-shrink: 0;">${escapeHtml(actionText)}</button>
  `;
  container.appendChild(notification);

  let dismissTimer = null;
  let isDismissed = false;

  function dismiss() {
    if (isDismissed) return;
    isDismissed = true;
    clearTimeout(dismissTimer);
    notification.classList.add('cloud-dismiss');
    setTimeout(() => {
      try { notification.remove(); } catch (_) {}
    }, 320);
  }

  const btn = notification.querySelector('.cloud-notification-action');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
      if (typeof onAction === 'function') onAction();
    });
  }

  dismissTimer = setTimeout(dismiss, duration);
  notification.addEventListener('click', (e) => {
    if (e.target !== btn) {
      e.stopPropagation();
      dismiss();
    }
  });
  notification.addEventListener('mouseenter', () => clearTimeout(dismissTimer));
  notification.addEventListener('mouseleave', () => {
    dismissTimer = setTimeout(dismiss, 3000);
  });
}

// ====== CUSTOM CONFIRM DIALOG ======
let currentConfirmResolver = null;
let currentCancelValue = false;

const CONFIRM_ICONS = {
  warning: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  question: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  info: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
};

function closeCustomConfirmDialog(value = false) {
  const modal = document.getElementById('app-confirm-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  if (typeof currentConfirmResolver === 'function') {
    const resolver = currentConfirmResolver;
    currentConfirmResolver = null;
    resolver(value);
  }
}

function showCustomConfirmDialog(options = {}) {
  return new Promise((resolve) => {
    const existingTabCtx = document.getElementById("tab-context-menu");
    if (existingTabCtx) existingTabCtx.remove();
    const existingTreeCtx = document.getElementById("tree-context-menu");
    if (existingTreeCtx) existingTreeCtx.remove();

    const modal = document.getElementById('app-confirm-modal');
    const titleEl = document.getElementById('app-confirm-title');
    const messageEl = document.getElementById('app-confirm-message');
    const iconBox = document.getElementById('app-confirm-icon-box');
    const actionsEl = document.getElementById('app-confirm-actions');

    if (!modal) {
      resolve(options.defaultValue !== undefined ? options.defaultValue : false);
      return;
    }

    currentConfirmResolver = resolve;

    if (titleEl) {
      titleEl.textContent = options.title || (typeof i18n !== 'undefined' ? i18n.t('confirm') : 'Conferma') || 'Conferma';
    }
    if (messageEl) {
      messageEl.textContent = options.message || '';
    }

    const iconType = options.icon || (options.type === 'question' ? 'question' : options.type === 'info' ? 'info' : 'warning');
    if (iconBox) {
      iconBox.className = `app-confirm-icon-box ${iconType}`;
      iconBox.innerHTML = CONFIRM_ICONS[iconType] || CONFIRM_ICONS.warning;
    }

    let buttons = options.buttons;
    if (!buttons) {
      if (options.abortText) {
        buttons = [
          { text: options.abortText, value: 'cancel', isCancel: true },
          { text: options.cancelText || (typeof i18n !== 'undefined' ? i18n.t('dialog_dont_save') : 'Non salvare') || 'Non salvare', value: 'no', isSecondary: true },
          { text: options.okText || (typeof i18n !== 'undefined' ? i18n.t('dialog_save') : 'Salva') || 'Salva', value: 'yes', isPrimary: true }
        ];
      } else {
        buttons = [
          { text: options.cancelText || (typeof i18n !== 'undefined' ? i18n.t('dialog_cancel') : 'Annulla') || 'Annulla', value: false, isCancel: true },
          { text: options.okText || (typeof i18n !== 'undefined' ? i18n.t('confirm') : 'OK') || 'OK', value: true, isPrimary: true, isDanger: !!options.isDanger }
        ];
      }
    }

    const cancelBtnConfig = buttons.find(b => b.isCancel) || buttons[buttons.length - 1];
    currentCancelValue = cancelBtnConfig ? cancelBtnConfig.value : false;

    if (actionsEl) {
      actionsEl.innerHTML = '';
      buttons.forEach((btnConfig, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = btnConfig.text;
        if (btnConfig.isDanger) {
          btn.className = btnConfig.isPrimary ? 'app-confirm-btn-danger app-confirm-btn-primary' : 'app-confirm-btn-danger';
        } else if (btnConfig.isPrimary) {
          btn.className = 'app-confirm-btn-primary';
        } else if (btnConfig.isSecondary) {
          btn.className = 'app-confirm-btn-secondary';
        } else {
          btn.className = 'app-confirm-btn-cancel';
        }
        btn.addEventListener('click', () => {
          closeCustomConfirmDialog(btnConfig.value);
        });
        actionsEl.appendChild(btn);
        if (btnConfig.isPrimary || (!buttons.some(b => b.isPrimary) && idx === 0)) {
          setTimeout(() => { try { btn.focus(); } catch (e) {} }, 40);
        }
      });
    }

    modal.classList.remove('hidden');
  });
}

// ====== AUTO-UPDATE =========================================================
let updateProgressNotification = null;

function showOrUpdateDownloadNotification(message) {
  if (updateProgressNotification && document.body.contains(updateProgressNotification)) {
    const textEl = updateProgressNotification.querySelector('.cloud-notification-text');
    if (textEl) {
      textEl.textContent = message;
      return;
    }
  }
  const container = getOrCreateNotificationContainer();
  const notification = document.createElement('div');
  notification.className = 'cloud-notification info';
  const iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  notification.innerHTML = `
    <div class="cloud-notification-icon" style="display:inline-flex;align-items:center;margin-right:6px;">${iconSvg}</div>
    <span class="cloud-notification-text">${escapeHtml(message)}</span>
  `;
  container.appendChild(notification);
  updateProgressNotification = notification;
}

ipcRenderer.on('update-available', async (event, info) => {
  const versionStr = info?.version ? ` (v${info.version})` : '';
  let choice;
  try {
    choice = await showCustomConfirmDialog({
      title: i18n.t('dialog_update_available_title'),
      message: `${i18n.t('dialog_update_available_message', { version: versionStr })}\n\n${i18n.t('dialog_update_available_detail')}`,
      type: 'question',
      buttons: [
        { text: i18n.t('dialog_update_download_restart'), value: 'download', isPrimary: true },
        { text: i18n.t('dialog_update_discard'), value: 'discard', isCancel: true }
      ],
      defaultValue: 'discard'
    });
  } catch (_) {
    try {
      const resp = dialog.showMessageBoxSync({
        type: 'question',
        title: i18n.t('dialog_update_available_title'),
        message: i18n.t('dialog_update_available_message', { version: versionStr }),
        detail: i18n.t('dialog_update_available_detail'),
        buttons: [
          i18n.t('dialog_update_download_restart'),
          i18n.t('dialog_update_discard')
        ],
        defaultId: 0,
        cancelId: 1
      });
      choice = resp === 0 ? 'download' : 'discard';
    } catch (_) {
      choice = 'discard';
    }
  }

  if (choice === 'download') {
    showOrUpdateDownloadNotification(i18n.t('notif_update_downloading'));
    ipcRenderer.send('start-download-update');
  }
});

ipcRenderer.on('update-download-progress', (event, percent) => {
  showOrUpdateDownloadNotification(i18n.t('notif_update_progress', { percent }));
});

ipcRenderer.on('update-downloaded', () => {
  if (updateProgressNotification) {
    try { updateProgressNotification.remove(); } catch (_) {}
    updateProgressNotification = null;
  }
  showNotification(i18n.t('notif_update_downloaded_restarting'), 'success');
  setTimeout(() => {
    ipcRenderer.send('quit-and-install-update');
  }, 1000);
});

ipcRenderer.on('update-error', async (event, errorMsg) => {
  if (updateProgressNotification) {
    try { updateProgressNotification.remove(); } catch (_) {}
    updateProgressNotification = null;
  }
  let choice;
  try {
    choice = await showCustomConfirmDialog({
      title: i18n.t('dialog_update_error_title'),
      message: i18n.t('dialog_update_error_message', { msg: errorMsg }),
      type: 'warning',
      buttons: [
        { text: i18n.t('dialog_update_open_github'), value: 'github', isPrimary: true },
        { text: i18n.t('dialog_cancel'), value: 'cancel', isCancel: true }
      ],
      defaultValue: 'cancel'
    });
  } catch (_) {
    try {
      const resp = dialog.showMessageBoxSync({
        type: 'warning',
        title: i18n.t('dialog_update_error_title'),
        message: i18n.t('dialog_update_error_message', { msg: errorMsg }),
        buttons: [
          i18n.t('dialog_update_open_github'),
          i18n.t('dialog_cancel')
        ],
        defaultId: 0,
        cancelId: 1
      });
      choice = resp === 0 ? 'github' : 'cancel';
    } catch (_) {
      choice = 'cancel';
    }
  }

  if (choice === 'github') {
    shell.openExternal('https://github.com/sGabellee/lack/releases/latest');
  }
});

// ====== DOM READY ======
window.addEventListener("DOMContentLoaded", async () => {

  // ====== PLATFORM DETECTION & WINDOW CONTROLS ======
  const platform = ipcRenderer.sendSync('get-platform') || 'linux';
  document.body.classList.add(`platform-${platform}`);

  const winMinimizeBtn = document.getElementById("win-minimize");
  const winMaximizeBtn = document.getElementById("win-maximize");
  const winCloseBtn = document.getElementById("win-close");

  const btnCloseAppConfirm = document.getElementById('btn-close-app-confirm');
  if (btnCloseAppConfirm) {
    btnCloseAppConfirm.addEventListener('click', () => closeCustomConfirmDialog(currentCancelValue));
  }
  const appConfirmOverlay = document.getElementById('app-confirm-overlay');
  if (appConfirmOverlay) {
    appConfirmOverlay.addEventListener('click', () => closeCustomConfirmDialog(currentCancelValue));
  }

  winMinimizeBtn?.addEventListener("click", () => ipcRenderer.send("window-minimize"));
  winMaximizeBtn?.addEventListener("click", () => ipcRenderer.send("window-maximize"));
  winCloseBtn?.addEventListener("click", async () => {
    saveActiveTabState();
    const dirtyTabs = tabs.filter(t => t.dirty);
    if (dirtyTabs.length > 0) {
      const canClose = await handleAppCloseRequest();
      if (canClose) {
        isAppForceClosing = true;
        ipcRenderer.send('window-close-confirmed');
      }
    } else {
      ipcRenderer.send("window-close");
    }
  });

  ipcRenderer.on("window-maximize-changed", (_event, isMax) => {
    document.body.classList.toggle("window-maximized", isMax);
  });

  // ====== APP STATE ======
  let tabs = [];
  let activeTabId = null;
  let untitledCounter = 0;
  let currentProjectDir = null;
  let mainDocumentPath = null;
  let mainDocumentExplicit = false;
  let currentCompiledPdfPath = null;
  let latestIssues = [];
  let currentZoomLevel = 1.0;
  let isCompiling = false;
  let autoCompileTimer = null;
  let currentProject = null;
  let isLinkedProject = false;

  // Settings state
  let config = {
    theme: savedTheme,
    lang: savedLang,
    fontSize: parseInt(localStorage.getItem('lack-fontSize') || '14', 10),
    lineWrapping: localStorage.getItem('lack-lineWrapping') !== 'false',
    vimMode: localStorage.getItem('lack-vimMode') === 'true',
    spellLanguage: localStorage.getItem('lack-spellLanguage') || 'it+en',
    engine: localStorage.getItem('lack-engine') || 'pdflatex',
    customEnginePath: localStorage.getItem('lack-customEnginePath') || '',
    autoCompile: localStorage.getItem('lack-autoCompile') === 'true',
    compileOnSave: localStorage.getItem('lack-compileOnSave') !== 'false',
    embedSnapshotDefault: localStorage.getItem('lack-embedSnapshotDefault') === 'true',
    cleanAux: localStorage.getItem('lack-cleanAux') === 'true',
    viewMode: localStorage.getItem('lack-viewMode') || 'split-view'
  };

  // --- DOM REFERENCES ---
  const editorMount = document.getElementById("editor-mount");
  const tabsScrollArea = document.getElementById("tabs-scroll-area");
  const tabsBar = document.getElementById("tabs-bar");
  const emptyState = document.getElementById("empty-state");
  const mainStageContainer = document.getElementById("container");
  const btnRecompile = document.getElementById("btn-recompile");
  const checkAutoCompile = document.getElementById("check-auto-compile");
  const btnToggleLogs = document.getElementById("btn-toggle-logs");
  const badgeErrors = document.getElementById("badge-errors");
  const badgeWarnings = document.getElementById("badge-warnings");
  const logsDrawer = document.getElementById("logs-drawer");
  const logsIssuesList = document.getElementById("logs-issues-list");
  const logsRawText = document.getElementById("logs-raw-text");
  const pdfCanvasContainer = document.getElementById("pdf-canvas-container");
  const pdfEmptyPlaceholder = document.getElementById("pdf-empty-placeholder");
  const pdfErrorPlaceholder = document.getElementById("pdf-error-placeholder");
  const pdfErrorFileline = document.getElementById("pdf-error-fileline");
  const pdfErrorMsg = document.getElementById("pdf-error-msg");
  const btnShowCompileLog = document.getElementById("btn-show-compile-log");
  const btnRetryCompile = document.getElementById("btn-retry-compile");
  const livePreviewEl = document.getElementById("preview");
  const footerMainDoc = document.getElementById("footer-main-doc");
  const footerCompilerEngine = document.getElementById("footer-compiler-engine");
  const lineColCounter = document.getElementById("line-col-counter");
  const wordCountEl = document.getElementById("word-count");
  const titlebarTitle = document.getElementById("titlebar-title");

  // Sync auto-compile checkbox initial state
  if (checkAutoCompile) {
    checkAutoCompile.checked = config.autoCompile;
    checkAutoCompile.addEventListener("change", (e) => {
      config.autoCompile = e.target.checked;
      localStorage.setItem("lack-autoCompile", config.autoCompile);
      updateAutoCompileMenuLabel();
      showNotification(`Auto-compile: ${config.autoCompile ? 'Attivo' : 'Disattivato'}`, "info");
    });
  }

  function updateAutoCompileMenuLabel() {
    const lbl = document.getElementById("menu-label-auto-compile");
    if (lbl) {
      lbl.textContent = `Auto-compile: ${config.autoCompile ? 'On' : 'Off'}`;
    }
  }
  updateAutoCompileMenuLabel();

  function updateCompileOnSaveMenuLabel() {
    const lbl = document.getElementById("menu-label-compile-on-save");
    if (lbl) {
      lbl.textContent = `Compile on Save: ${config.compileOnSave ? 'On' : 'Off'}`;
    }
    const checkEl = document.getElementById("toggle-compile-on-save");
    if (checkEl) checkEl.checked = config.compileOnSave;
  }
  updateCompileOnSaveMenuLabel();

  const checkCompileOnSave = document.getElementById("toggle-compile-on-save");
  if (checkCompileOnSave) {
    checkCompileOnSave.checked = config.compileOnSave;
    checkCompileOnSave.addEventListener("change", (e) => {
      config.compileOnSave = e.target.checked;
      localStorage.setItem("lack-compileOnSave", config.compileOnSave);
      updateCompileOnSaveMenuLabel();
      showNotification(`Compila al salvataggio (Ctrl+S): ${config.compileOnSave ? 'Attivo' : 'Disattivato'}`, "info");
    });
  }

  // Detect available TeX engines on startup
  try {
    const detected = await ipcRenderer.invoke('detect-latex-engines');
    const available = detected.filter(d => d.available);
    if (!available.some(a => a.id === config.engine)) {
      config.engine = latexCompiler.getBestAvailableEngine();
    }
  } catch (e) {}

  updateEngineFooter();

  // ====== INITIALIZE CODEMIRROR 6 ======
  let cachedPreamble = { filePath: null, mtimeMs: -1, text: '' };
  function getProjectMainPreamble() {
    if (!mainDocumentPath || !fs.existsSync(mainDocumentPath)) return '';
    const activeTab = getActiveTab();
    if (activeTab && activeTab.filePath && path.resolve(activeTab.filePath) === path.resolve(mainDocumentPath)) {
      return '';
    }
    const openMainTab = tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(mainDocumentPath));
    if (openMainTab && typeof openMainTab.content === 'string') {
      return openMainTab.content;
    }
    try {
      const st = fs.statSync(mainDocumentPath);
      if (cachedPreamble.filePath !== mainDocumentPath || cachedPreamble.mtimeMs !== st.mtimeMs) {
        cachedPreamble = {
          filePath: mainDocumentPath,
          mtimeMs: st.mtimeMs,
          text: fs.readFileSync(mainDocumentPath, 'utf8')
        };
      }
      return cachedPreamble.text;
    } catch (_) {
      return '';
    }
  }

  const projectContext = {
    getBibKeys: () => getProjectBibKeys(),
    getImageFiles: () => getProjectImageFiles(),
    getTexFiles: () => getProjectTexFiles(),
    getMainPreamble: () => getProjectMainPreamble()
  };

  const cm = editorLib.createCodeMirrorEditor(editorMount, {
    initialValue: '',
    theme: config.theme,
    onCompile: () => triggerCompile(),
    onRotateTheme: () => cycleTheme(),
    getBibKeys: projectContext.getBibKeys,
    getImageFiles: projectContext.getImageFiles,
    getTexFiles: projectContext.getTexFiles,
    getMainPreamble: projectContext.getMainPreamble
  });
  window.cm = cm;
  window.__lackCmInstance = cm;
  window.__lackGetActiveTab = getActiveTab;
  window.__lackTabs = tabs;

  // Immediately apply the saved theme to CodeMirror, the DOM, and segmented controls
  applyTheme(config.theme);

  cm.setLineWrapping(config.lineWrapping);
  cm.setVimMode(config.vimMode);

  // Initialize spellchecker
  editorLib.setSpellLanguage(config.spellLanguage, __dirname);

  // Document change handler: reactive dirty-state derivation
  cm.onDocChange((content) => {
    const tab = getActiveTab();
    if (tab) {
      tab.content = content;
      const isDirty = content !== (tab.savedContent ?? "");
      updateTabDirty(tab.id, isDirty);
    }
    updateWordCount();
    updateOutlineTree();
    if (config.autoCompile) {
      scheduleAutoCompile();
    }
  });

  // Cursor change handler
  cm.onCursorChange((line, col) => {
    lineColCounter.textContent = `Ln ${line}, Col ${col}`;
  });

  // ====== INITIALIZE PDF.JS VIEWER ======
  pdfViewer.initPdfViewer(
    {
      container: pdfCanvasContainer,
      zoomLabel: document.getElementById("pdf-zoom-val"),
      pageInput: document.getElementById("pdf-input-page"),
      totalPages: document.getElementById("pdf-total-pages")
    },
    {
      onSyncTex: (info) => {
        // SyncTeX reverse lookup: search line containing matching text snippet
        if (info && info.text) {
          const docText = cm.getValue();
          const cleanSnippet = info.text.trim();
          if (cleanSnippet.length > 2) {
            let idx = docText.indexOf(cleanSnippet);
            if (idx === -1) {
              const words = cleanSnippet.split(/\s+/).filter(w => w.length >= 4);
              for (const w of words) {
                idx = docText.indexOf(w);
                if (idx !== -1) break;
              }
            }
            if (idx !== -1) {
              const line = cm.view.state.doc.lineAt(idx);
              cm.jumpToLine(line.number);
              showNotification(`SyncTeX: Riga ${line.number}`, "info");
            }
          }
        }
      }
    }
  );

  // ====== SYNCTEX BIDIRECTIONAL NAVIGATION ======
  let cachedSyncTex = null;

  function getActiveSyncTexFile() {
    if (typeof isLinkedProject !== "undefined" && isLinkedProject && typeof currentProject !== "undefined" && currentProject && currentProject.storePath) {
      const storeBuild = path.join(currentProject.storePath, '.lack', 'build');
      const mainBase = currentProject.mainBase ||
        (mainDocumentPath ? path.basename(mainDocumentPath, path.extname(mainDocumentPath)) : 'main');
      const gzPath = path.join(storeBuild, `${mainBase}.synctex.gz`);
      if (fs.existsSync(gzPath)) return gzPath;
      const plainPath = path.join(storeBuild, `${mainBase}.synctex`);
      if (fs.existsSync(plainPath)) return plainPath;
    }
    const pdfPath = typeof pdfViewer.getCurrentPdfPath === "function" ? pdfViewer.getCurrentPdfPath() : null;
    if (pdfPath) {
      const dir = path.dirname(pdfPath);
      const base = path.basename(pdfPath, path.extname(pdfPath));
      const gz1 = path.join(dir, `${base}.synctex.gz`);
      if (fs.existsSync(gz1)) return gz1;
      const gz2 = path.join(dir, '.lack', 'build', `${base}.synctex.gz`);
      if (fs.existsSync(gz2)) return gz2;
      const plain1 = path.join(dir, `${base}.synctex`);
      if (fs.existsSync(plain1)) return plain1;
    }
    const curTab = typeof getActiveTab === "function" ? getActiveTab() : null;
    if (curTab && curTab.filePath) {
      const dir = path.dirname(curTab.filePath);
      const base = path.basename(curTab.filePath, path.extname(curTab.filePath));
      const gz = path.join(dir, `${base}.synctex.gz`);
      if (fs.existsSync(gz)) return gz;
      const plain = path.join(dir, `${base}.synctex`);
      if (fs.existsSync(plain)) return plain;
    }
    return null;
  }

  function normalizeSyncTexKey(filePath) {
    if (!filePath) return '';
    return path.basename(String(filePath)).replace(/\.tex$/i, '').toLowerCase();
  }

  function parseSyncTexRaw(raw) {
    const lineMap = new Map();
    const byFile = new Map();
    const inputIdToKey = new Map();
    const lines = raw.split(/\r?\n/);
    let curPage = 1;
    const unit = 65536;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('Input:')) {
        const inpMatch = /^Input:(\d+):(.+)$/.exec(l);
        if (inpMatch) {
          inputIdToKey.set(inpMatch[1], normalizeSyncTexKey(inpMatch[2].trim()));
        }
      } else if (l.startsWith('{')) {
        const p = parseInt(l.slice(1), 10);
        if (!isNaN(p)) curPage = p;
      } else {
        const m = /[([xkgv](\d+),(\d+):(\d+),(\d+)/.exec(l);
        if (m) {
          const inputId = m[1];
          const lineNum = parseInt(m[2], 10);
          const xSp = parseInt(m[3], 10);
          const ySp = parseInt(m[4], 10);
          const pos = { page: curPage, xPt: xSp / unit, yPt: ySp / unit };
          if (!lineMap.has(lineNum)) {
            lineMap.set(lineNum, pos);
          }
          const fileKey = inputIdToKey.get(inputId);
          if (fileKey) {
            if (!byFile.has(fileKey)) byFile.set(fileKey, new Map());
            const fileMap = byFile.get(fileKey);
            if (!fileMap.has(lineNum)) fileMap.set(lineNum, pos);
          }
        }
      }
    }
    return { map: lineMap, byFile };
  }

  function lookupSyncTexLineInMap(targetMap, lineNum) {
    if (!targetMap) return null;
    if (targetMap.has(lineNum)) return targetMap.get(lineNum);
    for (let offset = 1; offset <= 5; offset++) {
      if (targetMap.has(lineNum - offset)) return targetMap.get(lineNum - offset);
      if (targetMap.has(lineNum + offset)) return targetMap.get(lineNum + offset);
    }
    return null;
  }

  function lookupSyncTexForward(lineNum, activeFilePath = null) {
    const synctexFile = getActiveSyncTexFile();
    if (!synctexFile) return null;
    try {
      const stat = fs.statSync(synctexFile);
      if (!cachedSyncTex || cachedSyncTex.file !== synctexFile || cachedSyncTex.mtime !== stat.mtimeMs) {
        let content = '';
        if (synctexFile.endsWith('.gz')) {
          const buf = fs.readFileSync(synctexFile);
          content = zlib.gunzipSync(buf).toString('utf8');
        } else {
          content = fs.readFileSync(synctexFile, 'utf8');
        }
        const parsed = parseSyncTexRaw(content);
        cachedSyncTex = {
          file: synctexFile,
          mtime: stat.mtimeMs,
          map: parsed.map,
          byFile: parsed.byFile
        };
      }

      if (cachedSyncTex) {
        if (activeFilePath && cachedSyncTex.byFile) {
          const key = normalizeSyncTexKey(activeFilePath);
          const fileMap = cachedSyncTex.byFile.get(key);
          const hit = lookupSyncTexLineInMap(fileMap, lineNum);
          if (hit) return hit;
        }
        return lookupSyncTexLineInMap(cachedSyncTex.map, lineNum);
      }
    } catch (_) {}
    return null;
  }

  async function triggerSyncTexToPdf() {
    if (!cm || !cm.view) return;
    const cursor = cm.view.state.selection.main.head;
    const lineObj = cm.view.state.doc.lineAt(cursor);
    const lineNum = lineObj.number;
    const lineText = lineObj.text.trim();
    const activeTab = getActiveTab();

    // 1. Try SyncTeX data scoped to active file first
    const synctexResult = lookupSyncTexForward(lineNum, activeTab ? activeTab.filePath : null);
    if (synctexResult) {
      await pdfViewer.goToSyncTexPosition(synctexResult.page, synctexResult.xPt, synctexResult.yPt);
      showNotification(`SyncTeX: Pagina ${synctexResult.page}`, "info");
      return;
    }

    // 2. Try section heading
    const secMatch = /\\(?:part|chapter|(?:sub){0,2}section|paragraph)\*?\{([^}]+)\}/.exec(lineText);
    if (secMatch) {
      const title = secMatch[1].trim();
      const found = await pdfViewer.goToSection(title);
      if (found) {
        showNotification(`SyncTeX: ${title}`, "info");
        return;
      }
    }

    // 3. Fallback to text matching
    if (lineText.length > 2) {
      const found = await pdfViewer.goToText(lineText);
      if (found) {
        showNotification(`SyncTeX: Riga ${lineNum}`, "info");
        return;
      }
    }

    showNotification("SyncTeX: Posizione nel PDF non trovata", "info");
  }

  function triggerSyncTexToCode() {
    const text = pdfViewer.getVisiblePdfText();
    if (!text) {
      showNotification("Seleziona del testo nel PDF o fai doppio clic", "info");
      return;
    }

    const docText = cm.getValue();
    const clean = text.trim();
    let idx = docText.indexOf(clean);
    if (idx === -1) {
      const words = clean.split(/\s+/).filter(w => w.length >= 4);
      for (const w of words) {
        idx = docText.indexOf(w);
        if (idx !== -1) break;
      }
    }

    if (idx !== -1) {
      const line = cm.view.state.doc.lineAt(idx);
      cm.jumpToLine(line.number);
      showNotification(`SyncTeX: Riga ${line.number}`, "info");
    } else {
      showNotification("Nessuna riga corrispondente trovata nel sorgente", "warning");
    }
  }

  document.getElementById("btn-synctex-to-pdf")?.addEventListener("click", () => triggerSyncTexToPdf());
  document.getElementById("btn-synctex-to-code")?.addEventListener("click", () => triggerSyncTexToCode());

  window.__lackTriggerSyncTexToPdf = triggerSyncTexToPdf;
  window.__lackTriggerSyncTexToCode = triggerSyncTexToCode;

  document.getElementById("pdf-btn-zoom-in")?.addEventListener("click", () => pdfViewer.zoomIn());
  document.getElementById("pdf-btn-zoom-out")?.addEventListener("click", () => pdfViewer.zoomOut());
  document.getElementById("pdf-btn-fit-width")?.addEventListener("click", () => pdfViewer.autoFitWidth());
  document.getElementById("pdf-btn-fit-page")?.addEventListener("click", () => pdfViewer.autoFitPage());
  document.getElementById("pdf-btn-prev")?.addEventListener("click", () => {
    if (!pdfCanvasContainer.classList.contains("hidden")) {
      pdfViewer.prevPage();
    } else {
      const sheets = livePreviewEl.querySelectorAll('.page-sheet-a4');
      const pageInput = document.getElementById("pdf-input-page");
      let cur = parseInt(pageInput?.value || "1", 10);
      if (cur > 1) {
        cur--;
        if (pageInput) pageInput.value = cur;
        sheets[cur - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  document.getElementById("pdf-btn-next")?.addEventListener("click", () => {
    if (!pdfCanvasContainer.classList.contains("hidden")) {
      pdfViewer.nextPage();
    } else {
      const sheets = livePreviewEl.querySelectorAll('.page-sheet-a4');
      const pageInput = document.getElementById("pdf-input-page");
      let cur = parseInt(pageInput?.value || "1", 10);
      if (cur < sheets.length) {
        cur++;
        if (pageInput) pageInput.value = cur;
        sheets[cur - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  document.getElementById("pdf-input-page")?.addEventListener("change", (e) => {
    const val = parseInt(e.target.value, 10);
    if (!pdfCanvasContainer.classList.contains("hidden")) {
      pdfViewer.goToPage(val);
    } else {
      const sheets = livePreviewEl.querySelectorAll('.page-sheet-a4');
      if (val >= 1 && val <= sheets.length) {
        sheets[val - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
  document.getElementById("pdf-btn-download")?.addEventListener("click", () => downloadPdf());
  document.getElementById("pdf-btn-refresh")?.addEventListener("click", () => triggerCompile());

  // PDF Toolbar Overflow handling
  const pdfBtnOverflow = document.getElementById("pdf-btn-overflow");
  const pdfOverflowDropdown = document.getElementById("pdf-overflow-dropdown");
  const pdfToolbarEl = document.getElementById("pdf-toolbar");

  if (pdfBtnOverflow && pdfOverflowDropdown) {
    pdfBtnOverflow.addEventListener("click", (e) => {
      e.stopPropagation();
      pdfOverflowDropdown.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!pdfOverflowDropdown.classList.contains("hidden") && !pdfOverflowDropdown.contains(e.target) && e.target !== pdfBtnOverflow) {
        pdfOverflowDropdown.classList.add("hidden");
      }
    });

    document.getElementById("pdf-menu-fit-width")?.addEventListener("click", () => {
      pdfOverflowDropdown.classList.add("hidden");
      pdfViewer.autoFitWidth();
    });
    document.getElementById("pdf-menu-fit-page")?.addEventListener("click", () => {
      pdfOverflowDropdown.classList.add("hidden");
      pdfViewer.autoFitPage();
    });
    document.getElementById("pdf-menu-download")?.addEventListener("click", () => {
      pdfOverflowDropdown.classList.add("hidden");
      downloadPdf();
    });
    document.getElementById("pdf-menu-refresh")?.addEventListener("click", () => {
      pdfOverflowDropdown.classList.add("hidden");
      triggerCompile();
    });
  }

  // Responsive toolbar overflow observer
  if (pdfToolbarEl && typeof ResizeObserver !== "undefined") {
    const updateToolbarOverflow = () => {
      const width = pdfToolbarEl.clientWidth;
      const secondaries = pdfToolbarEl.querySelectorAll(".pdf-tool-secondary");
      const fitBtns = pdfToolbarEl.querySelectorAll(".pdf-tool-fit");
      const menuFitWidth = document.getElementById("pdf-menu-fit-width");
      const menuFitPage = document.getElementById("pdf-menu-fit-page");
      const menuFitDivider = document.getElementById("pdf-menu-fit-divider");
      const menuDownload = document.getElementById("pdf-menu-download");
      const menuRefresh = document.getElementById("pdf-menu-refresh");

      // Hide secondaries (download, refresh) when width < 560px
      const hideSecondary = width < 560;
      // Only collapse fit buttons (↔, ↕) into menu if container is ultra-narrow (< 320px)
      const hideFit = width < 320;

      secondaries.forEach(el => {
        if (hideSecondary) el.classList.add("hidden");
        else el.classList.remove("hidden");
      });

      fitBtns.forEach(el => {
        if (hideFit) el.classList.add("hidden");
        else el.classList.remove("hidden");
      });

      // Compact class for text labels (Auto, Log, Pag. / di) when width < 620
      if (width < 620) {
        pdfToolbarEl.classList.add("toolbar-compact");
      } else {
        pdfToolbarEl.classList.remove("toolbar-compact");
      }

      // Ultra-compact class for narrow widths < 480
      if (width < 480) {
        pdfToolbarEl.classList.add("toolbar-ultra-compact");
      } else {
        pdfToolbarEl.classList.remove("toolbar-ultra-compact");
      }

      // Synchronize dropdown menu options with collapsed toolbar items
      if (menuFitWidth) menuFitWidth.style.display = hideFit ? "flex" : "none";
      if (menuFitPage) menuFitPage.style.display = hideFit ? "flex" : "none";
      if (menuFitDivider) menuFitDivider.style.display = (hideFit && hideSecondary) ? "block" : "none";
      if (menuDownload) menuDownload.style.display = hideSecondary ? "flex" : "none";
      if (menuRefresh) menuRefresh.style.display = hideSecondary ? "flex" : "none";

      if (pdfBtnOverflow) {
        if (hideSecondary || hideFit) {
          pdfBtnOverflow.classList.remove("hidden");
        } else {
          pdfBtnOverflow.classList.add("hidden");
          pdfOverflowDropdown?.classList.add("hidden");
        }
      }
    };
    const roToolbar = new ResizeObserver(() => updateToolbarOverflow());
    roToolbar.observe(pdfToolbarEl);
    updateToolbarOverflow();
  }

  // ====== MULTI-FILE PROJECT CONTEXT RESOLVERS ======
  function getActiveSourceRootDir() {
    if (isLinkedProject && currentProject && currentProject.storePath && fs.existsSync(currentProject.storePath)) {
      return currentProject.storePath;
    }
    if (currentProjectDir && fs.existsSync(currentProjectDir)) {
      return currentProjectDir;
    }
    const activeTab = getActiveTab();
    if (activeTab && activeTab.filePath) {
      const d = path.dirname(activeTab.filePath);
      if (fs.existsSync(d)) return d;
    }
    return null;
  }

  function scanSourceRootFiles(matcherFn) {
    const results = [];
    const rootDir = getActiveSourceRootDir();
    if (!rootDir || !fs.existsSync(rootDir)) return results;
    try {
      const scan = (dir, prefix = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'build') continue;
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          const full = path.join(dir, ent.name);
          let isDir = ent.isDirectory();
          if (ent.isSymbolicLink()) {
            try { isDir = fs.statSync(full).isDirectory(); } catch (_) { continue; }
          }
          if (isDir) {
            scan(full, rel);
          } else if (matcherFn(ent.name, full, rel)) {
            results.push({ rel, full });
          }
        }
      };
      scan(rootDir);
    } catch (_) {}
    return results;
  }

  function getProjectBibKeys() {
    const keys = [];
    const bibFiles = scanSourceRootFiles((name) => name.toLowerCase().endsWith('.bib'));
    for (const { full } of bibFiles) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        const matches = content.match(/@\w+\s*\{\s*([^,\s]+)/g);
        if (matches) {
          matches.forEach(m => {
            const k = m.replace(/@\w+\s*\{\s*/, '').trim();
            if (k) keys.push(k);
          });
        }
      } catch (_) {}
    }
    return keys;
  }

  function getProjectImageFiles() {
    return scanSourceRootFiles((name) => /\.(png|jpe?g|pdf|eps|svg)$/i.test(name)).map(f => f.rel);
  }

  function getProjectTexFiles() {
    return scanSourceRootFiles((name) => name.toLowerCase().endsWith('.tex')).map(f => f.rel);
  }

  function resolveProjectInputPath(rawTarget) {
    if (!rawTarget) return null;
    const cleanTarget = String(rawTarget).trim();
    const candidates = path.extname(cleanTarget) ? [cleanTarget] : [cleanTarget, `${cleanTarget}.tex`];
    const activeTab = getActiveTab();
    const searchRoots = [];
    const srcRoot = getActiveSourceRootDir();
    if (srcRoot) searchRoots.push(srcRoot);
    if (activeTab && activeTab.filePath) searchRoots.push(path.dirname(activeTab.filePath));
    if (currentProjectDir) searchRoots.push(currentProjectDir);

    for (const root of searchRoots) {
      for (const rel of candidates) {
        const resolved = path.resolve(root, rel);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          return resolved;
        }
      }
    }

    // Fallback: match by basename within active source root (useful when TeX log strips parent dir)
    const wantedBase = path.basename(candidates[candidates.length - 1]).toLowerCase();
    const hit = scanSourceRootFiles((name) => name.toLowerCase() === wantedBase);
    return hit.length > 0 ? hit[0].full : null;
  }

  // Ctrl+Click multi-file navigation on \input{...} and \include{...}
  editorMount.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey) {
      const sel = cm.view.state.selection.main.head;
      const line = cm.view.state.doc.lineAt(sel);
      const lineText = line.text;
      const inputRegex = /\\(?:input|include|subfile)\{([^}]+)\}/g;
      let m;
      while ((m = inputRegex.exec(lineText)) !== null) {
        const matchStart = line.from + m.index;
        const matchEnd = matchStart + m[0].length;
        if (sel >= matchStart && sel <= matchEnd) {
          const rawTarget = m[1].trim();
          const resolved = resolveProjectInputPath(rawTarget);
          if (resolved) {
            openFileFromPath(resolved);
            showNotification(`Aperto: ${path.basename(resolved)}`, "info");
          } else {
            showNotification(`File non trovato: ${rawTarget}`, "warning");
          }
          break;
        }
      }
    }
  });

  // ====== MULTI-TAB MANAGEMENT ======
  function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) || null;
  }

  function saveActiveTabState() {
    const tab = getActiveTab();
    if (tab && cm) {
      tab.content = cm.getValue();
    }
  }

  function updateTabDirty(tabId, dirty) {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) tab.dirty = dirty;
    const tabEl = document.querySelector(`.editor-tab[data-tab-id="${tabId}"]`);
    if (tabEl) {
      const dirtyDot = tabEl.querySelector(".tab-dirty");
      if (dirtyDot) {
        if (dirty) dirtyDot.classList.add("visible");
        else dirtyDot.classList.remove("visible");
      }
      const titleSpan = tabEl.querySelector(".tab-title");
      if (titleSpan && tab) {
        titleSpan.textContent = `${tab.title}${dirty ? " *" : ""}`;
      }
    }
    if (tab && tab.filePath) {
      const escaped = tab.filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const treeItem = document.querySelector(`.file-tree-item[data-path="${escaped}"]`);
      if (treeItem) {
        treeItem.classList.toggle("is-dirty", dirty);
      }
    }
    updateTitle();
  }

  function updateTitle() {
    const tab = getActiveTab();
    const hasDirty = tabs.some(t => t.dirty);
    if (isLinkedProject && currentProject && currentProject.targetPath) {
      const pdfBase = path.basename(currentProject.targetPath);
      const fullTitle = `${pdfBase}${hasDirty ? " *" : ""} — Lack`;
      titlebarTitle.textContent = fullTitle;
      document.title = fullTitle;
    } else if (!tab) {
      titlebarTitle.textContent = "Lack";
      document.title = "Lack";
    } else {
      const fullTitle = `${tab.title}${tab.dirty ? " *" : ""} - Lack`;
      titlebarTitle.textContent = fullTitle;
      document.title = fullTitle;
    }
  }

  function renderTabs() {
    tabsScrollArea.innerHTML = "";
    if (tabs.length === 0) {
      tabsBar.classList.add("hidden");
      mainStageContainer.classList.add("hidden");
      emptyState.classList.remove("hidden");
      updateTitle();
      return;
    }

    tabsBar.classList.remove("hidden");
    mainStageContainer.classList.remove("hidden");
    emptyState.classList.add("hidden");

    tabs.forEach(tab => {
      const tabEl = document.createElement("div");
      tabEl.className = "editor-tab" + (tab.id === activeTabId ? " active" : "");
      tabEl.dataset.tabId = tab.id;
      tabEl.title = tab.filePath || tab.title;

      const isProjectFile = isLinkedProject && currentProject && tab.filePath && tab.filePath.startsWith(currentProject.storePath);
      const isFolderFile = isLinkedProject && currentProject && tab.filePath && !isProjectFile;

      let badgeHtml = '';
      if (isProjectFile) {
        badgeHtml = '<span class="tab-link-badge" title="File del progetto collegato"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -1px;"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></span>';
      } else if (isFolderFile) {
        const folderName = path.basename(path.dirname(tab.filePath));
        badgeHtml = `<span class="tab-folder-badge" style="font-size:10px; opacity:0.65; margin-right:4px;">${escapeHtml(folderName)}/</span>`;
      }

      tabEl.innerHTML = `
        ${badgeHtml}
        <span class="tab-title">${escapeHtml(tab.title)}${tab.dirty ? " *" : ""}</span>
        <span class="tab-dirty ${tab.dirty ? 'visible' : ''}"></span>
        <button type="button" class="tab-close-btn" title="Chiudi">&times;</button>
      `;

      tabEl.addEventListener("click", (e) => {
        if (e.target.closest(".tab-close-btn")) {
          e.stopPropagation();
          closeTab(tab.id);
        } else {
          switchTab(tab.id);
        }
      });

      // Middle click (auxclick with button 1) closes tab like VS Code
      tabEl.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          closeTab(tab.id);
        }
      });

      // Right-click context menu (VS Code style)
      tabEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showTabContextMenu(e, tab);
      });

      tabsScrollArea.appendChild(tabEl);
    });

    updateTitle();
  }

  function createTab(title, content = "", filePath = null) {
    const id = "tab-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5);
    const newTab = {
      id: id,
      title: title,
      content: content,
      savedContent: content,
      filePath: filePath,
      dirty: false
    };
    tabs.push(newTab);
    switchTab(id);

    if (filePath && !mainDocumentPath && isTexFilePath(filePath)) {
      setMainDocument(filePath);
    }
    if (filePath) {
      watchFileForChanges(filePath);
    }
    return newTab;
  }

  function switchTab(tabId) {
    if (activeTabId === tabId) return;
    saveActiveTabState();

    activeTabId = tabId;
    const tab = getActiveTab();
    if (tab && cm) {
      cm.setValue(tab.content || "");
      cm.clearErrorHighlight();
      if (latestIssues && latestIssues.length > 0) {
        cm.setCompilerIssues(latestIssues, tab.filePath);
      } else {
        cm.clearCompilerIssues();
      }
      syncActiveTreeItem(tab.filePath);
      cm.focus();

      // Phase 8: Text editor mode for non-compilable files
      const isLatex = isCompilableLatexFile(tab.filePath);
      const mainStageEl = document.getElementById("main-stage");
      const compileOptions = document.getElementById("compile-options-container");

      if (!isLatex && tab.filePath) {
        mainStageEl?.classList.add("editor-only-mode");
        if (btnRecompile) btnRecompile.style.display = "none";
        if (compileOptions) compileOptions.style.display = "none";
      } else {
        mainStageEl?.classList.remove("editor-only-mode");
        if (btnRecompile) btnRecompile.style.display = "";
        if (compileOptions) compileOptions.style.display = "";
        setViewMode(config.viewMode);
      }
    }
    renderTabs();
    updateWordCount();
    updateOutlineTree();
    if (searchContainer && !searchContainer.classList.contains("hidden")) {
      runDocumentSearch();
    }
  }

  async function closeTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return false;

    if (tab.dirty) {
      if (activeTabId !== tabId) {
        switchTab(tabId);
      }
      const answer = await showCustomConfirmDialog({
        type: 'question',
        icon: 'question',
        title: i18n.t("dialog_unsaved_title") || "Modifiche non salvate",
        message: i18n.t("dialog_unsaved_tab_message", { name: tab.title }) || `Vuoi salvare le modifiche apportate a "${tab.title}" prima di chiudere?`,
        buttons: [
          { text: i18n.t("dialog_save") || "Salva", value: 0, isPrimary: true },
          { text: i18n.t("dialog_dont_save") || "Non salvare", value: 1, isSecondary: true },
          { text: i18n.t("dialog_cancel") || "Annulla", value: 2, isCancel: true }
        ]
      });

      if (answer === 2) {
        return false; // Abort closing
      }
      if (answer === 0) {
        const saved = await saveFile(tab);
        if (saved === false && tab.dirty) return false;
      }
    }

    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return false;
    tabs.splice(index, 1);

    if (activeTabId === tabId) {
      if (tabs.length > 0) {
        const nextTab = tabs[Math.max(0, index - 1)];
        switchTab(nextTab.id);
      } else {
        activeTabId = null;
        cm.setValue("");
        renderTabs();
      }
    } else {
      renderTabs();
    }
    return true;
  }

  async function closeOtherTabs(targetTabId) {
    const tabsToClose = tabs.filter(t => t.id !== targetTabId);
    for (const t of tabsToClose) {
      const ok = await closeTab(t.id);
      if (!ok) break;
    }
  }

  async function closeTabsToRight(targetTabId) {
    const targetIdx = tabs.findIndex(t => t.id === targetTabId);
    if (targetIdx === -1) return;
    const tabsToClose = tabs.slice(targetIdx + 1);
    for (const t of tabsToClose) {
      const ok = await closeTab(t.id);
      if (!ok) break;
    }
  }

  async function closeSavedTabs() {
    const savedTabs = tabs.filter(t => !t.dirty);
    for (const t of savedTabs) {
      await closeTab(t.id);
    }
  }

  async function closeAllTabs() {
    const allTabs = [...tabs];
    for (const t of allTabs) {
      const ok = await closeTab(t.id);
      if (!ok) break;
    }
  }

  function removeExistingContextMenus() {
    document.getElementById("tab-context-menu")?.remove();
    document.getElementById("tree-context-menu")?.remove();
  }

  function positionContextMenu(menu, clientX, clientY) {
    if (!menu) return;
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    const rect = menu.getBoundingClientRect();
    const left = Math.max(10, Math.min(clientX, window.innerWidth - rect.width - 10));
    const top = Math.max(10, Math.min(clientY, window.innerHeight - rect.height - 10));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function positionContextSubmenu(triggerEl, submenuEl) {
    if (!triggerEl || !submenuEl) return;
    const itemRect = triggerEl.getBoundingClientRect();
    submenuEl.style.left = "100%";
    submenuEl.style.right = "auto";
    submenuEl.style.top = "-4px";
    submenuEl.style.bottom = "auto";
    const subRect = submenuEl.getBoundingClientRect();
    if (subRect.right > window.innerWidth - 10) {
      submenuEl.style.left = "auto";
      submenuEl.style.right = "100%";
    }
    if (subRect.bottom > window.innerHeight - 10) {
      const overflow = subRect.bottom - (window.innerHeight - 10);
      submenuEl.style.top = `${Math.max(-itemRect.top + 10, -4 - overflow)}px`;
    }
  }

  function renderMainDocMenuItemHtml({ filePath, isDir = false, itemId, activeItemId }) {
    if (!filePath || isDir || !isTexFilePath(filePath)) return "";
    const isMain = Boolean(mainDocumentPath && path.resolve(filePath) === path.resolve(mainDocumentPath));
    const eligible = canSetAsMainDocument({
      filePath,
      isDir,
      isMain,
      isLinkedProject,
      storePath: currentProject?.storePath || null
    });
    if (eligible) {
      return `<div class="context-menu-item" id="${itemId}"><span>Imposta come documento principale</span></div>`;
    }
    if (isMain) {
      return `<div class="context-menu-item disabled" id="${activeItemId}"><span>Documento principale attuale</span><span class="context-menu-check">✓</span></div>`;
    }
    return "";
  }

  function showTabContextMenu(e, tab) {
    removeExistingContextMenus();

    const menu = document.createElement("div");
    menu.id = "tab-context-menu";
    menu.className = "tree-context-menu tab-context-menu";

    const hasPath = !!tab.filePath;
    const isDarwin = platform === 'darwin';
    const targetIdx = tabs.findIndex(t => t.id === tab.id);
    const hasTabsToRight = targetIdx < tabs.length - 1;
    const hasOtherTabs = tabs.length > 1;
    const hasSavedTabs = tabs.some(t => !t.dirty);

    const relativePath = hasPath ? (
      (currentProject && currentProject.storePath && tab.filePath.startsWith(currentProject.storePath))
        ? path.relative(currentProject.storePath, tab.filePath)
        : (currentProjectDir && tab.filePath.startsWith(currentProjectDir))
          ? path.relative(currentProjectDir, tab.filePath)
          : path.basename(tab.filePath)
    ) : "";

    const setMainHtml = renderMainDocMenuItemHtml({
      filePath: tab.filePath,
      isDir: false,
      itemId: "tab-ctx-set-main",
      activeItemId: "tab-ctx-main-active"
    });

    menu.innerHTML = `
      <div class="context-menu-item" id="tab-ctx-close">
        <span>${escapeHtml(i18n.t("tab_ctx_close") || "Chiudi")}</span>
        <span class="context-menu-shortcut">${isDarwin ? "⌘W" : "Ctrl+W"}</span>
      </div>
      <div class="context-menu-item ${hasOtherTabs ? '' : 'disabled'}" id="tab-ctx-close-others">
        <span>${escapeHtml(i18n.t("tab_ctx_close_others") || "Chiudi altri")}</span>
      </div>
      <div class="context-menu-item ${hasTabsToRight ? '' : 'disabled'}" id="tab-ctx-close-right">
        <span>${escapeHtml(i18n.t("tab_ctx_close_right") || "Chiudi a destra")}</span>
      </div>
      <div class="context-menu-item ${hasSavedTabs ? '' : 'disabled'}" id="tab-ctx-close-saved">
        <span>${escapeHtml(i18n.t("tab_ctx_close_saved") || "Chiudi salvati")}</span>
      </div>
      <div class="context-menu-item" id="tab-ctx-close-all">
        <span>${escapeHtml(i18n.t("tab_ctx_close_all") || "Chiudi tutti")}</span>
      </div>
      ${setMainHtml ? `<div class="context-menu-divider"></div>${setMainHtml}` : ""}
      <div class="context-menu-divider"></div>
      <div class="context-menu-item ${hasPath ? '' : 'disabled'}" id="tab-ctx-copy-path">
        <span>${escapeHtml(i18n.t("tab_ctx_copy_path") || "Copia percorso")}</span>
      </div>
      <div class="context-menu-item ${hasPath ? '' : 'disabled'}" id="tab-ctx-copy-rel-path">
        <span>${escapeHtml(i18n.t("tab_ctx_copy_rel_path") || "Copia percorso relativo")}</span>
      </div>
      <div class="context-menu-item ${hasPath ? '' : 'disabled'}" id="tab-ctx-reveal">
        <span>${escapeHtml(i18n.t("tab_ctx_reveal") || "Mostra nel gestore file")}</span>
      </div>
    `;

    document.body.appendChild(menu);
    positionContextMenu(menu, e.clientX, e.clientY);

    menu.querySelector("#tab-ctx-close")?.addEventListener("click", () => {
      menu.remove();
      closeTab(tab.id);
    });

    if (hasOtherTabs) {
      menu.querySelector("#tab-ctx-close-others")?.addEventListener("click", () => {
        menu.remove();
        closeOtherTabs(tab.id);
      });
    }

    if (hasTabsToRight) {
      menu.querySelector("#tab-ctx-close-right")?.addEventListener("click", () => {
        menu.remove();
        closeTabsToRight(tab.id);
      });
    }

    if (hasSavedTabs) {
      menu.querySelector("#tab-ctx-close-saved")?.addEventListener("click", () => {
        menu.remove();
        closeSavedTabs();
      });
    }

    menu.querySelector("#tab-ctx-close-all")?.addEventListener("click", () => {
      menu.remove();
      closeAllTabs();
    });

    menu.querySelector("#tab-ctx-set-main")?.addEventListener("click", async () => {
      menu.remove();
      await applyMainDocumentSelection(tab.filePath);
    });

    if (hasPath) {
      menu.querySelector("#tab-ctx-copy-path")?.addEventListener("click", () => {
        menu.remove();
        clipboard.writeText(tab.filePath);
        showNotification(i18n.t("notif_copied") || "Percorso copiato negli appunti!", "info");
      });
      menu.querySelector("#tab-ctx-copy-rel-path")?.addEventListener("click", () => {
        menu.remove();
        clipboard.writeText(relativePath);
        showNotification(i18n.t("notif_copied") || "Percorso relativo copiato negli appunti!", "info");
      });
      menu.querySelector("#tab-ctx-reveal")?.addEventListener("click", () => {
        menu.remove();
        ipcRenderer.invoke('project-reveal-item', tab.filePath);
      });
    }

    const closeHandler = () => {
      menu.remove();
      window.removeEventListener("click", closeHandler);
    };
    setTimeout(() => window.addEventListener("click", closeHandler), 10);
  }

  function newFile(templateContent = null) {
    untitledCounter++;
    const defaultTemplate = templateContent || "\\documentclass[11pt,a4paper]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath,amssymb}\n\n\\title{Document Title}\n\\author{Author Name}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nWrite your content here...\n\n\\end{document}\n";
    createTab(`untitled-${untitledCounter}.tex`, defaultTemplate);
    if (config.autoCompile) {
      triggerCompile();
    }
  }

  async function saveFile(tab = null) {
    const targetTab = tab || getActiveTab();
    if (!targetTab) return false;

    saveActiveTabState();

    // If tab belongs to an active linked project or folder but has no filePath yet, keep it within the project/folder
    if (!targetTab.filePath) {
      if (isLinkedProject && currentProject && currentProject.storePath && fs.existsSync(currentProject.storePath)) {
        targetTab.filePath = path.join(currentProject.storePath, targetTab.title || "new_file.tex");
      } else if (currentProjectDir && fs.existsSync(currentProjectDir)) {
        targetTab.filePath = path.join(currentProjectDir, targetTab.title || "new_file.tex");
      }
    }

    const missingParentDir = !!(targetTab.filePath && !fs.existsSync(path.dirname(targetTab.filePath)));
    const isLatexTab = isCompilableLatexFile(targetTab.filePath || targetTab.title || "documento.tex");
    const needsNewPdfProject = isLatexTab && !isLinkedProject && !currentProjectDir && (!targetTab.filePath || missingParentDir);

    if (needsNewPdfProject) {
      if (missingParentDir) {
        showNotification("La cartella originale non esiste più: scegli dove salvare il nuovo file PDF.", "warning");
      }
      const docsDir = path.join(os.homedir(), "Documents");
      const defaultDir = (currentProjectDir && fs.existsSync(currentProjectDir))
        ? currentProjectDir
        : (currentProject && currentProject.targetPath && fs.existsSync(path.dirname(currentProject.targetPath))
          ? path.dirname(currentProject.targetPath)
          : (fs.existsSync(docsDir) ? docsDir : os.homedir()));
      const sourceName = targetTab.title || (targetTab.filePath ? path.basename(targetTab.filePath) : "documento.tex");
      const rawBase = /^untitled-\d+\.tex$/i.test(sourceName)
        ? "documento"
        : path.basename(sourceName, path.extname(sourceName));
      const defaultPdfName = uniqueName(defaultDir, rawBase || "documento", ".pdf");
      const result = await dialog.showSaveDialog({
        title: "Scegli dove salvare il documento PDF",
        defaultPath: path.join(defaultDir, defaultPdfName),
        filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
      });
      if (result.canceled || !result.filePath) return false;

      let targetPdfPath = result.filePath;
      if (path.extname(targetPdfPath).toLowerCase() !== ".pdf") {
        targetPdfPath = `${targetPdfPath}.pdf`;
      }

      try {
        const baseName = path.basename(targetPdfPath, ".pdf");
        const created = await ipcRenderer.invoke('project-create', {
          name: baseName,
          targetPath: targetPdfPath,
          templateContent: targetTab.content || ""
        });
        const mainTexPath = path.join(created.storePath, created.manifest.main);

        targetTab.filePath = mainTexPath;
        targetTab.title = created.manifest.main;
        targetTab.savedContent = targetTab.content;
        updateTabDirty(targetTab.id, false);
        saveFileHistorySnapshot(targetTab.filePath, targetTab.content);
        watchFileForChanges(targetTab.filePath);

        if (autoCompileTimer) {
          clearTimeout(autoCompileTimer);
          autoCompileTimer = null;
        }

        await openLinkedProject({
          projectId: created.id,
          name: created.manifest.name,
          storePath: created.storePath,
          targetPath: targetPdfPath,
          mainFile: created.manifest.main,
          compileImmediate: false
        });

        renderTabs();
        updateTitle();
        await triggerCompile(false);
        showNotification(`Progetto "${created.manifest.name}" creato: PDF in ${path.basename(targetPdfPath)}`, "info");
        return true;
      } catch (err) {
        showNotification("Errore creazione progetto: " + err.message, "error");
        return false;
      }
    }

    if (!targetTab.filePath || missingParentDir) {
      if (missingParentDir) {
        showNotification("La cartella originale non esiste più: scegli dove salvare il file.", "warning");
      }
      const fallbackDir = (currentProjectDir && fs.existsSync(currentProjectDir))
        ? currentProjectDir
        : (currentProject && currentProject.targetPath && fs.existsSync(path.dirname(currentProject.targetPath))
          ? path.dirname(currentProject.targetPath)
          : null);
      const defaultSavePath = fallbackDir ? path.join(fallbackDir, targetTab.title) : targetTab.title;
      const result = await dialog.showSaveDialog({
        title: missingParentDir ? "Salva file in una nuova posizione" : "Salva file",
        defaultPath: defaultSavePath,
        filters: [{ name: "Tutti i file", extensions: ["*"] }]
      });
      if (result.canceled || !result.filePath) return false;

      targetTab.filePath = result.filePath;
      targetTab.title = path.basename(result.filePath);
      if (!currentProjectDir || !fs.existsSync(currentProjectDir)) {
        currentProjectDir = path.dirname(result.filePath);
      }
      renderTabs();
      updateTitle();
    }

    try {
      const targetDir = path.dirname(targetTab.filePath);
      const tmpPath = path.join(targetDir, `.tmp-${process.pid}-${Date.now()}`);
      await fs.promises.writeFile(tmpPath, targetTab.content, "utf8");
      await fs.promises.rename(tmpPath, targetTab.filePath);

      targetTab.savedContent = targetTab.content;
      updateTabDirty(targetTab.id, false);
      showNotification(`File salvato con successo: ${targetTab.title}`, "info");

      // Save local history revision in .lack/history/ (or .lack-history/)
      saveFileHistorySnapshot(targetTab.filePath, targetTab.content);
      if (targetTab.filePath) watchFileForChanges(targetTab.filePath);

      if (isLinkedProject && currentProject) {
        renderProjectPane(currentProject.storePath);
      } else if (currentProjectDir) {
        renderFolderPane(currentProjectDir);
      }

      // Phase 1: Ctrl+S saves AND compiles
      if (config.compileOnSave && isCompilableLatexFile(targetTab.filePath)) {
        if (autoCompileTimer) {
          clearTimeout(autoCompileTimer);
          autoCompileTimer = null;
        }
        triggerCompile(false).catch(err => {
          console.warn("[LACK] Compile on save error:", err);
        });
      }
      return true;
    } catch (err) {
      showNotification("Errore di salvataggio: " + err.message, "error");
      return false;
    }
  }

  let isAppForceClosing = false;

  async function handleAppCloseRequest() {
    saveActiveTabState();
    const dirtyTabs = tabs.filter(t => t.dirty);
    for (const t of dirtyTabs) {
      switchTab(t.id);
      const answer = await showCustomConfirmDialog({
        type: 'question',
        icon: 'question',
        title: i18n.t("dialog_unsaved_title") || "Modifiche non salvate",
        message: i18n.t("dialog_unsaved_tab_message", { name: t.title }) || `Vuoi salvare le modifiche apportate a "${t.title}" prima di chiudere?`,
        buttons: [
          { text: i18n.t("dialog_save") || "Salva", value: 0, isPrimary: true },
          { text: i18n.t("dialog_dont_save") || "Non salvare", value: 1, isSecondary: true },
          { text: i18n.t("dialog_cancel") || "Annulla", value: 2, isCancel: true }
        ]
      });

      if (answer === 2) {
        return false; // User cancelled
      }
      if (answer === 0) {
        const saved = await saveFile(t);
        if (!saved && t.dirty) return false;
      }
    }
    return true;
  }

  window.addEventListener('beforeunload', (e) => {
    if (isAppForceClosing) return;
    saveActiveTabState();
    const dirtyTabs = tabs.filter(t => t.dirty);
    if (dirtyTabs.length > 0) {
      e.preventDefault();
      e.returnValue = false;
      handleAppCloseRequest().then(canClose => {
        if (canClose) {
          isAppForceClosing = true;
          ipcRenderer.send('window-close-confirmed');
        }
      });
      return false;
    }
  });

  async function saveFileAs() {
    const tab = getActiveTab();
    if (!tab) return false;
    saveActiveTabState();

    const missingParent = !!(tab.filePath && !fs.existsSync(path.dirname(tab.filePath)));
    if ((!tab.filePath || missingParent) && isCompilableLatexFile(tab.filePath || tab.title || "documento.tex")) {
      return await saveFile(tab);
    }

    const preferredDefault = (tab.filePath && fs.existsSync(path.dirname(tab.filePath)))
      ? tab.filePath
      : (currentProjectDir && fs.existsSync(currentProjectDir) ? path.join(currentProjectDir, tab.title) : tab.title);

    const result = await dialog.showSaveDialog({
      title: "Salva come...",
      defaultPath: preferredDefault,
      filters: [
        { name: "LaTeX Document", extensions: ["tex"] },
        { name: "Tutti i file", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) return;

    tab.filePath = result.filePath;
    tab.title = path.basename(result.filePath);
    renderTabs();
    updateTitle();
    try {
      const targetDir = path.dirname(tab.filePath);
      const tmpPath = path.join(targetDir, `.tmp-${process.pid}-${Date.now()}`);
      await fs.promises.writeFile(tmpPath, tab.content, "utf8");
      await fs.promises.rename(tmpPath, tab.filePath);

      tab.savedContent = tab.content;
      updateTabDirty(tab.id, false);
      showNotification(`File salvato: ${tab.title}`, "info");
      saveFileHistorySnapshot(tab.filePath, tab.content);
      watchFileForChanges(tab.filePath);

      if (isLinkedProject && currentProject) {
        renderProjectPane(currentProject.storePath);
      } else if (currentProjectDir) {
        renderFolderPane(currentProjectDir);
      }

      if (config.compileOnSave && isCompilableLatexFile(tab.filePath)) {
        if (autoCompileTimer) {
          clearTimeout(autoCompileTimer);
          autoCompileTimer = null;
        }
        triggerCompile(false).catch(err => {
          console.warn("[LACK] Compile on save error:", err);
        });
      }
    } catch (err) {
      showNotification("Errore durante il salvataggio: " + err.message, "error");
    }
  }

  // Local history snapshot writer (caps at 50 revisions)
  async function saveFileHistorySnapshot(filePath, content) {
    try {
      let historyDir;
      if (isLinkedProject && currentProject && filePath && filePath.startsWith(currentProject.storePath)) {
        historyDir = path.join(currentProject.storePath, '.lack', 'history');
      } else {
        const dir = path.dirname(filePath);
        historyDir = path.join(dir, '.lack-history');
      }
      if (!fs.existsSync(historyDir)) {
        await fs.promises.mkdir(historyDir, { recursive: true });
      }
      const baseName = path.basename(filePath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotPath = path.join(historyDir, `${baseName}.${timestamp}.bak`);
      await fs.promises.writeFile(snapshotPath, content, 'utf8');

      // Cap at last 50 revisions
      const files = (await fs.promises.readdir(historyDir))
        .filter(f => f.startsWith(baseName))
        .sort();
      if (files.length > 50) {
        for (let i = 0; i < files.length - 50; i++) {
          await fs.promises.unlink(path.join(historyDir, files[i])).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("Could not save history snapshot:", e);
    }
  }

  // External file watching: detects external changes to open files
  const activeFileWatchers = new Map();
  function watchFileForChanges(filePath) {
    if (!filePath || activeFileWatchers.has(filePath)) return;
    try {
      const watcher = fs.watch(filePath, { persistent: false }, async (eventType) => {
        if (eventType === 'change') {
          const tab = tabs.find(t => t.filePath === filePath);
          if (!tab) return;
          try {
            const diskContent = await fs.promises.readFile(filePath, 'utf8');
            if (diskContent === tab.content) return;
            if (!tab.dirty) {
              tab.content = diskContent;
              tab.savedContent = diskContent;
              if (activeTabId === tab.id && cm) {
                cm.setValue(diskContent);
              }
              showNotification(`File "${tab.title}" ricaricato dal disco`, 'info');
            } else {
              showNotification(`Attenzione: "${tab.title}" modificato esternamente`, 'warning');
            }
          } catch (_) {}
        }
      });
      activeFileWatchers.set(filePath, watcher);
    } catch (_) {}
  }

  function updateWordCount() {
    const count = cm ? cm.getWordCount() : 0;
    wordCountEl.textContent = `parole: ${count}`;
  }

  function scheduleAutoCompile() {
    if (autoCompileTimer) clearTimeout(autoCompileTimer);
    autoCompileTimer = setTimeout(() => {
      if (!isCompiling) {
        triggerCompile(true); // isAuto = true
      }
    }, 1500);
  }

  // ====== MAIN DOCUMENT & COMPILATION ======
  async function persistProjectMainManifest(filePath) {
    if (!isLinkedProject || !currentProject || !currentProject.storePath || !filePath) return;
    const relMain = resolveMainRelativePath(currentProject.storePath, filePath);
    if (!relMain) return;
    try {
      const manifest = await ipcRenderer.invoke('project-load-manifest', currentProject.storePath);
      if (manifest) {
        manifest.main = relMain;
        await ipcRenderer.invoke('project-save-manifest', currentProject.storePath, manifest);
      }
    } catch (_) {}
  }

  function refreshEditorCompilerState() {
    cachedSyncTex = null;
    cachedPreamble = { filePath: null, mtimeMs: -1, text: '' };
    const activeTab = getActiveTab();
    if (cm && typeof cm.setCompilerIssues === 'function') {
      cm.setCompilerIssues(latestIssues, activeTab ? activeTab.filePath : null);
    }
  }

  function setMainDocument(filePath, options = {}) {
    const {
      explicit = false,
      silent = false,
      persistManifest = false
    } = options;
    if (!filePath) return;

    const resolvedPath = path.resolve(filePath);
    mainDocumentPath = resolvedPath;
    if (explicit) {
      mainDocumentExplicit = true;
    }

    if (isLinkedProject && currentProject) {
      currentProject.mainBase = path.basename(resolvedPath, path.extname(resolvedPath));
    } else if (!isLinkedProject) {
      if (!currentProjectDir || !isPathInsideDir(resolvedPath, currentProjectDir)) {
        currentProjectDir = path.dirname(resolvedPath);
      }
    }

    if (footerMainDoc) {
      footerMainDoc.textContent = `Principale: ${path.basename(resolvedPath)}`;
      footerMainDoc.title = resolvedPath;
    }

    refreshEditorCompilerState();

    if (persistManifest) {
      persistProjectMainManifest(resolvedPath);
    }
    if (!silent) {
      showNotification(`Documento principale impostato: ${path.basename(resolvedPath)}`, "info");
    }
  }

  async function applyMainDocumentSelection(filePath) {
    if (!filePath) return;
    const resolvedPath = path.resolve(filePath);
    setMainDocument(resolvedPath, { explicit: true, persistManifest: false, silent: false });
    await persistProjectMainManifest(resolvedPath);
    if (isLinkedProject && currentProject && currentProject.storePath) {
      renderProjectPane(currentProject.storePath);
    }
    if (currentProjectDir) {
      renderFolderPane(currentProjectDir);
    }
    if (typeof renderTabs === "function") {
      renderTabs();
    }
  }

  function updateEngineFooter() {
    footerCompilerEngine.textContent = `Motore: ${config.engine}`;
  }

  async function triggerCompile(isAuto = false) {
    if (isCompiling) {
      // If auto-compiling, stop existing and let next trigger run
      await ipcRenderer.invoke('stop-compilation');
    }

    const tab = getActiveTab();
    if (!tab && !mainDocumentPath) return;

    if (isLinkedProject && config.engine === "builtin") {
      const wantInstall = await showCustomConfirmDialog({
        title: "Motore TeX richiesto per progetti collegati",
        message: "I progetti collegati con output PDF richiedono un compilatore TeX (come Tectonic). Vuoi installare automaticamente Tectonic (~20MB) adesso?",
        confirmText: "Installa Tectonic",
        cancelText: "Annulla"
      });
      if (wantInstall) {
        showNotification("Download ed estrazione di Tectonic in corso...", "info");
        try {
          await ipcRenderer.invoke('install-tectonic');
          config.engine = "tectonic";
          localStorage.setItem("lack-engine", "tectonic");
          updateEngineFooter();
          showNotification("Tectonic installato con successo! Avvio compilazione...", "info");
        } catch (instErr) {
          showNotification("Errore installazione Tectonic: " + instErr.message, "error");
          return;
        }
      } else {
        return;
      }
    } else if (!isLinkedProject && config.engine === "builtin" && !localStorage.getItem("lack-tectonic-prompted") && !isAuto) {
      localStorage.setItem("lack-tectonic-prompted", "true");
      const wantInstall = await showCustomConfirmDialog({
        title: "Installare compilatore Tectonic?",
        message: "Vuoi installare Tectonic (~20MB, raccomandato) in un clic per produrre PDF completi, o continuare con l'anteprima integrata veloce?",
        confirmText: "Installa Tectonic",
        cancelText: "Usa anteprima integrata"
      });
      if (wantInstall) {
        showNotification("Download ed estrazione di Tectonic in corso...", "info");
        try {
          await ipcRenderer.invoke('install-tectonic');
          config.engine = "tectonic";
          localStorage.setItem("lack-engine", "tectonic");
          updateEngineFooter();
          showNotification("Tectonic installato con successo! Avvio compilazione...", "info");
        } catch (instErr) {
          showNotification("Errore installazione Tectonic: " + instErr.message, "error");
        }
      }
    }

    isCompiling = true;
    btnRecompile.classList.add("compiling");
    saveActiveTabState();

    const isProjectTab = Boolean(
      isLinkedProject &&
      currentProject &&
      tab &&
      tab.filePath &&
      (
        (mainDocumentPath && path.resolve(tab.filePath) === path.resolve(mainDocumentPath)) ||
        (currentProject.storePath && isPathInsideDir(tab.filePath, currentProject.storePath))
      )
    );
    const isProjectCompile = Boolean(isLinkedProject && currentProject && (isProjectTab || !tab));

    let targetPath = (isProjectCompile && mainDocumentPath)
      ? mainDocumentPath
      : resolveClassicCompileTarget({
          activeTab: tab,
          mainDocumentPath: isLinkedProject ? null : mainDocumentPath,
          currentProjectDir: isLinkedProject ? null : currentProjectDir,
          mainDocumentExplicit
        });

    let contentToPass = "";
    if (!targetPath || (tab && tab.filePath && path.resolve(tab.filePath) === path.resolve(targetPath))) {
      contentToPass = cm ? cm.getValue() : (tab ? tab.content : "");
    } else {
      const targetTab = tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(targetPath));
      if (targetTab && typeof targetTab.content === "string") {
        contentToPass = targetTab.content;
      } else if (fs.existsSync(targetPath)) {
        try {
          contentToPass = fs.readFileSync(targetPath, "utf8");
        } catch (_) {
          contentToPass = "";
        }
      }
    }

    const workDir = isProjectCompile
      ? currentProject.storePath
      : (currentProjectDir || (targetPath ? path.dirname(targetPath) : null));
    const outputDir = isProjectCompile ? path.join(currentProject.storePath, '.lack', 'build') : null;

    // Stage any dirty open subfiles belonging to workDir so unsaved \input files compile live
    const extraBuffers = [];
    if (workDir) {
      const resolvedWorkDir = path.resolve(workDir);
      const resolvedTarget = targetPath ? path.resolve(targetPath) : null;
      for (const t of tabs) {
        if (!t.dirty || !t.filePath || typeof t.content !== "string") continue;
        const resolvedTab = path.resolve(t.filePath);
        if (resolvedTarget && resolvedTab === resolvedTarget) continue;
        const rel = path.relative(resolvedWorkDir, resolvedTab);
        if (rel && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.startsWith(`.lack${path.sep}`) && rel !== ".lack") {
          extraBuffers.push({ relPath: rel, content: t.content });
        }
      }
    }

    const compileOpts = {
      filePath: targetPath,
      content: contentToPass,
      projectDir: workDir,
      outputDir: outputDir,
      engine: config.engine,
      customEnginePath: config.customEnginePath,
      cleanAux: config.cleanAux,
      extraBuffers,
      isMemoryBuffer: true // Compile in-memory buffer without overwriting disk file
    };

    const mainFallbackName = targetPath ? path.basename(targetPath) : 'main.tex';
    const compileSnapshot = cm ? cm.beginCompileSnapshot(tab ? tab.filePath : null) : null;

    try {
      const res = await ipcRenderer.invoke('compile-latex', compileOpts);
      isCompiling = false;
      btnRecompile.classList.remove("compiling");

      latestIssues = res.issues || [];
      const activeAfterTab = getActiveTab();
      if (cm) {
        if (latestIssues.length > 0) {
          cm.setCompilerIssues(latestIssues, activeAfterTab ? activeAfterTab.filePath : null, compileSnapshot);
        } else {
          if (compileSnapshot) cm._activeCompileSnapshots?.delete(compileSnapshot);
          cm.clearCompilerIssues();
        }
      }
      renderLogIssues(latestIssues, res.log, mainFallbackName);

      if (res.success && res.pdfPath && fs.existsSync(res.pdfPath)) {
        currentCompiledPdfPath = res.pdfPath;
        pdfErrorPlaceholder?.classList.add("hidden");
        pdfEmptyPlaceholder.classList.add("hidden");
        livePreviewEl.classList.add("hidden");
        pdfCanvasContainer.classList.remove("hidden");

        await pdfViewer.loadPdfDocument(res.pdfPath);

        // If draft linked project without a target, resolve target on first compile of project
        if (isProjectCompile && !currentProject.targetPath) {
          let resolvedTarget = null;

          // 1. Check if manifest in store already specifies target
          try {
            const manifest = await ipcRenderer.invoke('project-load-manifest', currentProject.storePath);
            if (manifest && manifest.target) {
              resolvedTarget = manifest.target;
            }
          } catch (_) {}

          // 2. Check if registry has lastPdfPath
          if (!resolvedTarget && currentProject.id) {
            try {
              const regHit = await ipcRenderer.invoke('project-registry-lookup', currentProject.id);
              if (regHit && (regHit.targetPath || regHit.lastPdfPath)) {
                resolvedTarget = regHit.targetPath || regHit.lastPdfPath;
              }
            } catch (_) {}
          }

          // 3. Check if currentProjectDir has a matching PDF or can host base.pdf directly
          if (!resolvedTarget && currentProjectDir && fs.existsSync(currentProjectDir)) {
            const base = currentProject.name || path.basename(mainDocumentPath || 'documento', '.tex');
            const directTarget = path.join(currentProjectDir, `${base}.pdf`);
            resolvedTarget = directTarget;
          }

          // 4. Fallback only if no target and no directory
          if (!resolvedTarget) {
            const saveRes = await dialog.showSaveDialog({
              title: "Salva documento PDF del progetto",
              defaultPath: `${currentProject.name || 'documento'}.pdf`,
              filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
            });
            if (!saveRes.canceled && saveRes.filePath) {
              resolvedTarget = path.extname(saveRes.filePath).toLowerCase() === '.pdf'
                ? saveRes.filePath
                : `${saveRes.filePath}.pdf`;
            }
          }

          if (resolvedTarget) {
            currentProject.targetPath = resolvedTarget;
            currentProjectDir = path.dirname(resolvedTarget);
            try {
              const manifest = await ipcRenderer.invoke('project-load-manifest', currentProject.storePath);
              if (manifest) {
                manifest.target = path.resolve(resolvedTarget);
                await ipcRenderer.invoke('project-save-manifest', currentProject.storePath, manifest);
              }
              await ipcRenderer.invoke('project-registry-save', {
                id: currentProject.id,
                storePath: currentProject.storePath,
                name: currentProject.name,
                lastPdfPath: resolvedTarget
              });
            } catch (_) {}
            startTargetPdfWatcher(resolvedTarget);
          }
        }

        // If linked project and compiling the project, post-process atomically to target PDF
        if (isProjectCompile && currentProject.targetPath) {
          try {
            await ipcRenderer.invoke('project-post-process-compile', {
              storePath: currentProject.storePath,
              compiledPdfPath: res.pdfPath,
              targetPdfPath: currentProject.targetPath,
              embedSnapshot: config.embedSnapshotDefault
            });
            const folderDir = path.dirname(currentProject.targetPath);
            renderFolderPane(folderDir);
          } catch (postErr) {
            console.warn('[LACK] Post-processing compile error:', postErr);
            showNotification('Errore aggiornamento PDF collegato: ' + postErr.message, 'warning');
          }
        }

        if (!isAuto) {
          showNotification(i18n.t("notif_compiled_ok", { time: (res.durationMs / 1000).toFixed(1) }), "info");
        }
      } else if (res.isBuiltin && res.htmlPreview) {
        pdfErrorPlaceholder?.classList.add("hidden");
        pdfEmptyPlaceholder.classList.add("hidden");
        pdfCanvasContainer.classList.add("hidden");
        livePreviewEl.classList.remove("hidden");
        renderBuiltinPreview(res.htmlPreview);

        if (!isAuto) {
          showNotification("Anteprima renderizzata con successo", "info");
        }
      } else {
        pdfCanvasContainer.classList.add("hidden");
        livePreviewEl.classList.add("hidden");
        pdfEmptyPlaceholder.classList.add("hidden");

        if (pdfErrorPlaceholder) {
          pdfErrorPlaceholder.classList.remove("hidden");
          const primaryErr = (latestIssues || []).find(i => i.type === "error");
          if (primaryErr) {
            if (pdfErrorFileline) pdfErrorFileline.textContent = `${primaryErr.file || mainFallbackName}:${primaryErr.line || 1}`;
            if (pdfErrorMsg) pdfErrorMsg.textContent = primaryErr.message || "Errore sconosciuto";
          } else {
            if (pdfErrorFileline) pdfErrorFileline.textContent = "Errore di compilazione";
            if (pdfErrorMsg) pdfErrorMsg.textContent = "Il compilatore TeX ha interrotto l'esecuzione senza produrre il PDF.";
          }
        }

        if (!isAuto) {
          showNotification(i18n.t("notif_compiled_fail"), "error");
          logsDrawer.classList.remove("hidden");
        }
      }
    } catch (err) {
      isCompiling = false;
      btnRecompile.classList.remove("compiling");
      pdfCanvasContainer.classList.add("hidden");
      livePreviewEl.classList.add("hidden");
      pdfEmptyPlaceholder.classList.add("hidden");
      if (pdfErrorPlaceholder) {
        pdfErrorPlaceholder.classList.remove("hidden");
        if (pdfErrorFileline) pdfErrorFileline.textContent = "Errore fatale";
        if (pdfErrorMsg) pdfErrorMsg.textContent = err.message || "Errore sconosciuto";
      }
      if (!isAuto) {
        showNotification("Errore di compilazione: " + err.message, "error");
      }
    }
  }

  btnShowCompileLog?.addEventListener("click", () => {
    logsDrawer.classList.remove("hidden");
    document.getElementById("tab-log-issues")?.click();
  });
  btnRetryCompile?.addEventListener("click", () => {
    triggerCompile(false);
  });

  btnRecompile.onclick = () => triggerCompile(false);
  document.getElementById("btn-placeholder-compile")?.addEventListener("click", () => triggerCompile(false));

  function renderBuiltinPreview(htmlContent) {
    const purifier = getDOMPurify();
    const safeHtml = purifier ? purifier.sanitize(htmlContent, {
      ADD_TAGS: ['annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac'],
      ADD_ATTR: ['mathvariant', 'encoding']
    }) : htmlContent;
    livePreviewEl.innerHTML = safeHtml;
    const sheets = livePreviewEl.querySelectorAll('.page-sheet-a4');
    const totalPagesEl = document.getElementById("pdf-total-pages");
    const pageInputEl = document.getElementById("pdf-input-page");
    if (sheets.length > 0) {
      if (totalPagesEl) totalPagesEl.textContent = String(sheets.length);
      if (pageInputEl) {
        pageInputEl.value = 1;
        pageInputEl.max = sheets.length;
      }
    }
    if (window.renderMathInElement) {
      window.renderMathInElement(livePreviewEl, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false
      });
    }
  }

  // ====== LOGS AND ISSUES DRAWER ======
  function renderLogIssues(issues, rawLog, defaultFileName = "main.tex") {
    logsIssuesList.innerHTML = "";
    logsRawText.textContent = rawLog || "";

    const errors = issues.filter(i => i.type === "error");
    const warnings = issues.filter(i => i.type === "warning" || i.type === "box");

    badgeErrors.textContent = errors.length;
    badgeWarnings.textContent = warnings.length;

    badgeErrors.classList.toggle("hidden", errors.length === 0);
    badgeWarnings.classList.toggle("hidden", warnings.length === 0);
    document.getElementById("drawer-issues-count").textContent = issues.length;

    if (issues.length === 0) {
      logsIssuesList.innerHTML = `<div style="padding:16px; color:#888888; text-align:center;">${i18n.t("logs_no_issues")}</div>`;
      return;
    }

    issues.forEach(iss => {
      const isErr = iss.type === "error";
      const item = document.createElement("div");
      item.className = `log-issue-item ${isErr ? 'error' : 'warning'}`;

      let missingPackageBanner = "";
      if (iss.missingPackage) {
        const cmd = `tlmgr install ${iss.missingPackage}`;
        missingPackageBanner = `
          <div style="margin-top:6px; padding:6px 8px; background:rgba(128,0,127,0.12); border-radius:4px; font-size:11px;">
            Pacchetto mancante: <strong>${escapeHtml(iss.missingPackage)}.sty</strong>
            <button type="button" class="btn-copy-install" style="margin-left:8px; padding:2px 6px; font-size:10px; background:#80007f; color:#fff; border:none; border-radius:3px; cursor:pointer;">Copia comando</button>
          </div>
        `;
      }

      const badgeLabel = isErr ? "ERRORE" : (iss.type === "box" ? "BOX" : "AVVISO");

      item.innerHTML = `
        <div class="log-issue-header">
          <span class="log-issue-badge ${isErr ? 'error' : 'warning'}">${badgeLabel}</span>
          <span class="log-issue-file">${escapeHtml(iss.rawFile || iss.file || defaultFileName)}:${iss.line}</span>
        </div>
        <div class="log-issue-msg">${escapeHtml(iss.message)}</div>
        ${missingPackageBanner}
      `;

      item.querySelector(".btn-copy-install")?.addEventListener("click", (e) => {
        e.stopPropagation();
        clipboard.writeText(`tlmgr install ${iss.missingPackage}`);
        showNotification(`Comando copiato: tlmgr install ${iss.missingPackage}`, "info");
      });

      item.addEventListener("click", () => {
        const targetCandidate = iss.rawFile || iss.file;
        const activeTab = getActiveTab();
        if (targetCandidate) {
          const resolvedIssueFile = resolveProjectInputPath(targetCandidate);
          if (resolvedIssueFile && (!activeTab || !activeTab.filePath || path.resolve(activeTab.filePath) !== path.resolve(resolvedIssueFile))) {
            openFileFromPath(resolvedIssueFile);
          }
        }
        if (iss.line && cm) {
          cm.jumpToLine(iss.line);
          cm.highlightErrorLine(iss.line);
        }
      });

      logsIssuesList.appendChild(item);
    });
  }

  btnToggleLogs.onclick = () => logsDrawer.classList.toggle("hidden");
  document.getElementById("btn-close-logs").onclick = () => logsDrawer.classList.add("hidden");
  document.getElementById("btn-clear-logs").onclick = () => {
    const isSearchActive = document.getElementById("tab-log-search")?.classList.contains("active");
    if (isSearchActive) {
      if (projectSearchInput) projectSearchInput.value = "";
      btnProjectSearchClear?.classList.add("hidden");
      if (projectSearchResults) projectSearchResults.innerHTML = "";
      if (projectSearchSummary) projectSearchSummary.textContent = "";
      if (drawerSearchCount) {
        drawerSearchCount.textContent = "0";
        drawerSearchCount.classList.add("hidden");
      }
      return;
    }
    logsIssuesList.innerHTML = `<div style="padding:16px; color:#888888; text-align:center;">${i18n.t("logs_no_issues")}</div>`;
    logsRawText.textContent = "";
    badgeErrors.classList.add("hidden");
    badgeWarnings.classList.add("hidden");
    document.getElementById("drawer-issues-count").textContent = "0";
    if (cm) cm.clearErrorHighlight();
  };

  function switchLogsTab(activeTabName) {
    const tabIssues = document.getElementById("tab-log-issues");
    const tabRaw = document.getElementById("tab-log-raw");
    const tabSearch = document.getElementById("tab-log-search");
    const paneIssues = document.getElementById("logs-issues-pane");
    const paneRaw = document.getElementById("logs-raw-pane");
    const paneSearch = document.getElementById("logs-search-pane");

    tabIssues?.classList.toggle("active", activeTabName === "issues");
    tabRaw?.classList.toggle("active", activeTabName === "raw");
    tabSearch?.classList.toggle("active", activeTabName === "search");

    paneIssues?.classList.toggle("active", activeTabName === "issues");
    paneRaw?.classList.toggle("active", activeTabName === "raw");
    paneSearch?.classList.toggle("active", activeTabName === "search");
  }

  document.getElementById("tab-log-issues").onclick = () => switchLogsTab("issues");
  document.getElementById("tab-log-raw").onclick = () => switchLogsTab("raw");
  document.getElementById("tab-log-search")?.addEventListener("click", () => {
    switchLogsTab("search");
    document.getElementById("project-search-input")?.focus();
  });

  // ====== IN-DOCUMENT SEARCH (Ctrl+F) ======
  const searchContainer = document.getElementById("search-container");
  const searchInput = document.getElementById("search-input");
  const searchButton = document.getElementById("search-button");
  const searchPrev = document.getElementById("search-prev");
  const searchNext = document.getElementById("search-next");
  const searchClose = document.getElementById("search-close");
  const searchResults = document.getElementById("search-results");

  function openDocumentSearch() {
    if (!searchContainer || !searchInput) return;
    searchContainer.classList.remove("hidden");
    const sel = cm ? cm.getSelection() : "";
    if (sel && !sel.includes("\n")) {
      searchInput.value = sel;
    }
    searchInput.focus();
    searchInput.select();
    runDocumentSearch();
  }

  function closeDocumentSearch() {
    if (!searchContainer) return;
    searchContainer.classList.add("hidden");
    if (cm) {
      cm.clearSearch();
      cm.focus();
    }
    if (searchResults) searchResults.textContent = "0/0";
  }

  function runDocumentSearch() {
    if (!searchInput || !searchResults) return;
    const query = searchInput.value;
    if (!query) {
      if (cm) cm.clearSearch();
      searchResults.textContent = "0/0";
      return;
    }
    if (cm) {
      const { count, current } = cm.search(query);
      searchResults.textContent = `${current}/${count}`;
    }
  }

  function findNextInDocument() {
    if (!cm) return;
    const { count, current } = cm.findNext();
    if (searchResults) searchResults.textContent = `${current}/${count}`;
  }

  function findPrevInDocument() {
    if (!cm) return;
    const { count, current } = cm.findPrevious();
    if (searchResults) searchResults.textContent = `${current}/${count}`;
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      runDocumentSearch();
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          findPrevInDocument();
        } else {
          findNextInDocument();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeDocumentSearch();
      }
    });
  }

  searchButton?.addEventListener("click", () => findNextInDocument());
  searchNext?.addEventListener("click", () => findNextInDocument());
  searchPrev?.addEventListener("click", () => findPrevInDocument());
  searchClose?.addEventListener("click", () => closeDocumentSearch());

  if (cm && typeof cm.onSearch === "function") {
    cm.onSearch(() => openDocumentSearch());
  }
  if (cm && typeof cm.onProjectSearch === "function") {
    cm.onProjectSearch(() => openProjectSearch());
  }

  // ====== PROJECT-WIDE SEARCH (Ctrl+Shift+F) ======
  const projectSearchInput = document.getElementById("project-search-input");
  const btnProjectSearchClear = document.getElementById("btn-project-search-clear");
  const btnProjectSearchCase = document.getElementById("btn-project-search-case");
  const btnProjectSearchWord = document.getElementById("btn-project-search-word");
  const btnProjectSearchRun = document.getElementById("btn-project-search-run");
  const projectSearchSummary = document.getElementById("project-search-summary");
  const projectSearchResults = document.getElementById("project-search-results");
  const drawerSearchCount = document.getElementById("drawer-search-count");

  let projectSearchCaseSensitive = false;
  let projectSearchWholeWord = false;
  let projectSearchDebounceTimer = null;

  function openProjectSearch(initialQuery = "") {
    logsDrawer.classList.remove("hidden");
    switchLogsTab("search");
    if (projectSearchInput) {
      if (initialQuery) {
        projectSearchInput.value = initialQuery;
      } else {
        const sel = cm ? cm.getSelection() : "";
        if (sel && !sel.includes("\n")) {
          projectSearchInput.value = sel;
        }
      }
      projectSearchInput.focus();
      projectSearchInput.select();
      btnProjectSearchClear?.classList.toggle("hidden", !projectSearchInput.value);
      if (projectSearchInput.value.trim()) {
        executeProjectSearch();
      }
    }
  }

  function getAllProjectTexFileDescriptors() {
    const fileMap = new Map();

    if (isLinkedProject && currentProject && currentProject.storePath) {
      try {
        const storeTexFiles = listStoreTexFiles(currentProject.storePath, fs);
        for (const item of storeTexFiles) {
          fileMap.set(path.resolve(item.fullPath), {
            relPath: item.relPath || item.name,
            fullPath: item.fullPath
          });
        }
      } catch (_) {}
    } else {
      const scanned = scanSourceRootFiles((name) => name.toLowerCase().endsWith(".tex"));
      for (const item of scanned) {
        fileMap.set(path.resolve(item.full), {
          relPath: item.rel,
          fullPath: item.full
        });
      }
    }

    for (const t of tabs) {
      if (t.filePath) {
        const abs = path.resolve(t.filePath);
        if (t.filePath.toLowerCase().endsWith(".tex") && !fileMap.has(abs)) {
          const base = path.basename(t.filePath);
          const root = getActiveSourceRootDir();
          const rel = root && t.filePath.startsWith(root) ? path.relative(root, t.filePath) : base;
          fileMap.set(abs, { relPath: rel, fullPath: t.filePath });
        }
      } else {
        fileMap.set(`untitled:${t.id}`, {
          relPath: t.title || "untitled.tex",
          fullPath: null,
          tabId: t.id
        });
      }
    }

    return Array.from(fileMap.values());
  }

  function getFileContentForSearch(fileDesc) {
    if (fileDesc.tabId) {
      const tab = tabs.find(t => t.id === fileDesc.tabId);
      if (tab) {
        return activeTabId === tab.id && cm ? cm.getValue() : (tab.content || "");
      }
    }
    if (fileDesc.fullPath) {
      const openTab = tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(fileDesc.fullPath));
      if (openTab) {
        return activeTabId === openTab.id && cm ? cm.getValue() : (openTab.content || "");
      }
      try {
        return fs.readFileSync(fileDesc.fullPath, "utf8");
      } catch (_) {
        return "";
      }
    }
    return "";
  }

  function executeProjectSearch() {
    if (!projectSearchInput || !projectSearchResults || !projectSearchSummary) return;
    const rawQuery = projectSearchInput.value;
    const query = rawQuery.trim();

    btnProjectSearchClear?.classList.toggle("hidden", !rawQuery);

    if (!query) {
      projectSearchResults.innerHTML = "";
      projectSearchSummary.textContent = "";
      drawerSearchCount?.classList.add("hidden");
      if (drawerSearchCount) drawerSearchCount.textContent = "0";
      return;
    }

    let regex;
    try {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = projectSearchWholeWord ? `\\b${escaped}\\b` : escaped;
      regex = new RegExp(pattern, projectSearchCaseSensitive ? "g" : "gi");
    } catch (_) {
      projectSearchSummary.textContent = "Espressione di ricerca non valida.";
      return;
    }

    const files = getAllProjectTexFileDescriptors();
    const resultsByFile = [];
    let totalMatches = 0;

    for (const fileDesc of files) {
      const content = getFileContentForSearch(fileDesc);
      if (!content) continue;

      const lines = content.split(/\r?\n/);
      const fileMatches = [];

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const lineText = lines[lineIdx];
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(lineText)) !== null) {
          fileMatches.push({
            lineNum: lineIdx + 1,
            col: match.index + 1,
            matchLength: match[0].length,
            matchIndex: match.index,
            lineText
          });
          if (match[0].length === 0) break;
        }
      }

      if (fileMatches.length > 0) {
        totalMatches += fileMatches.length;
        resultsByFile.push({
          fileDesc,
          matches: fileMatches
        });
      }
    }

    renderProjectSearchResults(query, resultsByFile, totalMatches);
  }

  function escapeProjectSearchHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderProjectSearchResults(query, resultsByFile, totalMatches) {
    if (drawerSearchCount) {
      drawerSearchCount.textContent = String(totalMatches);
      drawerSearchCount.classList.toggle("hidden", totalMatches === 0);
    }

    if (totalMatches === 0) {
      projectSearchSummary.textContent = `Nessuna corrispondenza trovata per "${query}".`;
      projectSearchResults.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--fg-muted, #888888); font-size: 12px;">Nessun risultato nei file .tex del progetto.</div>`;
      return;
    }

    const filesCount = resultsByFile.length;
    projectSearchSummary.textContent = filesCount === 1 && totalMatches === 1
      ? `1 corrispondenza trovata in 1 file.`
      : `${totalMatches} corrispondenze trovate in ${filesCount} file.`;

    projectSearchResults.innerHTML = "";

    for (const group of resultsByFile) {
      const groupEl = document.createElement("div");
      groupEl.className = "project-search-file-group";

      const headerEl = document.createElement("div");
      headerEl.className = "project-search-file-header";
      headerEl.title = group.fileDesc.fullPath || group.fileDesc.relPath;
      headerEl.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
        </svg>
        <span class="file-path">${escapeProjectSearchHtml(group.fileDesc.relPath)}</span>
        <span class="project-search-file-badge">${group.matches.length}</span>
      `;
      headerEl.addEventListener("click", () => {
        navigateToMatch(group.fileDesc, 1, 1, 0);
      });
      groupEl.appendChild(headerEl);

      const listEl = document.createElement("div");
      listEl.className = "project-search-matches-list";

      for (const m of group.matches) {
        const itemEl = document.createElement("div");
        itemEl.className = "project-search-item";
        itemEl.title = `Riga ${m.lineNum}, Col ${m.col}`;

        const before = escapeProjectSearchHtml(m.lineText.slice(0, m.matchIndex));
        const matched = escapeProjectSearchHtml(m.lineText.slice(m.matchIndex, m.matchIndex + m.matchLength));
        const after = escapeProjectSearchHtml(m.lineText.slice(m.matchIndex + m.matchLength));

        itemEl.innerHTML = `
          <span class="project-search-line-badge">Ln ${m.lineNum}</span>
          <span class="project-search-snippet">${before}<mark class="project-search-highlight">${matched}</mark>${after}</span>
        `;

        itemEl.addEventListener("click", () => {
          navigateToMatch(group.fileDesc, m.lineNum, m.col, m.matchLength);
        });

        listEl.appendChild(itemEl);
      }

      groupEl.appendChild(listEl);
      projectSearchResults.appendChild(groupEl);
    }
  }

  function navigateToMatch(fileDesc, lineNum, col, matchLength) {
    if (fileDesc.tabId) {
      switchTab(fileDesc.tabId);
    } else if (fileDesc.fullPath) {
      openFileFromPath(fileDesc.fullPath);
    }
    if (cm && cm.view) {
      cm.jumpToLine(lineNum, col);
      if (matchLength > 0) {
        const doc = cm.view.state.doc;
        const targetLine = Math.max(1, Math.min(lineNum, doc.lines));
        const lineObj = doc.line(targetLine);
        const from = Math.min(lineObj.from + Math.max(0, col - 1), lineObj.to);
        const to = Math.min(from + matchLength, lineObj.to);
        cm.view.dispatch({
          selection: { anchor: from, head: to },
          scrollIntoView: true
        });
      }
      cm.focus();
    }
  }

  btnProjectSearchClear?.addEventListener("click", () => {
    if (projectSearchInput) {
      projectSearchInput.value = "";
      btnProjectSearchClear.classList.add("hidden");
      executeProjectSearch();
      projectSearchInput.focus();
    }
  });

  btnProjectSearchCase?.addEventListener("click", () => {
    projectSearchCaseSensitive = !projectSearchCaseSensitive;
    btnProjectSearchCase.classList.toggle("active", projectSearchCaseSensitive);
    executeProjectSearch();
  });

  btnProjectSearchWord?.addEventListener("click", () => {
    projectSearchWholeWord = !projectSearchWholeWord;
    btnProjectSearchWord.classList.toggle("active", projectSearchWholeWord);
    executeProjectSearch();
  });

  btnProjectSearchRun?.addEventListener("click", () => {
    executeProjectSearch();
  });

  projectSearchInput?.addEventListener("input", () => {
    clearTimeout(projectSearchDebounceTimer);
    projectSearchDebounceTimer = setTimeout(() => {
      executeProjectSearch();
    }, 250);
  });

  projectSearchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(projectSearchDebounceTimer);
      executeProjectSearch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      logsDrawer.classList.add("hidden");
      if (cm) cm.focus();
    }
  });

  document.getElementById("footer-btn-project-search")?.addEventListener("click", () => {
    openProjectSearch();
  });

  async function cleanAuxiliaryFiles() {
    const workDir = isLinkedProject && currentProject ? currentProject.storePath : currentProjectDir;
    const buildDir = isLinkedProject && currentProject ? path.join(currentProject.storePath, '.lack', 'build') : null;
    const removed = latexCompiler.cleanAuxiliaryFiles(workDir, buildDir);
    showNotification(`File ausiliari puliti: ${removed} file rimossi.`, "info");
  }

  async function downloadPdf() {
    if (!currentCompiledPdfPath || !fs.existsSync(currentCompiledPdfPath)) {
      showNotification("Nessun PDF compilato disponibile per il download. Compila prima il documento.", "warning");
      return;
    }

    const defaultName = resolveExportPdfDefaultName({
      isLinkedProject,
      targetPath: currentProject ? currentProject.targetPath : null,
      currentCompiledPdfPath
    });
    const res = await dialog.showSaveDialog({
      title: "Salva/Esporta PDF",
      defaultPath: defaultName,
      filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
    });

    if (!res.canceled && res.filePath) {
      try {
        fs.copyFileSync(currentCompiledPdfPath, res.filePath);
        showNotification("PDF esportato con successo!", "info");
      } catch (err) {
        showNotification("Errore durante l'esportazione PDF: " + err.message, "error");
      }
    }
  }

  // ====== TWO-PANE EXPLORER & LINKED PROJECTS ======
  const folderTreeEl = document.getElementById("folder-tree") || document.getElementById("file-tree");
  const fileTreeLegacy = document.getElementById("file-tree");
  const projectTreeEl = document.getElementById("project-tree");
  const folderPane = document.getElementById("folder-pane");
  const projectPane = document.getElementById("project-pane");
  const sidebarSplitter = document.getElementById("sidebar-splitter");
  const folderPathEl = document.getElementById("folder-path");
  const projectPaneName = document.getElementById("project-pane-name");
  const footerProjectChip = document.getElementById("footer-project-chip");
  const footerProjectName = document.getElementById("footer-project-name");
  const projectInfoPopover = document.getElementById("project-info-popover");

  let targetPdfWatcher = null;
  function startTargetPdfWatcher(targetPath) {
    if (targetPdfWatcher) {
      try { targetPdfWatcher.close(); } catch (_) {}
      targetPdfWatcher = null;
    }
    if (!targetPath) return;
    const targetDir = path.dirname(targetPath);
    const targetName = path.basename(targetPath);
    try {
      targetPdfWatcher = fs.watch(targetDir, (eventType, filename) => {
        if (filename === targetName) {
          if (!fs.existsSync(targetPath)) {
            showNotification(`Attenzione: Il file PDF "${targetName}" è stato spostato o eliminato esternamente.`, "warning");
          }
          renderFolderPane(targetDir);
        }
      });
    } catch (_) {}
  }

  function openFolder(folderPath) {
    if (!fs.existsSync(folderPath)) return;

    if (isLinkedProject) {
      const isSameFolder = currentProject && currentProject.targetPath &&
        path.resolve(folderPath) === path.resolve(path.dirname(currentProject.targetPath));
      if (!isSameFolder) {
        closeLinkedProject();
      }
    }

    currentProjectDir = folderPath;
    if (folderPathEl) {
      folderPathEl.textContent = path.basename(folderPath);
      folderPathEl.classList.remove("hidden");
    }

    mainDocumentExplicit = false;
    // Check for main.tex in folder
    const defaultMain = path.join(folderPath, "main.tex");
    if (fs.existsSync(defaultMain)) {
      setMainDocument(defaultMain);
      openFileFromPath(defaultMain);
    } else if (mainDocumentPath && !isPathInsideDir(mainDocumentPath, folderPath)) {
      mainDocumentPath = null;
      if (footerMainDoc) {
        footerMainDoc.textContent = "Principale: —";
        footerMainDoc.title = "";
      }
    }

    renderFolderPane(folderPath);
  }

  function renderFileTree(dir) {
    renderFolderPane(dir);
  }

  async function openLinkedProject(opts) {
    // opts: { projectId, name, storePath, targetPath, compileImmediate }
    if (isLinkedProject && currentProject && currentProject.storePath &&
        opts.storePath && path.resolve(currentProject.storePath) !== path.resolve(opts.storePath)) {
      try { await ipcRenderer.invoke('project-release-lock', currentProject.storePath); } catch (_) {}
      if (targetPdfWatcher) {
        try { targetPdfWatcher.close(); } catch (_) {}
        targetPdfWatcher = null;
      }
    }

    let targetPath = opts.targetPath || null;
    let manifest = null;
    if (opts.storePath) {
      try {
        manifest = await ipcRenderer.invoke('project-load-manifest', opts.storePath);
        if (!targetPath && manifest && manifest.target) {
          targetPath = manifest.target;
        }
      } catch (_) {}
    }
    if (!targetPath && opts.projectId) {
      try {
        const regHit = await ipcRenderer.invoke('project-registry-lookup', opts.projectId);
        if (regHit && (regHit.targetPath || regHit.lastPdfPath)) {
          targetPath = regHit.targetPath || regHit.lastPdfPath;
        }
      } catch (_) {}
    }

    isLinkedProject = true;
    currentProject = {
      projectId: opts.projectId,
      name: opts.name || (manifest ? manifest.name : 'Untitled Project'),
      storePath: opts.storePath,
      targetPath: targetPath
    };

    // Try to acquire PID lock
    try {
      await ipcRenderer.invoke('project-acquire-lock', {
        storePath: opts.storePath,
        windowId: process.pid
      });
    } catch (e) {
      console.warn('[LACK] Lock acquire note:', e);
    }

    document.getElementById("explorer-panel")?.classList.remove("hidden");
    projectPane?.classList.remove("hidden");
    sidebarSplitter?.classList.remove("hidden");
    const savedRatio = parseFloat(localStorage.getItem("lack-sidebar-split-ratio") || "0.5");
    if (folderPane) folderPane.style.flex = `${savedRatio}`;
    if (projectPane) projectPane.style.flex = `${1 - savedRatio}`;
    footerProjectChip?.classList.remove("hidden");
    if (footerProjectName) footerProjectName.textContent = currentProject.name;
    if (projectPaneName) projectPaneName.textContent = currentProject.name;

    updateTitle();

    // Folder pane = folder of target PDF (or current directory if draft)
    if (targetPath) {
      const folderDir = path.dirname(targetPath);
      currentProjectDir = folderDir;
      if (folderPathEl) {
        folderPathEl.textContent = path.basename(folderDir);
        folderPathEl.classList.remove("hidden");
      }
      renderFolderPane(folderDir);
    } else if (currentProjectDir) {
      renderFolderPane(currentProjectDir);
    }

    // Determine main document from opts.mainFile, manifest, <name>.tex, or main.tex
    let mainFileName = opts.mainFile || (manifest ? manifest.main : null);
    if (!mainFileName) {
      const candidateName = `${currentProject.name}.tex`;
      if (fs.existsSync(path.join(opts.storePath, candidateName))) {
        mainFileName = candidateName;
      } else {
        mainFileName = "main.tex";
      }
    }
    const mainTexPath = path.isAbsolute(mainFileName) ? mainFileName : path.join(opts.storePath, mainFileName);
    mainDocumentExplicit = false;
    if (fs.existsSync(mainTexPath)) {
      setMainDocument(mainTexPath);
      openFileFromPath(mainTexPath);
    }

    // Project pane = storePath (rendered after mainDocumentPath is resolved)
    renderProjectPane(opts.storePath);

    if (opts.compileImmediate) {
      triggerCompile(false);
    } else if (targetPath && fs.existsSync(targetPath)) {
      pdfViewer.loadPdfDocument(targetPath);
    }

    if (targetPath) {
      startTargetPdfWatcher(targetPath);
    }
  }

  function closeLinkedProject() {
    const closedStorePath = currentProject && currentProject.storePath ? path.resolve(currentProject.storePath) : null;
    if (closedStorePath) {
      ipcRenderer.invoke('project-release-lock', currentProject.storePath);
    }
    if (targetPdfWatcher) {
      try { targetPdfWatcher.close(); } catch (_) {}
      targetPdfWatcher = null;
    }
    if (closedStorePath && mainDocumentPath) {
      const rel = path.relative(closedStorePath, path.resolve(mainDocumentPath));
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        mainDocumentPath = null;
        mainDocumentExplicit = false;
        if (footerMainDoc) {
          footerMainDoc.textContent = "Principale: —";
          footerMainDoc.title = "";
        }
      }
    }
    isLinkedProject = false;
    currentProject = null;
    projectPane?.classList.add("hidden");
    sidebarSplitter?.classList.add("hidden");
    if (folderPane) folderPane.style.flex = "1";
    footerProjectChip?.classList.add("hidden");
    updateTitle();
    if (currentProjectDir) renderFolderPane(currentProjectDir);
  }

  function syncActiveTreeItem(filePath) {
    if (!filePath) return;
    try {
      const resolved = path.resolve(filePath);
      document.querySelectorAll(".tree-item").forEach(item => {
        if (item.title && path.resolve(item.title) === resolved) {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });
    } catch (_) {}
  }

  function renderFolderPane(dir) {
    const targetContainer = folderTreeEl || fileTreeLegacy;
    if (!targetContainer) return;
    targetContainer.innerHTML = "";

    let effectiveDir = dir;
    if (isLinkedProject && currentProject && currentProject.targetPath) {
      const targetFolder = path.dirname(currentProject.targetPath);
      if (!effectiveDir || (currentProject.storePath && effectiveDir.startsWith(currentProject.storePath))) {
        effectiveDir = targetFolder;
      }
    }

    if (folderPathEl && effectiveDir) {
      folderPathEl.textContent = path.basename(effectiveDir);
      folderPathEl.classList.remove("hidden");
    }

    if (!effectiveDir || !fs.existsSync(effectiveDir)) {
      targetContainer.innerHTML = `<div style="padding: 16px; font-size: 11.5px; opacity: 0.6; text-align: center;">Nessuna cartella aperta</div>`;
      return;
    }

    const rootUl = document.createElement("ul");
    rootUl.className = "tree-root";
    buildFolderTreeRecursive(effectiveDir, rootUl);
    targetContainer.appendChild(rootUl);
    updateExplorerSelectionUI();
  }

  // ====== EXPLORER SELECTION, MULTI-SELECT & DELETION ======
  let selectedExplorerPaths = [];
  let selectedExplorerPath = null;
  let selectedExplorerElement = null;
  let lastExplorerAnchorPath = null;

  function getAllExplorerItems() {
    const container = document.getElementById("sidebar-tab-content-files") || document.getElementById("explorer-panel");
    if (!container) return [];
    const items = Array.from(container.querySelectorAll(".tree-item:not(.tree-inline-input)"));
    const visible = items.filter(el => el.offsetParent !== null && !el.closest('.hidden'));
    return visible.length > 0 ? visible : items;
  }

  function clearExplorerSelection() {
    document.querySelectorAll(".tree-item.selected").forEach(el => {
      el.classList.remove("selected");
    });
    selectedExplorerPaths = [];
    selectedExplorerPath = null;
    selectedExplorerElement = null;
  }

  function updateExplorerSelectionUI() {
    const allItems = getAllExplorerItems();
    const pathSet = new Set(selectedExplorerPaths.map(p => path.resolve(p)));
    allItems.forEach(el => {
      const elPath = el.dataset.path ? path.resolve(el.dataset.path) : null;
      if (elPath && pathSet.has(elPath)) {
        el.classList.add("selected");
      } else {
        el.classList.remove("selected");
      }
    });
  }

  async function activateExplorerFile(itemPath) {
    if (!itemPath) return;
    if (itemPath.toLowerCase().endsWith(".pdf")) {
      let isLinked = false;
      try {
        const link = await ipcRenderer.invoke('project-read-link', itemPath);
        const regHit = await ipcRenderer.invoke('project-registry-lookup', (link && link.id) ? link.id : itemPath);
        if (regHit && regHit.storePath && fs.existsSync(regHit.storePath)) {
          isLinked = true;
          await openLinkedProject({
            projectId: regHit.projectId || link?.id,
            name: regHit.name || link?.name || path.basename(itemPath, '.pdf'),
            storePath: regHit.storePath,
            targetPath: itemPath,
            compileImmediate: false
          });
        }
      } catch (e) {
        console.warn('[LACK] PDF link check error:', e);
      }

      if (!isLinked) {
        pdfViewer.loadPdfDocument(itemPath);
      }
    } else {
      openFileFromPath(itemPath);
    }
  }

  function handleExplorerItemClick(itemPath, itemDiv, event, isDir, childUl, isTargetPdf) {
    if (!itemPath || !itemDiv) return;
    const normalPath = path.resolve(itemPath);
    const isShift = event && event.shiftKey;
    const isCtrlOrCmd = event && (event.ctrlKey || event.metaKey);

    if (isShift) {
      if (typeof window !== 'undefined' && window.getSelection) {
        try { window.getSelection().removeAllRanges(); } catch (_) {}
      }
      const allItems = getAllExplorerItems();
      const flatPaths = allItems.map(el => el.dataset.path).filter(Boolean);
      const rangePaths = computeRange(flatPaths, lastExplorerAnchorPath, itemPath);

      if (!isCtrlOrCmd) {
        selectedExplorerPaths = rangePaths;
      } else {
        const combined = new Set([...selectedExplorerPaths.map(p => path.resolve(p)), ...rangePaths.map(p => path.resolve(p))]);
        selectedExplorerPaths = Array.from(combined);
      }

      selectedExplorerPath = itemPath;
      selectedExplorerElement = itemDiv;
      updateExplorerSelectionUI();

      if (!isDir) {
        activateExplorerFile(itemPath);
      }
    } else if (isCtrlOrCmd) {
      const index = selectedExplorerPaths.findIndex(p => path.resolve(p) === normalPath);
      if (index >= 0) {
        selectedExplorerPaths.splice(index, 1);
        if (selectedExplorerPath && path.resolve(selectedExplorerPath) === normalPath) {
          selectedExplorerPath = selectedExplorerPaths.length > 0 ? selectedExplorerPaths[selectedExplorerPaths.length - 1] : null;
          selectedExplorerElement = selectedExplorerPath ? document.querySelector(`.tree-item[data-path="${selectedExplorerPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`) : null;
        }
      } else {
        selectedExplorerPaths.push(itemPath);
        selectedExplorerPath = itemPath;
        selectedExplorerElement = itemDiv;
      }
      lastExplorerAnchorPath = itemPath;
      updateExplorerSelectionUI();
    } else {
      selectedExplorerPaths = [itemPath];
      selectedExplorerPath = itemPath;
      selectedExplorerElement = itemDiv;
      lastExplorerAnchorPath = itemPath;

      updateExplorerSelectionUI();

      document.querySelectorAll(".tree-item").forEach(x => x.classList.remove("active"));
      itemDiv.classList.add("active");

      if (isDir) {
        if (childUl) {
          const chevron = itemDiv.querySelector(".tree-chevron-icon");
          const isCollapsed = childUl.classList.toggle("hidden");
          if (chevron) chevron.style.transform = isCollapsed ? "rotate(0deg)" : "rotate(90deg)";
        }
      } else {
        activateExplorerFile(itemPath);
      }
    }

    try {
      itemDiv.focus();
    } catch (_) {}
  }

  function handleExplorerContextMenu(e, itemDiv, fullPath, isTargetPdf, showMenuFn) {
    const normalPath = path.resolve(fullPath);
    const alreadySelected = (selectedExplorerPaths || []).some(p => path.resolve(p) === normalPath);
    if (!alreadySelected) {
      selectedExplorerPaths = [fullPath];
      selectedExplorerPath = fullPath;
      selectedExplorerElement = itemDiv;
      lastExplorerAnchorPath = fullPath;
      updateExplorerSelectionUI();
    }
    showMenuFn();
  }

  const explorerUndoStack = [];

  async function undoLastExplorerAction() {
    if (explorerUndoStack.length === 0) return false;
    const action = explorerUndoStack.pop();

    if (action.type === 'trash-linked-project') {
      const restoredPdf = action.pdfTrashRec
        ? await ipcRenderer.invoke('project-restore-trash', action.pdfTrashRec)
        : { restored: false };
      const restoredStore = action.storeTrashRec
        ? await ipcRenderer.invoke('project-restore-trash', action.storeTrashRec)
        : { restored: true };

      if (!restoredPdf.restored) {
        showNotification(`Impossibile ripristinare "${path.basename(action.projectInfo?.targetPath || 'PDF')}": ${restoredPdf.error || 'errore sconosciuto'}`, "error");
        document.getElementById('explorer-panel')?.focus({ preventScroll: true });
        return false;
      }

      if (action.storeTrashRec && !restoredStore.restored) {
        showNotification(`PDF ripristinato, ma impossibile ripristinare i sorgenti: ${restoredStore.error || 'errore sconosciuto'}`, "warning");
      }

      if (action.projectInfo?.projectId && action.projectInfo?.storePath && fs.existsSync(action.projectInfo.storePath)) {
        await ipcRenderer.invoke('project-registry-save', {
          id: action.projectInfo.projectId,
          storePath: action.projectInfo.storePath,
          name: action.projectInfo.name,
          lastPdfPath: action.projectInfo.targetPath
        });
      }

      if (currentProjectDir) {
        renderFolderPane(currentProjectDir);
      }

      if (action.projectInfo?.storePath && fs.existsSync(action.projectInfo.storePath)) {
        await openLinkedProject({
          projectId: action.projectInfo.projectId,
          name: action.projectInfo.name,
          storePath: action.projectInfo.storePath,
          targetPath: action.projectInfo.targetPath,
          compileImmediate: false
        });
      }

      showNotification(`Progetto "${action.projectInfo?.name || 'LaTeX'}" ripristinato dal cestino.`, "info");
      document.getElementById('explorer-panel')?.focus({ preventScroll: true });
      return true;
    }

    if (action.type === 'trash-items') {
      let restoredCount = 0;
      const errors = [];
      for (const rec of action.records) {
        const res = await ipcRenderer.invoke('project-restore-trash', rec);
        if (res && res.restored) {
          restoredCount++;
        } else if (res && res.error) {
          errors.push(res.error);
        }
      }

      if (isLinkedProject && currentProject) renderProjectPane(currentProject.storePath);
      if (currentProjectDir) renderFolderPane(currentProjectDir);

      if (restoredCount > 0) {
        const label = action.description || `${restoredCount} element${restoredCount === 1 ? 'o' : 'i'}`;
        showNotification(`Ripristinato dal cestino: ${label}`, "info");
      } else if (errors.length > 0) {
        showNotification(`Impossibile ripristinare: ${errors[0]}`, "error");
      }
      document.getElementById('explorer-panel')?.focus({ preventScroll: true });
      return restoredCount > 0;
    }

    return false;
  }

  async function deleteExplorerFiles(targets) {
    if (!targets) return;
    const pathList = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
    if (pathList.length === 0) return;

    const uniqueMap = new Map();
    for (const fp of pathList) {
      uniqueMap.set(path.resolve(fp), fp);
    }
    const uniquePaths = Array.from(uniqueMap.values());
    const count = uniquePaths.length;
    if (count === 0) return;

    const focusExplorerAfterDelete = () => {
      try {
        document.getElementById('explorer-panel')?.focus({ preventScroll: true });
      } catch (_) {}
    };

    if (count === 1) {
      const singlePath = uniquePaths[0];
      let linkedProj = null;
      let isActiveLinkedPdf = false;
      if (isLinkedProject && currentProject && currentProject.targetPath &&
          path.resolve(singlePath) === path.resolve(currentProject.targetPath)) {
        linkedProj = currentProject;
        isActiveLinkedPdf = true;
      } else if (singlePath.toLowerCase().endsWith('.pdf')) {
        try {
          const link = await ipcRenderer.invoke('project-read-link', singlePath);
          const regHit = await ipcRenderer.invoke('project-registry-lookup', (link && link.id) ? link.id : singlePath);
          if (regHit && regHit.storePath && fs.existsSync(regHit.storePath)) {
            linkedProj = {
              projectId: regHit.projectId || link?.id,
              name: regHit.name || link?.name || path.basename(singlePath, '.pdf'),
              storePath: regHit.storePath,
              targetPath: singlePath
            };
          }
        } catch (_) {}
      }

      if (linkedProj) {
        const choice = await showCustomConfirmDialog({
          title: "Eliminazione PDF collegato",
          message: `Stai spostando nel cestino il file PDF "${path.basename(singlePath)}" collegato al progetto "${linkedProj.name || 'LaTeX'}".\n\nVuoi mantenere i dati sorgente del progetto archiviati (in modo da poter ricreare o duplicare il PDF in qualsiasi momento), oppure eliminare anche tutti i dati del progetto?`,
          buttons: [
            { text: "Annulla", value: 'cancel', isCancel: true },
            { text: "Mantieni sorgenti", value: 'keep_sources', isPrimary: true },
            { text: "Elimina anche dati", value: 'delete_all', isDanger: true }
          ]
        });

        if (!choice || choice === 'cancel') {
          focusExplorerAfterDelete();
          return;
        }

        const openTab = tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(singlePath));
        if (openTab) closeTab(openTab.id);

        if (choice === 'delete_all') {
          const prevRegEntry = linkedProj.projectId
            ? await ipcRenderer.invoke('project-registry-lookup', linkedProj.projectId)
            : null;
          if (isActiveLinkedPdf && linkedProj.storePath) {
            await ipcRenderer.invoke('project-release-lock', linkedProj.storePath);
          }

          const pdfTrashRec = await ipcRenderer.invoke('project-trash-item', singlePath);
          const storeTrashRec = (linkedProj.storePath && fs.existsSync(linkedProj.storePath))
            ? await ipcRenderer.invoke('project-trash-item', linkedProj.storePath)
            : null;

          if (linkedProj.projectId) {
            await ipcRenderer.invoke('project-registry-remove', linkedProj.projectId);
          }

          if (pdfTrashRec && pdfTrashRec.trashed) {
            explorerUndoStack.push({
              type: 'trash-linked-project',
              choice: 'delete_all',
              pdfTrashRec,
              storeTrashRec,
              projectInfo: {
                projectId: linkedProj.projectId,
                name: linkedProj.name || path.basename(singlePath, '.pdf'),
                storePath: prevRegEntry?.storePath || linkedProj.storePath,
                targetPath: singlePath
              }
            });
          }
          showNotification(`PDF e dati del progetto spostati nel cestino (Ctrl+Z per annullare).`, "info");
        } else {
          const pdfTrashRec = await ipcRenderer.invoke('project-trash-item', singlePath);
          if (pdfTrashRec && pdfTrashRec.trashed) {
            explorerUndoStack.push({
              type: 'trash-linked-project',
              choice: 'keep_sources',
              pdfTrashRec,
              storeTrashRec: null,
              projectInfo: {
                projectId: linkedProj.projectId,
                name: linkedProj.name || path.basename(singlePath, '.pdf'),
                storePath: linkedProj.storePath,
                targetPath: singlePath
              }
            });
          }
          showNotification(`PDF "${path.basename(singlePath)}" spostato nel cestino. I sorgenti sono conservati nello store (Ctrl+Z per annullare).`, "info");
        }

        if (isActiveLinkedPdf) closeLinkedProject();
        clearExplorerSelection();
        if (currentProjectDir) renderFolderPane(currentProjectDir);
        focusExplorerAfterDelete();
        return;
      }

      const fileName = path.basename(singlePath);
      const answer = await showCustomConfirmDialog({
        type: 'warning',
        icon: 'warning',
        title: "Sposta nel cestino",
        message: `Sei sicuro di voler spostare "${fileName}" nel cestino?`,
        buttons: [
          { text: "Annulla", value: 1, isCancel: true },
          { text: "Sposta nel cestino", value: 0, isDanger: true, isPrimary: true }
        ]
      });

      if (answer !== 0) {
        focusExplorerAfterDelete();
        return;
      }

      try {
        const trashRec = await ipcRenderer.invoke('project-trash-item', singlePath);
        if (trashRec && trashRec.trashed) {
          explorerUndoStack.push({
            type: 'trash-items',
            records: [trashRec],
            description: fileName
          });
        }
        const openTabs = tabs.filter(t => t.filePath && path.resolve(t.filePath) === path.resolve(singlePath));
        for (const t of openTabs) {
          t.dirty = false;
          closeTab(t.id);
        }
        clearExplorerSelection();
        showNotification(`"${fileName}" spostato nel cestino (Ctrl+Z per annullare).`, "info");
      } catch (err) {
        showNotification("Errore eliminazione: " + err.message, "error");
      }
    } else {
      const answer = await showCustomConfirmDialog({
        type: 'warning',
        icon: 'warning',
        title: "Sposta nel cestino",
        message: `Sei sicuro di voler spostare ${count} elementi nel cestino?`,
        buttons: [
          { text: "Annulla", value: 1, isCancel: true },
          { text: "Sposta nel cestino", value: 0, isDanger: true, isPrimary: true }
        ]
      });

      if (answer !== 0) {
        focusExplorerAfterDelete();
        return;
      }

      let deletedCount = 0;
      const records = [];
      for (const fp of uniquePaths) {
        try {
          const trashRec = await ipcRenderer.invoke('project-trash-item', fp);
          if (trashRec && trashRec.trashed) {
            records.push(trashRec);
          }
          const openTabs = tabs.filter(t => t.filePath && path.resolve(t.filePath) === path.resolve(fp));
          for (const t of openTabs) {
            t.dirty = false;
            closeTab(t.id);
          }
          deletedCount++;
        } catch (err) {
          console.warn("[LACK] Failed to trash item:", fp, err);
        }
      }
      if (records.length > 0) {
        explorerUndoStack.push({
          type: 'trash-items',
          records,
          description: `${deletedCount} element${deletedCount === 1 ? 'o' : 'i'}`
        });
      }
      clearExplorerSelection();
      showNotification(`${deletedCount} element${deletedCount === 1 ? 'o spostato' : 'i spostati'} nel cestino${records.length > 0 ? ' (Ctrl+Z per annullare)' : ''}`, "info");
    }

    if (isLinkedProject && currentProject) {
      renderProjectPane(currentProject.storePath);
    }
    if (currentProjectDir) {
      renderFolderPane(currentProjectDir);
    }
    focusExplorerAfterDelete();
  }

  function buildFolderTreeRecursive(dir, parentElement) {
    let rawEntries;
    try {
      rawEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    const entries = filterProjectEntries(rawEntries);

    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : Boolean(entry.isDirectory);

      const li = document.createElement("li");
      li.className = "tree-node";

      const itemDiv = document.createElement("div");
      itemDiv.className = "tree-item";
      itemDiv.title = fullPath;
      itemDiv.dataset.path = fullPath;
      itemDiv.dataset.isDir = isDir ? "true" : "false";
      itemDiv.tabIndex = -1;
      itemDiv.draggable = true;

      itemDiv.addEventListener("dragstart", (e) => {
        const isSelected = selectedExplorerPaths && selectedExplorerPaths.some(p => path.resolve(p) === path.resolve(fullPath));
        const pathsToSend = isSelected && selectedExplorerPaths.length > 0
          ? selectedExplorerPaths
          : [fullPath];
        e.dataTransfer.setData("application/x-lack-explorer-paths", JSON.stringify(pathsToSend));
        e.dataTransfer.setData("text/plain", JSON.stringify(pathsToSend));
        e.dataTransfer.effectAllowed = "copy";
      });

      const isTargetPdf = isLinkedProject && currentProject && currentProject.targetPath && (path.resolve(fullPath) === path.resolve(currentProject.targetPath));

      if (isDir) {
        itemDiv.innerHTML = `
          <svg class="tree-chevron-icon" width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
          <span class="tree-label">${escapeHtml(entry.name)}</span>
        `;

        const childUl = document.createElement("ul");
        childUl.className = "tree-children hidden";

        itemDiv.addEventListener("click", (e) => {
          handleExplorerItemClick(fullPath, itemDiv, e, true, childUl, false);
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          handleExplorerContextMenu(e, itemDiv, fullPath, false, () => showFolderItemContextMenu(e, itemDiv, fullPath, false));
        });

        li.appendChild(itemDiv);
        li.appendChild(childUl);
        buildFolderTreeRecursive(fullPath, childUl);
      } else {
        const isMainClassic = !isLinkedProject && mainDocumentPath && (path.resolve(fullPath) === path.resolve(mainDocumentPath));
        const linkBadge = isTargetPdf ? `<span class="tree-link-badge" title="PDF collegato al progetto corrente"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 3px; vertical-align: -1px;"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>Collegato</span>` : ``;
        const mainBadge = isMainClassic ? `<span class="tree-link-badge" style="background:#80007f;" title="Documento principale">Principale</span>` : ``;

        itemDiv.className = `tree-item ${isTargetPdf ? 'target-pdf-item' : ''}`;
        itemDiv.innerHTML = `
          <svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          <span class="tree-label">${escapeHtml(entry.name)}</span>
          ${linkBadge}
          ${mainBadge}
        `;

        itemDiv.addEventListener("click", (e) => {
          handleExplorerItemClick(fullPath, itemDiv, e, false, null, isTargetPdf);
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          handleExplorerContextMenu(e, itemDiv, fullPath, isTargetPdf, () => showFolderItemContextMenu(e, itemDiv, fullPath, isTargetPdf));
        });

        li.appendChild(itemDiv);
      }
      parentElement.appendChild(li);
    });
  }

  function renderLinkedPdfMainSubmenuHtml() {
    if (!isLinkedProject || !currentProject?.storePath) return "";
    const storeTexFiles = listStoreTexFiles(currentProject.storePath, fs);
    const resolvedMain = mainDocumentPath ? path.resolve(mainDocumentPath) : null;
    const rows = storeTexFiles.length > 0
      ? storeTexFiles.map(f => {
          const isCurrent = Boolean(resolvedMain && path.resolve(f.fullPath) === resolvedMain);
          return `<div class="context-menu-item ${isCurrent ? 'disabled is-current-main' : ''}" data-tex-path="${escapeHtml(f.fullPath)}"><span class="context-menu-check">${isCurrent ? '✓' : ''}</span><span>${escapeHtml(f.relPath)}</span></div>`;
        }).join("")
      : `<div class="context-menu-item disabled"><span>Nessun file .tex nello store</span></div>`;

    return `
      <div class="context-menu-divider"></div>
      <div class="context-menu-item has-submenu" id="ctx-pdf-set-main">
        <span>File principale (.tex)</span>
        <span class="context-menu-submenu-arrow">▸</span>
        <div class="tree-context-submenu" id="ctx-pdf-main-submenu">${rows}</div>
      </div>
    `;
  }

  function showFolderItemContextMenu(e, itemDiv, fullPath, isTargetPdf) {
    removeExistingContextMenus();

    const menu = document.createElement("div");
    menu.id = "tree-context-menu";
    menu.className = "tree-context-menu";

    let isDir = false;
    try { isDir = fs.statSync(fullPath).isDirectory(); } catch (_) {}

    const setMainHtml = renderMainDocMenuItemHtml({
      filePath: fullPath,
      isDir,
      itemId: "ctx-set-main",
      activeItemId: "ctx-main-active"
    });

    let html = `
      <div class="context-menu-item" id="ctx-open">Apri</div>
      <div class="context-menu-item" id="ctx-duplicate">Duplica</div>
      <div class="context-menu-item" id="ctx-rename">Rinomina</div>
      ${setMainHtml}
      <div class="context-menu-item" id="ctx-reveal">Mostra nel file manager</div>
      <div class="context-menu-item" id="ctx-copy-path">Copia percorso</div>
    `;
    if (isTargetPdf) {
      html += renderLinkedPdfMainSubmenuHtml();
      html += `
        <div class="context-menu-divider"></div>
        <div class="context-menu-item text-danger" id="ctx-unlink">Scollega progetto</div>
      `;
    }
    html += `
      <div class="context-menu-divider"></div>
      <div class="context-menu-item text-danger" id="ctx-delete">Sposta nel cestino</div>
    `;

    menu.innerHTML = html;
    document.body.appendChild(menu);
    positionContextMenu(menu, e.clientX, e.clientY);

    menu.querySelector("#ctx-open").onclick = () => {
      menu.remove();
      if (fullPath.toLowerCase().endsWith(".pdf")) pdfViewer.loadPdfDocument(fullPath);
      else openFileFromPath(fullPath);
    };
    menu.querySelector("#ctx-duplicate").onclick = () => {
      menu.remove();
      try {
        const dupIsDir = fs.statSync(fullPath).isDirectory();
        const ext = dupIsDir ? "" : path.extname(fullPath);
        const base = dupIsDir ? path.basename(fullPath) : path.basename(fullPath, ext);
        const copyName = uniqueName(path.dirname(fullPath), base, ext);
        const copyPath = path.join(path.dirname(fullPath), copyName);
        if (dupIsDir) {
          fs.cpSync(fullPath, copyPath, { recursive: true });
        } else {
          fs.copyFileSync(fullPath, copyPath);
        }
        showNotification(`Elemento duplicato in "${copyName}"`, "info");
        if (currentProjectDir) renderFolderPane(currentProjectDir);
      } catch (err) {
        showNotification("Errore duplicazione: " + err.message, "error");
      }
    };
    menu.querySelector("#ctx-rename").onclick = () => {
      menu.remove();
      showInlineRename(itemDiv, fullPath, () => {
        if (currentProjectDir) renderFolderPane(currentProjectDir);
      });
    };
    if (menu.querySelector("#ctx-set-main")) {
      menu.querySelector("#ctx-set-main").onclick = async () => {
        menu.remove();
        await applyMainDocumentSelection(fullPath);
      };
    }
    menu.querySelector("#ctx-reveal").onclick = () => {
      menu.remove();
      ipcRenderer.invoke('project-reveal-item', fullPath);
    };
    menu.querySelector("#ctx-copy-path").onclick = () => {
      menu.remove();
      clipboard.writeText(fullPath);
      showNotification("Percorso copiato negli appunti", "info");
    };

    const pdfMainTrigger = menu.querySelector("#ctx-pdf-set-main");
    const pdfMainSubmenu = menu.querySelector("#ctx-pdf-main-submenu");
    if (pdfMainTrigger && pdfMainSubmenu) {
      pdfMainTrigger.addEventListener("mouseenter", () => {
        pdfMainTrigger.classList.add("submenu-open");
        positionContextSubmenu(pdfMainTrigger, pdfMainSubmenu);
      });
      pdfMainTrigger.addEventListener("mouseleave", () => {
        pdfMainTrigger.classList.remove("submenu-open");
      });
      pdfMainTrigger.addEventListener("click", (evt) => {
        if (evt.target.closest("#ctx-pdf-main-submenu")) return;
        evt.stopPropagation();
        pdfMainTrigger.classList.toggle("submenu-open");
        if (pdfMainTrigger.classList.contains("submenu-open")) {
          positionContextSubmenu(pdfMainTrigger, pdfMainSubmenu);
        }
      });
      pdfMainSubmenu.querySelectorAll("[data-tex-path]").forEach((optEl) => {
        optEl.addEventListener("click", async (evt) => {
          evt.stopPropagation();
          if (optEl.classList.contains("disabled")) return;
          const selectedTex = optEl.dataset.texPath;
          menu.remove();
          await applyMainDocumentSelection(selectedTex);
        });
      });
    }

    if (isTargetPdf) {
      menu.querySelector("#ctx-unlink").onclick = async () => {
        menu.remove();
        const choice = await showCustomConfirmDialog({
          title: "Scollega Progetto",
          message: `Vuoi scollegare il file PDF "${path.basename(fullPath)}"?\n\nPuoi mantenere i file sorgente archiviati per poter ricreare o duplicare il PDF in futuro, oppure eliminare anche i file sorgente archiviati.`,
          buttons: [
            { text: "Annulla", value: 'cancel', isCancel: true },
            { text: "Mantieni sorgenti", value: 'keep_sources', isPrimary: true },
            { text: "Elimina anche sorgenti", value: 'delete_all', isDanger: true }
          ]
        });
        if (choice === 'keep_sources') {
          await ipcRenderer.invoke('project-unlink', fullPath);
          showNotification("Progetto scollegato. I sorgenti rimangono conservati nello store.", "info");
          closeLinkedProject();
        } else if (choice === 'delete_all') {
          if (currentProject && currentProject.storePath && fs.existsSync(currentProject.storePath)) {
            await ipcRenderer.invoke('project-trash-item', currentProject.storePath);
          }
          await ipcRenderer.invoke('project-unlink', fullPath);
          showNotification("Progetto scollegato e sorgenti spostati nel cestino.", "info");
          closeLinkedProject();
        }
      };
    }

    menu.querySelector("#ctx-delete").onclick = () => {
      menu.remove();
      const targets = (selectedExplorerPaths && selectedExplorerPaths.length > 1 && selectedExplorerPaths.some(p => path.resolve(p) === path.resolve(fullPath)))
        ? selectedExplorerPaths
        : [fullPath];
      deleteExplorerFiles(targets);
    };

    const closeHandler = () => {
      menu.remove();
      window.removeEventListener("click", closeHandler);
    };
    setTimeout(() => window.addEventListener("click", closeHandler), 10);
  }

  function renderProjectPane(storeDir) {
    if (!projectTreeEl) return;
    projectTreeEl.innerHTML = "";
    if (!storeDir || !fs.existsSync(storeDir)) {
      projectTreeEl.innerHTML = `<div style="padding: 16px; font-size: 11.5px; opacity: 0.6; text-align: center;">Store di progetto non trovato</div>`;
      return;
    }

    const rootUl = document.createElement("ul");
    rootUl.className = "tree-root";
    buildProjectTreeRecursive(storeDir, rootUl);
    projectTreeEl.appendChild(rootUl);
    updateExplorerSelectionUI();
  }

  function buildProjectTreeRecursive(dir, parentElement) {
    let rawEntries;
    try {
      rawEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    const entries = filterProjectEntries(rawEntries);

    const isProjectStoreRoot = isLinkedProject && currentProject && currentProject.storePath &&
      (path.resolve(dir) === path.resolve(currentProject.storePath));
    let excludedCompiledPdfNames = null;
    if (isProjectStoreRoot) {
      excludedCompiledPdfNames = new Set();
      if (currentProject.targetPath) {
        excludedCompiledPdfNames.add(path.basename(currentProject.targetPath).toLowerCase());
      }
      if (mainDocumentPath) {
        const mainExt = path.extname(mainDocumentPath);
        const mainBase = path.basename(mainDocumentPath, mainExt);
        if (mainBase) {
          excludedCompiledPdfNames.add(`${mainBase}.pdf`.toLowerCase());
        }
      }
    }

    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      let isSymlink;
      let isBroken = false;
      let isDir;

      try {
        const lst = fs.lstatSync(fullPath);
        isSymlink = lst.isSymbolicLink();
        isDir = lst.isDirectory();
        if (isSymlink) {
          if (!fs.existsSync(fullPath)) isBroken = true;
          else isDir = fs.statSync(fullPath).isDirectory();
        }
      } catch (_) {
        return;
      }

      // Compiled project output PDFs belong in CARTELLA, never inside PROGETTO
      if (excludedCompiledPdfNames && !isDir && !isSymlink &&
          excludedCompiledPdfNames.has(entry.name.toLowerCase())) {
        return;
      }

      const li = document.createElement("li");
      li.className = "tree-node";

      const itemDiv = document.createElement("div");
      itemDiv.className = "tree-item project-tree-item";
      itemDiv.title = fullPath;
      itemDiv.dataset.path = fullPath;
      itemDiv.dataset.isDir = isDir ? "true" : "false";
      itemDiv.tabIndex = -1;

      const isMain = mainDocumentPath && (path.resolve(fullPath) === path.resolve(mainDocumentPath));

      if (isDir) {
        const linkBadge = isSymlink ? `<span class="tree-linked-asset-badge ${isBroken ? 'tree-broken-link' : ''}" title="Risorsa collegata (Symlink)"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -1px;"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></span>` : ``;

        itemDiv.innerHTML = `
          <svg class="tree-chevron-icon" width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
          <span class="tree-label">${escapeHtml(entry.name)}</span>
          ${linkBadge}
        `;

        const childUl = document.createElement("ul");
        childUl.className = "tree-children hidden";

        itemDiv.addEventListener("click", (e) => {
          handleExplorerItemClick(fullPath, itemDiv, e, true, childUl, false);
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          handleExplorerContextMenu(e, itemDiv, fullPath, false, () => showProjectItemContextMenu(e, itemDiv, fullPath, entry.name, true, false));
        });

        li.appendChild(itemDiv);
        li.appendChild(childUl);
        if (!isBroken) {
          buildProjectTreeRecursive(fullPath, childUl);
        }
      } else {
        const linkBadge = isSymlink ? `<span class="tree-linked-asset-badge ${isBroken ? 'tree-broken-link' : ''}" title="Risorsa collegata (Symlink)"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -1px;"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></span>` : ``;
        const mainBadge = isMain ? `<span class="tree-link-badge" style="background:#80007f;" title="Documento principale">Principale</span>` : ``;

        itemDiv.innerHTML = `
          <svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          <span class="tree-label">${escapeHtml(entry.name)}</span>
          ${linkBadge}
          ${mainBadge}
        `;

        itemDiv.addEventListener("click", (e) => {
          handleExplorerItemClick(fullPath, itemDiv, e, false, null, false);
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          handleExplorerContextMenu(e, itemDiv, fullPath, false, () => showProjectItemContextMenu(e, itemDiv, fullPath, entry.name, false, isMain));
        });

        li.appendChild(itemDiv);
      }
      parentElement.appendChild(li);
    });
  }

  function showProjectItemContextMenu(e, itemDiv, fullPath, name, isDir, isMain) {
    removeExistingContextMenus();

    const menu = document.createElement("div");
    menu.id = "tree-context-menu";
    menu.className = "tree-context-menu";

    const setMainHtml = renderMainDocMenuItemHtml({
      filePath: fullPath,
      isDir,
      itemId: "ctx-proj-set-main",
      activeItemId: "ctx-proj-main-active"
    });

    let html = `
      <div class="context-menu-item" id="ctx-proj-open">Apri</div>
      <div class="context-menu-item" id="ctx-proj-rename">Rinomina (F2)</div>
      <div class="context-menu-item" id="ctx-proj-duplicate">Duplica</div>
      ${setMainHtml}
    `;

    html += `
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" id="ctx-proj-reveal">Mostra nello store</div>
      <div class="context-menu-item text-danger" id="ctx-proj-delete">Sposta nel cestino</div>
    `;

    menu.innerHTML = html;
    document.body.appendChild(menu);
    positionContextMenu(menu, e.clientX, e.clientY);

    menu.querySelector("#ctx-proj-open").onclick = () => {
      menu.remove();
      if (!isDir) openFileFromPath(fullPath);
    };

    menu.querySelector("#ctx-proj-rename").onclick = () => {
      menu.remove();
      showInlineRename(itemDiv, fullPath, () => renderProjectPane(currentProject.storePath));
    };

    menu.querySelector("#ctx-proj-duplicate").onclick = async () => {
      menu.remove();
      try {
        const ext = isDir ? "" : path.extname(fullPath);
        const base = isDir ? path.basename(fullPath) : path.basename(fullPath, ext);
        const copyName = uniqueName(path.dirname(fullPath), base, ext);
        const copyPath = path.join(path.dirname(fullPath), copyName);
        if (isDir) {
          fs.cpSync(fullPath, copyPath, { recursive: true });
        } else {
          fs.copyFileSync(fullPath, copyPath);
        }
        showNotification(`Elemento duplicato in "${copyName}"`, "info");
        renderProjectPane(currentProject.storePath);
      } catch (err) {
        showNotification("Errore duplicazione: " + err.message, "error");
      }
    };

    if (menu.querySelector("#ctx-proj-set-main")) {
      menu.querySelector("#ctx-proj-set-main").onclick = async () => {
        menu.remove();
        await applyMainDocumentSelection(fullPath);
      };
    }

    menu.querySelector("#ctx-proj-reveal").onclick = () => {
      menu.remove();
      ipcRenderer.invoke('project-reveal-item', fullPath);
    };

    menu.querySelector("#ctx-proj-delete").onclick = () => {
      menu.remove();
      const targets = (selectedExplorerPaths && selectedExplorerPaths.length > 1 && selectedExplorerPaths.some(p => path.resolve(p) === path.resolve(fullPath)))
        ? selectedExplorerPaths
        : [fullPath];
      deleteExplorerFiles(targets);
    };

    const closeHandler = () => {
      menu.remove();
      window.removeEventListener("click", closeHandler);
    };
    setTimeout(() => window.addEventListener("click", closeHandler), 10);
  }

  function showInlineRename(itemDiv, filePath, refreshFn) {
    const labelSpan = itemDiv.querySelector(".tree-label");
    if (!labelSpan) return;
    const oldName = path.basename(filePath);
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(filePath).isDirectory();
    } catch (_) {}
    const oldExt = isDirectory ? "" : path.extname(oldName);
    const oldBase = isDirectory ? oldName : path.basename(oldName, oldExt);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "tree-inline-input";
    input.value = oldName;
    input.spellcheck = false;

    let tooltipEl = null;
    function updateValidation(valResult) {
      if (!valResult.valid) {
        input.classList.add("invalid");
        if (!tooltipEl) {
          tooltipEl = document.createElement("div");
          tooltipEl.className = "tree-inline-tooltip";
          document.body.appendChild(tooltipEl);
        }
        tooltipEl.textContent = valResult.error;
        const rect = input.getBoundingClientRect();
        tooltipEl.style.left = `${rect.left}px`;
        tooltipEl.style.top = `${rect.bottom + 4}px`;
      } else {
        input.classList.remove("invalid");
        if (tooltipEl) {
          tooltipEl.remove();
          tooltipEl = null;
        }
      }
    }

    function cleanupTooltip() {
      if (tooltipEl) {
        tooltipEl.remove();
        tooltipEl = null;
      }
    }

    labelSpan.replaceWith(input);
    input.focus();
    if (!isDirectory && oldExt && oldBase.length > 0) {
      input.setSelectionRange(0, oldBase.length);
    } else {
      input.select();
    }

    input.addEventListener("input", () => {
      const val = validateItemName(input.value.trim());
      updateValidation(val);
    });

    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      cleanupTooltip();

      let newName = input.value.trim();
      if (!newName || newName === oldName) {
        refreshFn();
        return;
      }

      if (!isDirectory && !path.extname(newName) && oldExt) {
        newName += oldExt;
      }

      const val = validateItemName(newName);
      if (!val.valid) {
        showNotification(val.error, "error");
        refreshFn();
        return;
      }

      const dir = path.dirname(filePath);
      const newExt = isDirectory ? "" : path.extname(newName);
      const newBase = isDirectory ? newName : path.basename(newName, newExt);
      let finalName = newName;

      const directNewPath = path.join(dir, newName);
      if (fs.existsSync(directNewPath) && path.resolve(directNewPath).toLowerCase() !== path.resolve(filePath).toLowerCase()) {
        finalName = uniqueName(dir, newBase, newExt);
        showNotification(`Nome in uso: rinominato in "${finalName}"`, "info");
      }

      const newPath = path.join(dir, finalName);
      try {
        const resolvedOldPath = path.resolve(filePath);
        const resolvedMainBefore = mainDocumentPath ? path.resolve(mainDocumentPath) : null;
        fs.renameSync(filePath, newPath);

        let tabsChanged = false;
        for (const t of tabs) {
          if (!t.filePath) continue;
          const resolvedTabPath = path.resolve(t.filePath);
          if (resolvedTabPath === resolvedOldPath) {
            t.filePath = newPath;
            t.title = finalName;
            tabsChanged = true;
          } else if (isDirectory && isPathInsideDir(resolvedTabPath, resolvedOldPath)) {
            t.filePath = path.join(newPath, path.relative(resolvedOldPath, resolvedTabPath));
            tabsChanged = true;
          }
        }
        if (tabsChanged) {
          renderTabs();
          updateTitle();
        }

        for (const [watchPath, watcher] of Array.from(activeFileWatchers.entries())) {
          const resolvedWatch = path.resolve(watchPath);
          if (resolvedWatch === resolvedOldPath) {
            try { watcher.close(); } catch (_) {}
            activeFileWatchers.delete(watchPath);
            watchFileForChanges(newPath);
          } else if (isDirectory && isPathInsideDir(resolvedWatch, resolvedOldPath)) {
            try { watcher.close(); } catch (_) {}
            activeFileWatchers.delete(watchPath);
            watchFileForChanges(path.join(newPath, path.relative(resolvedOldPath, resolvedWatch)));
          }
        }

        if (resolvedMainBefore && resolvedMainBefore === resolvedOldPath) {
          setMainDocument(newPath, { explicit: mainDocumentExplicit, persistManifest: false, silent: true });
          await persistProjectMainManifest(newPath);
        } else if (isDirectory && resolvedMainBefore && isPathInsideDir(resolvedMainBefore, resolvedOldPath)) {
          const updatedMain = path.join(newPath, path.relative(resolvedOldPath, resolvedMainBefore));
          setMainDocument(updatedMain, { explicit: mainDocumentExplicit, persistManifest: false, silent: true });
          await persistProjectMainManifest(updatedMain);
        }

        showNotification(`Rinominato in "${finalName}"`, "info");
        refreshFn();
      } catch (err) {
        showNotification("Errore rinomina: " + err.message, "error");
        refreshFn();
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        committed = true;
        cleanupTooltip();
        refreshFn();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(commit, 120);
    });
  }

  function openFileFromPath(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    const existing = tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(filePath));
    if (existing) {
      switchTab(existing.id);
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    createTab(path.basename(filePath), content, filePath);
  }
  window.openFileFromPath = openFileFromPath;
  window.createTab = createTab;
  window.applyTheme = applyTheme;
  window.cycleTheme = cycleTheme;
  window.openFolder = openFolder;
  window.openLinkedProject = openLinkedProject;
  window.openProjectsManager = openProjectsManager;
  window.openNewProjectModal = openNewProjectModal;
  window.promptClaimPdf = promptClaimPdf;
  window.promptRelinkOrRestore = promptRelinkOrRestore;
  window.newFile = newFile;
  window.closeTab = closeTab;
  window.closeOtherTabs = closeOtherTabs;
  window.closeTabsToRight = closeTabsToRight;
  window.closeSavedTabs = closeSavedTabs;
  window.closeAllTabs = closeAllTabs;
  window.showTabContextMenu = showTabContextMenu;
  window.deleteExplorerFiles = deleteExplorerFiles;
  window.undoLastExplorerAction = undoLastExplorerAction;
  window.activateExplorerFile = activateExplorerFile;
  window.triggerCompile = triggerCompile;
  window.closeLinkedProject = closeLinkedProject;
  window.getSelectedExplorerPaths = () => selectedExplorerPaths;
  window.getSelectedExplorerPath = () => selectedExplorerPath;
  window.clearExplorerSelection = clearExplorerSelection;
  window.isLinkedProject = () => isLinkedProject;
  window.getCurrentProject = () => currentProject;

  function openFileDialog() {
    dialog.showOpenDialog({
      filters: [{ name: "LaTeX Documents", extensions: ["tex", "bib", "cls", "sty"] }],
      properties: ["openFile", "multiSelections"]
    }).then(res => {
      if (!res.canceled && res.filePaths.length > 0) {
        for (const fp of res.filePaths) openFileFromPath(fp);
      }
    });
  }

  function openFolderDialog() {
    dialog.showOpenDialog({ properties: ["openDirectory"] }).then(res => {
      if (!res.canceled && res.filePaths.length > 0) openFolder(res.filePaths[0]);
    });
  }

  // Inline input row for new folder and new file
  function showInlineTreeInput(containerEl, targetDir, type = "file", isProjectStore = false) {
    if (!targetDir || !fs.existsSync(targetDir)) return;
    const existing = document.querySelector(".tree-inline-input-row");
    if (existing) existing.remove();

    const row = document.createElement("div");
    row.className = "tree-inline-input-row";
    const iconSvg = type === "folder"
      ? '<svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>'
      : '<svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
    // Default names: new_file.tex, new_folder: constants, never translated
    const defaultVal = type === "folder" ? "new_folder" : "new_file.tex";

    row.innerHTML = `
      <span class="tree-icon" style="display:flex;align-items:center;">${iconSvg}</span>
      <input type="text" class="tree-inline-input" value="${defaultVal}" spellcheck="false" />
    `;

    containerEl.prepend(row);
    const input = row.querySelector(".tree-inline-input");
    input.focus();
    if (type === "file") {
      // Selection range [0, 8] - base name selected, extension unselected
      input.setSelectionRange(0, 8);
    } else {
      input.setSelectionRange(0, defaultVal.length);
    }

    let tooltipEl = null;
    function updateValidation(valResult) {
      if (!valResult.valid) {
        input.classList.add("invalid");
        if (!tooltipEl) {
          tooltipEl = document.createElement("div");
          tooltipEl.className = "tree-inline-tooltip";
          document.body.appendChild(tooltipEl);
        }
        tooltipEl.textContent = valResult.error;
        const rect = input.getBoundingClientRect();
        tooltipEl.style.left = `${rect.left}px`;
        tooltipEl.style.top = `${rect.bottom + 4}px`;
      } else {
        input.classList.remove("invalid");
        if (tooltipEl) {
          tooltipEl.remove();
          tooltipEl = null;
        }
      }
    }

    function cleanupTooltip() {
      if (tooltipEl) {
        tooltipEl.remove();
        tooltipEl = null;
      }
    }

    input.addEventListener("input", () => {
      const val = validateItemName(input.value.trim());
      updateValidation(val);
    });

    let committed = false;

    const commit = async () => {
      if (committed) return;
      committed = true;
      cleanupTooltip();
      const rawName = input.value.trim();
      row.remove();

      const val = validateItemName(rawName);
      if (!val.valid) {
        if (rawName) showNotification(val.error, "error");
        return;
      }

      let name = val.name;
      if (type === "file" && !path.extname(name)) {
        name += ".tex";
      }

      const ext = type === "folder" ? "" : path.extname(name);
      const base = type === "folder" ? name : path.basename(name, ext);
      const finalName = uniqueName(targetDir, base, ext);
      if (finalName !== name) {
        showNotification(`Nome in uso: creato come "${finalName}"`, "info");
      }
      name = finalName;

      const targetPath = path.join(targetDir, name);

      try {
        if (type === "folder") {
          await fs.promises.mkdir(targetPath, { recursive: true });
          showNotification(`Cartella "${name}" creata!`, "info");
        } else {
          const starterContent = ext.toLowerCase() === '.tex'
            ? '\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n'
            : '';
          await fs.promises.writeFile(targetPath, starterContent, 'utf8');
          showNotification(`File "${name}" creato!`, "info");
        }
      } catch (err) {
        showNotification("Errore: " + err.message, "error");
        return;
      } finally {
        if (isProjectStore) {
          renderProjectPane(targetDir);
        } else {
          renderFolderPane(targetDir);
        }
      }

      if (type === "file") {
        try {
          openFileFromPath(targetPath);
        } catch (err) {
          console.error("Errore apertura file:", err);
        }
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        committed = true;
        cleanupTooltip();
        row.remove();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(commit, 120);
    });
  }

  // Draggable Splitter between Folder and Project Panes
  let isResizingSplitter = false;
  if (sidebarSplitter) {
    sidebarSplitter.addEventListener("mousedown", () => {
      isResizingSplitter = true;
      sidebarSplitter.classList.add("is-resizing");
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (e) => {
      if (!isResizingSplitter || !folderPane || !projectPane) return;
      const contentEl = document.getElementById("sidebar-tab-content-files");
      if (!contentEl) return;
      const contentRect = contentEl.getBoundingClientRect();
      const offset = e.clientY - contentRect.top;
      const totalHeight = contentRect.height;
      if (offset < 50 || offset > totalHeight - 50) return;
      const ratio = offset / totalHeight;
      folderPane.style.flex = `${ratio}`;
      projectPane.style.flex = `${1 - ratio}`;
      localStorage.setItem("lack-sidebar-split-ratio", String(ratio));
    });

    window.addEventListener("mouseup", () => {
      if (isResizingSplitter) {
        isResizingSplitter = false;
        sidebarSplitter.classList.remove("is-resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });

    sidebarSplitter.addEventListener("dblclick", () => {
      folderPane.style.flex = "1";
      projectPane.style.flex = "1";
      localStorage.setItem("lack-sidebar-split-ratio", "0.5");
      showNotification("Divisore reimpostato a 50/50", "info");
    });

    const savedRatio = parseFloat(localStorage.getItem("lack-sidebar-split-ratio") || "0.5");
    if (savedRatio >= 0.1 && savedRatio <= 0.9) {
      folderPane.style.flex = `${savedRatio}`;
      projectPane.style.flex = `${1 - savedRatio}`;
    }
  }

  // Drag & drop files onto Project Virtual Pane
  if (projectPane) {
    projectPane.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      projectPane.classList.add("drag-over");
    });
    projectPane.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      projectPane.classList.remove("drag-over");
    });
    projectPane.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      projectPane.classList.remove("drag-over");
      if (!isLinkedProject || !currentProject) return;

      let pathsToImport = [];
      const customData = e.dataTransfer.getData("application/x-lack-explorer-paths");
      if (customData) {
        try {
          pathsToImport = JSON.parse(customData);
        } catch (_) {}
      } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        pathsToImport = Array.from(e.dataTransfer.files).map(f => f.path);
      }

      if (!pathsToImport || pathsToImport.length === 0) return;

      const isAltCopy = e.altKey;
      let count = 0;
      const movedOperations = [];

      for (const src of pathsToImport) {
        if (!src || !fs.existsSync(src)) continue;
        if (currentProject.targetPath && path.resolve(src) === path.resolve(currentProject.targetPath)) {
          showNotification("Il PDF collegato è l'output del progetto e non può essere spostato nello store.", "warning");
          continue;
        }
        const isDir = fs.statSync(src).isDirectory();
        const ext = isDir ? "" : path.extname(src);
        const base = isDir ? path.basename(src) : path.basename(src, ext);
        const targetName = uniqueName(currentProject.storePath, base, ext);
        const dest = path.join(currentProject.storePath, targetName);
        try {
          if (isAltCopy || isDir) {
            // Copy mode (when Alt is held or directories)
            if (isDir) {
              fs.cpSync(src, dest, { recursive: true });
            } else {
              fs.copyFileSync(src, dest);
            }
          } else {
            // Data safety rule: move = copy -> verify (size + SHA-256) -> delete original
            const op = moveFileSafe(src, dest);
            movedOperations.push(op);
          }
          if (targetName !== path.basename(src)) {
            showNotification(`Importato come "${targetName}"`, "info");
          }
          count++;
        } catch (err) {
          console.warn("[LACK] Drag-drop import error:", err);
          showNotification("Errore durante l'operazione: " + err.message, "error");
        }
      }

      if (count > 0) {
        renderProjectPane(currentProject.storePath);
        if (currentProjectDir) renderFolderPane(currentProjectDir);

        if (movedOperations.length > 0) {
          const userDataDir = (require("@electron/remote").app || require("electron").app)?.getPath("userData") || os.tmpdir();
          const journalDir = path.join(userDataDir, "move-journal");
          let journalPath = null;
          try {
            journalPath = recordMoveJournal(journalDir, {
              projectId: currentProject.id,
              operations: movedOperations
            });
          } catch (_) {}

          showNotificationWithAction(
            `${movedOperations.length} element${movedOperations.length === 1 ? 'o spostato' : 'i spostati'} nello store`,
            "Annulla",
            async () => {
              if (journalPath) {
                const undoRes = await ipcRenderer.invoke('project-undo-move', journalPath);
                if (undoRes.success) {
                  showNotification(`Ripristinati ${undoRes.count} file`, "info");
                  renderProjectPane(currentProject.storePath);
                  if (currentProjectDir) renderFolderPane(currentProjectDir);
                } else {
                  showNotification("Errore durante l'annullamento: " + undoRes.error, "error");
                }
              }
            },
            "info"
          );
        } else {
          showNotification(`${count} element${count === 1 ? 'o copiato' : 'i copiati'} nello store`, "info");
        }
      }
    });
  }

  // Drag & drop files onto Folder Pane
  if (folderPane) {
    folderPane.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      folderPane.classList.add("drag-over");
    });
    folderPane.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      folderPane.classList.remove("drag-over");
    });
    folderPane.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      folderPane.classList.remove("drag-over");
      if (!currentProjectDir || !fs.existsSync(currentProjectDir)) return;

      const droppedFiles = e.dataTransfer.files;
      if (!droppedFiles || droppedFiles.length === 0) return;

      let count = 0;
      for (const f of droppedFiles) {
        const src = f.path;
        if (!src || !fs.existsSync(src)) continue;
        const isDir = fs.statSync(src).isDirectory();
        const ext = isDir ? "" : path.extname(src);
        const base = isDir ? path.basename(src) : path.basename(src, ext);
        const targetName = uniqueName(currentProjectDir, base, ext);
        const dest = path.join(currentProjectDir, targetName);
        try {
          if (isDir) {
            fs.cpSync(src, dest, { recursive: true });
          } else {
            fs.copyFileSync(src, dest);
          }
          if (targetName !== path.basename(src)) {
            showNotification(`Importato come "${targetName}"`, "info");
          }
          count++;
        } catch (err) {
          console.warn("[LACK] Folder drag-drop import error:", err);
        }
      }
      if (count > 0) {
        showNotification(`${count} element${count === 1 ? 'o importato' : 'i importati'} nella cartella`, "info");
        renderFolderPane(currentProjectDir);
      }
    });
  }

  // Explorer & Pane Action Buttons
  document.getElementById("new-folder")?.addEventListener("click", () => {
    const isProjectActive = isLinkedProject && currentProject && currentProject.storePath;
    const targetDir = isProjectActive
      ? currentProject.storePath
      : ((currentProject && currentProject.targetPath) ? path.dirname(currentProject.targetPath) : currentProjectDir);

    if (!targetDir) {
      showNotification("Apri una cartella o crea un progetto per creare una cartella", "info");
      return;
    }

    const container = isProjectActive ? projectTreeEl : (folderTreeEl || fileTreeLegacy);
    showInlineTreeInput(container, targetDir, "folder", isProjectActive);
  });

  document.getElementById("new-file")?.addEventListener("click", async () => {
    const targetDir = (isLinkedProject && currentProject && currentProject.targetPath)
      ? path.dirname(currentProject.targetPath)
      : currentProjectDir;
    if (!targetDir) {
      newFile();
      return;
    }

    const choice = await showCustomConfirmDialog({
      title: "Nuovo file o progetto",
      message: "Cosa desideri creare nella cartella?",
      buttons: [
        { text: "Annulla", value: "cancel", isCancel: true },
        { text: "File standard", value: "standard" },
        { text: "Documento LaTeX", value: "latex_project", isPrimary: true }
      ]
    });

    if (!choice || choice === "cancel") return;

    if (choice === "latex_project") {
      const defaultTarget = path.join(targetDir, uniqueName(targetDir, "documento", ".pdf"));
      openNewProjectModal(defaultTarget);
    } else {
      showInlineTreeInput(folderTreeEl || fileTreeLegacy, targetDir, "file", false);
    }
  });

  document.getElementById("open-folder")?.addEventListener("click", () => openFolderDialog());
  document.getElementById("refresh-explorer")?.addEventListener("click", () => {
    if (isLinkedProject && currentProject) {
      renderProjectPane(currentProject.storePath);
      const targetFolder = path.dirname(currentProject.targetPath);
      renderFolderPane(targetFolder);
    } else if (currentProjectDir) {
      renderFolderPane(currentProjectDir);
    }
  });
  document.getElementById("collapse-all")?.addEventListener("click", () => {
    document.querySelectorAll(".tree-children").forEach(c => c.classList.add("hidden"));
    document.querySelectorAll(".tree-chevron-icon").forEach(ch => ch.style.transform = "rotate(0deg)");
  });
  document.getElementById("btn-toggle-explorer")?.addEventListener("click", () => {
    document.getElementById("explorer-panel")?.classList.toggle("hidden");
  });

  // Clear explorer selection when clicking on empty background
  document.getElementById("sidebar-tab-content-files")?.addEventListener("click", (e) => {
    if (!e.target.closest(".tree-item") && !e.target.closest(".tree-inline-input-row") && !e.target.closest(".sidebar-pane-header")) {
      clearExplorerSelection();
    }
  });

  // Mouse wheel delegation on sidebar panes to always scroll tree containers
  document.querySelectorAll(".sidebar-pane").forEach(pane => {
    pane.addEventListener("wheel", (e) => {
      const tree = pane.querySelector(".tree-container");
      if (tree && e.target !== tree && !tree.contains(e.target)) {
        tree.scrollTop += e.deltaY;
      }
    }, { passive: true });
  });

  // Folder pane specific buttons
  document.getElementById("folder-btn-refresh")?.addEventListener("click", () => {
    const targetFolder = (isLinkedProject && currentProject && currentProject.targetPath)
      ? path.dirname(currentProject.targetPath)
      : currentProjectDir;
    if (targetFolder) renderFolderPane(targetFolder);
  });
  document.getElementById("folder-btn-collapse")?.addEventListener("click", () => {
    folderPane?.classList.toggle("collapsed");
    const isCollapsed = folderPane?.classList.contains("collapsed");
    const btn = document.getElementById("folder-btn-collapse");
    if (btn) btn.textContent = isCollapsed ? "+" : "−";
  });

  // Project pane specific buttons
  document.getElementById("proj-btn-add-file")?.addEventListener("click", () => {
    if (!isLinkedProject || !currentProject) return;
    showInlineTreeInput(projectTreeEl, currentProject.storePath, "file", true);
  });
  document.getElementById("proj-btn-add-folder")?.addEventListener("click", () => {
    if (!isLinkedProject || !currentProject) return;
    showInlineTreeInput(projectTreeEl, currentProject.storePath, "folder", true);
  });
  document.getElementById("proj-btn-link-asset")?.addEventListener("click", async () => {
    if (!isLinkedProject || !currentProject) return;
    const res = await dialog.showOpenDialog({
      title: "Collega risorsa esterna (Immagine o Cartella)",
      properties: ["openFile", "openDirectory"]
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const sourcePath = res.filePaths[0];
      const relDest = path.basename(sourcePath);
      try {
        await ipcRenderer.invoke('project-add-linked-asset', {
          storePath: currentProject.storePath,
          sourcePath,
          relDest
        });
        showNotification(`Risorsa "${relDest}" collegata tramite symlink!`, "info");
        renderProjectPane(currentProject.storePath);
      } catch (err) {
        showNotification("Errore collegamento risorsa: " + err.message, "error");
      }
    }
  });
  document.getElementById("proj-btn-reveal")?.addEventListener("click", () => {
    if (!isLinkedProject || !currentProject) return;
    ipcRenderer.invoke('project-reveal-item', currentProject.storePath);
  });
  document.getElementById("project-btn-collapse")?.addEventListener("click", () => {
    projectPane?.classList.toggle("collapsed");
    const isCollapsed = projectPane?.classList.contains("collapsed");
    const btn = document.getElementById("project-btn-collapse");
    if (btn) btn.textContent = isCollapsed ? "+" : "−";
  });
  document.getElementById("project-btn-close")?.addEventListener("click", () => {
    closeLinkedProject();
    showNotification("Progetto chiuso", "info");
  });

  // ====== PROJECTS MANAGER MODAL (Mark Gallery Style) ======
  const projectsModal = document.getElementById("projects-modal");
  const projectsSearchInput = document.getElementById("projects-search-input");
  const projectsCardsGrid = document.getElementById("projects-cards-grid");

  async function openProjectsManager() {
    if (!projectsModal) return;
    projectsModal.classList.remove("hidden");
    await refreshProjectsGrid();
  }

  async function refreshProjectsGrid(filterQuery = "") {
    if (!projectsCardsGrid) return;
    projectsCardsGrid.innerHTML = `<div style="padding: 24px; text-align: center; color: #888;">Caricamento progetti...</div>`;
    try {
      const list = await ipcRenderer.invoke('project-list');
      const q = filterQuery.toLowerCase().trim();
      const filtered = list.filter(p => {
        if (!q) return true;
        return (p.name && p.name.toLowerCase().includes(q)) ||
               (p.id && p.id.toLowerCase().includes(q)) ||
               (p.targetPath && p.targetPath.toLowerCase().includes(q));
      });

      if (filtered.length === 0) {
        projectsCardsGrid.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 48px 24px; text-align: center; color: #888;">
            <p style="font-size: 15px; margin-bottom: 8px; font-weight: 500;">Nessun progetto trovato</p>
            <p style="font-size: 12px; opacity: 0.8;">Crea un nuovo progetto o compila un documento per iniziare.</p>
          </div>
        `;
        return;
      }

      projectsCardsGrid.innerHTML = "";
      filtered.forEach(proj => {
        const targetPath = proj.targetPath || proj.lastPdfPath || '';
        const targetExists = Boolean(targetPath && fs.existsSync(targetPath));
        const storeExists = Boolean(proj.storePath && fs.existsSync(proj.storePath));
        const storeSize = storeExists ? formatBytes(calculateDirSize(proj.storePath)) : "0 B";
        const dateStr = (proj.lastOpened || proj.lastModified) ? new Date(proj.lastOpened || proj.lastModified).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : "N/D";

        const card = document.createElement("div");
        card.className = "project-card";
        card.innerHTML = `
          <div class="project-card-header">
            <div class="project-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="project-card-title-group">
              <h4 class="project-card-title" title="${escapeHtml(proj.name || 'Senza nome')}">${escapeHtml(proj.name || 'Senza nome')}</h4>
              <span class="project-card-date">${dateStr}</span>
            </div>
          </div>
          <div class="project-card-target-row">
            <span class="project-badge-${targetExists ? 'exists' : 'missing'}">${targetExists ? 'PDF Presente' : 'PDF Mancante'}</span>
            <span class="project-card-target-path" title="${escapeHtml(targetPath || '')}">${escapeHtml(targetPath ? path.basename(targetPath) : 'Nessuno')}</span>
          </div>
          <div class="project-card-footer">
            <span class="project-card-size">Store: ${storeSize}</span>
            <div class="project-card-actions">
              <button type="button" class="btn-card-open proj-btn-black">Apri</button>
              <button type="button" class="btn-card-reveal proj-btn-secondary" title="Mostra store nel file manager">Mostra</button>
              <button type="button" class="btn-card-export proj-btn-secondary" title="Esporta ZIP o cartella">Esporta</button>
              <button type="button" class="btn-card-delete proj-btn-danger" title="Sposta store nel cestino">Cestina</button>
            </div>
          </div>
        `;

        card.querySelector(".btn-card-open").onclick = () => {
          projectsModal.classList.add("hidden");
          openLinkedProject({
            projectId: proj.id,
            name: proj.name,
            storePath: proj.storePath,
            targetPath: targetPath,
            compileImmediate: targetExists
          });
        };

        card.querySelector(".btn-card-reveal").onclick = () => {
          ipcRenderer.invoke('project-reveal-item', proj.storePath);
        };

        card.querySelector(".btn-card-export").onclick = () => {
          openExportModal(proj.storePath);
        };

        card.querySelector(".btn-card-delete").onclick = async () => {
          const choice = await showCustomConfirmDialog({
            title: "Eliminazione Progetto",
            message: `Stai eliminando il progetto "${proj.name}".\n\nVuoi mantenere i dati sorgente archiviati nello store (in modo da poter ricreare o duplicare il PDF in futuro), oppure spostare nel cestino tutti i dati del progetto?`,
            buttons: [
              { text: "Annulla", value: 'cancel', isCancel: true },
              { text: "Mantieni dati sorgente", value: 'keep_sources', isPrimary: true },
              { text: "Sposta tutto nel cestino", value: 'delete_all', isDanger: true }
            ]
          });
          if (choice === 'keep_sources') {
            await ipcRenderer.invoke('project-unlink', proj.targetPath);
            showNotification(`Collegamento rimosso. I sorgenti di "${proj.name}" rimangono archiviati nello store.`, "info");
            refreshProjectsGrid(projectsSearchInput?.value || "");
          } else if (choice === 'delete_all') {
            await ipcRenderer.invoke('project-trash-item', proj.storePath);
            await ipcRenderer.invoke('project-unlink', proj.targetPath);
            showNotification(`Progetto "${proj.name}" e file sorgente spostati nel cestino`, "info");
            refreshProjectsGrid(projectsSearchInput?.value || "");
          }
        };

        projectsCardsGrid.appendChild(card);
      });
    } catch (err) {
      projectsCardsGrid.innerHTML = `<div style="padding: 24px; color: #ef4444;">Errore caricamento progetti: ${escapeHtml(err.message)}</div>`;
    }
  }

  projectsSearchInput?.addEventListener("input", (e) => {
    refreshProjectsGrid(e.target.value);
  });
  document.getElementById("btn-close-projects-modal")?.addEventListener("click", () => projectsModal?.classList.add("hidden"));
  document.getElementById("projects-modal-overlay")?.addEventListener("click", () => projectsModal?.classList.add("hidden"));
  document.getElementById("btn-projects-new-proj")?.addEventListener("click", () => {
    projectsModal?.classList.add("hidden");
    openNewProjectModal();
  });

  // ====== NEW PROJECT MODAL ======
  const newProjModal = document.getElementById("new-project-modal");
  const inputNewProjName = document.getElementById("input-new-proj-name");
  const inputNewProjTarget = document.getElementById("input-new-proj-target");
  const selectNewProjTemplate = document.getElementById("select-new-proj-template");

  function openNewProjectModal(defaultTarget = "") {
    if (!newProjModal) return;
    newProjModal.classList.remove("hidden");
    if (inputNewProjName) inputNewProjName.value = defaultTarget ? path.basename(defaultTarget, ".pdf") : "Nuovo Progetto";
    if (inputNewProjTarget) inputNewProjTarget.value = defaultTarget || "";
  }

  document.getElementById("btn-new-proj-browse-target")?.addEventListener("click", async () => {
    const defaultDir = (currentProjectDir && fs.existsSync(currentProjectDir)) ? currentProjectDir : null;
    const curTarget = inputNewProjTarget?.value.trim();
    const defaultSave = curTarget || (defaultDir ? path.join(defaultDir, uniqueName(defaultDir, "documento", ".pdf")) : "documento.pdf");
    const res = await dialog.showSaveDialog({
      title: "Seleziona destinazione file PDF",
      defaultPath: defaultSave,
      filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
    });
    if (!res.canceled && res.filePath) {
      const normalizedPdf = path.extname(res.filePath).toLowerCase() === ".pdf" ? res.filePath : `${res.filePath}.pdf`;
      if (inputNewProjTarget) inputNewProjTarget.value = normalizedPdf;
      if (inputNewProjName && (!inputNewProjName.value || inputNewProjName.value === "Nuovo Progetto")) {
        inputNewProjName.value = path.basename(normalizedPdf, ".pdf");
      }
    }
  });

  document.getElementById("btn-submit-new-proj")?.addEventListener("click", async () => {
    const name = inputNewProjName?.value.trim() || "Nuovo Progetto";
    let targetPath = inputNewProjTarget?.value.trim() || null;
    const template = selectNewProjTemplate?.value || "standard";

    if (targetPath && path.extname(targetPath).toLowerCase() !== ".pdf") {
      targetPath = `${targetPath}.pdf`;
    }

    try {
      const created = await ipcRenderer.invoke('project-create', {
        name,
        targetPath,
        template
      });
      newProjModal?.classList.add("hidden");
      showNotification(`Progetto "${name}" creato con successo!`, "info");
      openLinkedProject({
        projectId: created.id,
        name: created.manifest.name,
        storePath: created.storePath,
        targetPath: targetPath,
        compileImmediate: Boolean(targetPath)
      });
    } catch (err) {
      showNotification("Errore creazione progetto: " + err.message, "error");
    }
  });

  document.getElementById("btn-close-new-project-modal")?.addEventListener("click", () => newProjModal?.classList.add("hidden"));
  document.getElementById("btn-cancel-new-proj")?.addEventListener("click", () => newProjModal?.classList.add("hidden"));
  document.getElementById("new-project-modal-overlay")?.addEventListener("click", () => newProjModal?.classList.add("hidden"));

  // ====== CLAIM FOREIGN PDF MODAL ======
  const claimPdfModal = document.getElementById("claim-pdf-modal");
  let pendingClaimTarget = null;
  let pendingClaimName = null;
  let pendingClaimTemplate = null;

  function promptClaimPdf({ targetPath, name, template }) {
    pendingClaimTarget = targetPath;
    pendingClaimName = name;
    pendingClaimTemplate = template;
    const msgEl = document.getElementById("claim-pdf-message");
    if (msgEl) {
      msgEl.innerHTML = `Il file <strong>${escapeHtml(path.basename(targetPath))}</strong> non contiene alcun progetto Lack collegato.<br>Vuoi aprirlo semplicemente in sola lettura oppure creare un progetto collegato che lo governi?`;
    }
    claimPdfModal?.classList.remove("hidden");
  }

  document.getElementById("btn-claim-open-plain")?.addEventListener("click", () => {
    claimPdfModal?.classList.add("hidden");
    if (pendingClaimTarget) {
      pdfViewer.loadPdfDocument(pendingClaimTarget);
      showNotification(`PDF aperto in modalità visualizzazione semplice`, "info");
    }
  });

  document.getElementById("btn-claim-create-project")?.addEventListener("click", async () => {
    claimPdfModal?.classList.add("hidden");
    if (pendingClaimTarget) {
      try {
        const created = await ipcRenderer.invoke('project-create', {
          name: pendingClaimName || path.basename(pendingClaimTarget, ".pdf"),
          targetPath: pendingClaimTarget,
          template: pendingClaimTemplate || "standard"
        });
        openLinkedProject({
          projectId: created.id,
          name: created.manifest.name,
          storePath: created.storePath,
          targetPath: pendingClaimTarget,
          compileImmediate: true
        });
      } catch (err) {
        showNotification("Errore creazione progetto: " + err.message, "error");
      }
    }
  });

  document.getElementById("btn-close-claim-pdf")?.addEventListener("click", () => claimPdfModal?.classList.add("hidden"));
  document.getElementById("claim-pdf-overlay")?.addEventListener("click", () => claimPdfModal?.classList.add("hidden"));

  // ====== RELINK OR RESTORE MODAL ======
  const relinkRestoreModal = document.getElementById("relink-restore-modal");
  let pendingRelinkInfo = null;

  function promptRelinkOrRestore(info) {
    pendingRelinkInfo = info;
    const msgEl = document.getElementById("relink-restore-message");
    if (msgEl) {
      msgEl.innerHTML = `Il PDF <strong>${escapeHtml(path.basename(info.targetPath))}</strong> è ancorato all'ID progetto <code>${escapeHtml(info.projectId)}</code>, che non è registrato in questo computer.` +
        (info.hasSnapshot ? `<br><br><span style="color:#10b981; font-weight:600;">&#10003; Trovata istantanea compressa delle sorgenti incorporata nel PDF!</span>` : `<br><br><span style="color:#ef4444;">Nessuna istantanea incorporata disponibile.</span>`);
    }
    const restoreBtn = document.getElementById("btn-restore-from-snapshot");
    if (restoreBtn) {
      restoreBtn.style.display = info.hasSnapshot ? "" : "none";
    }
    relinkRestoreModal?.classList.remove("hidden");
  }

  document.getElementById("btn-restore-from-snapshot")?.addEventListener("click", async () => {
    if (!pendingRelinkInfo) return;
    try {
      const storeRoot = await ipcRenderer.invoke('project-get-store-root');
      const slug = path.basename(pendingRelinkInfo.targetPath, ".pdf").toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const storePath = path.join(storeRoot, `${slug}-${pendingRelinkInfo.projectId}`);
      await ipcRenderer.invoke('project-extract-snapshot', {
        pdfPath: pendingRelinkInfo.targetPath,
        targetDir: storePath
      });

      let manifest = null;
      try {
        manifest = await ipcRenderer.invoke('project-load-manifest', storePath);
      } catch (_) {}

      relinkRestoreModal?.classList.add("hidden");
      showNotification("Sorgenti estratte e ripristinate con successo dall'istantanea!", "info");
      openLinkedProject({
        projectId: pendingRelinkInfo.projectId,
        name: manifest ? manifest.name : pendingRelinkInfo.name,
        storePath,
        targetPath: pendingRelinkInfo.targetPath,
        compileImmediate: false
      });
    } catch (err) {
      showNotification("Errore ripristino istantanea: " + err.message, "error");
    }
  });

  document.getElementById("btn-relink-to-existing")?.addEventListener("click", () => {
    relinkRestoreModal?.classList.add("hidden");
    openProjectsManager();
  });

  document.getElementById("btn-open-plain-unlinked")?.addEventListener("click", () => {
    relinkRestoreModal?.classList.add("hidden");
    if (pendingRelinkInfo && pendingRelinkInfo.targetPath) {
      pdfViewer.loadPdfDocument(pendingRelinkInfo.targetPath);
    }
  });

  document.getElementById("btn-close-relink-restore")?.addEventListener("click", () => relinkRestoreModal?.classList.add("hidden"));
  document.getElementById("relink-restore-overlay")?.addEventListener("click", () => relinkRestoreModal?.classList.add("hidden"));

  // ====== EXPORT PROJECT MODAL ======
  const exportModal = document.getElementById("export-project-modal");
  let pendingExportStorePath = null;
  let exportAsZip = true;

  function openExportModal(storePath) {
    pendingExportStorePath = storePath || (currentProject ? currentProject.storePath : null);
    if (!pendingExportStorePath) {
      showNotification("Nessun progetto attivo da esportare.", "warning");
      return;
    }
    exportModal?.classList.remove("hidden");
  }

  document.getElementById("export-format-zip")?.addEventListener("click", () => {
    exportAsZip = true;
    document.getElementById("export-format-zip")?.classList.add("active");
    document.getElementById("export-format-folder")?.classList.remove("active");
  });

  document.getElementById("export-format-folder")?.addEventListener("click", () => {
    exportAsZip = false;
    document.getElementById("export-format-folder")?.classList.add("active");
    document.getElementById("export-format-zip")?.classList.remove("active");
  });

  document.getElementById("btn-confirm-export-proj")?.addEventListener("click", async () => {
    if (!pendingExportStorePath) return;
    exportModal?.classList.add("hidden");

    let destPath = null;
    if (exportAsZip) {
      const res = await dialog.showSaveDialog({
        title: "Esporta Progetto in archivio ZIP",
        defaultPath: `${path.basename(pendingExportStorePath)}.zip`,
        filters: [{ name: "Archivio ZIP", extensions: ["zip"] }]
      });
      if (!res.canceled && res.filePath) destPath = res.filePath;
    } else {
      const res = await dialog.showOpenDialog({
        title: "Seleziona cartella di destinazione per esportazione",
        properties: ["openDirectory", "createDirectory"]
      });
      if (!res.canceled && res.filePaths.length > 0) {
        destPath = path.join(res.filePaths[0], path.basename(pendingExportStorePath));
      }
    }

    if (destPath) {
      try {
        await ipcRenderer.invoke('project-export', {
          storePath: pendingExportStorePath,
          exportDest: destPath,
          asZip: exportAsZip
        });
        showNotification(`Progetto esportato con successo in: ${destPath}`, "info");
      } catch (err) {
        showNotification("Errore esportazione progetto: " + err.message, "error");
      }
    }
  });

  document.getElementById("btn-close-export-project")?.addEventListener("click", () => exportModal?.classList.add("hidden"));
  document.getElementById("btn-cancel-export-proj")?.addEventListener("click", () => exportModal?.classList.add("hidden"));
  document.getElementById("export-project-overlay")?.addEventListener("click", () => exportModal?.classList.add("hidden"));

  // ====== PROJECT INFO POPOVER ======
  footerProjectChip?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isLinkedProject || !currentProject) return;
    const isHidden = projectInfoPopover?.classList.toggle("hidden");
    if (!isHidden) {
      const idEl = document.getElementById("popover-proj-id");
      const storeEl = document.getElementById("popover-proj-store");
      const targetEl = document.getElementById("popover-proj-target");
      if (idEl) idEl.textContent = currentProject.projectId;
      if (storeEl) storeEl.textContent = currentProject.storePath;
      if (targetEl) targetEl.textContent = currentProject.targetPath;
    }
  });

  document.getElementById("btn-close-project-popover")?.addEventListener("click", () => {
    projectInfoPopover?.classList.add("hidden");
  });

  document.querySelectorAll(".btn-copy-val").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetId = btn.dataset.target;
      const val = document.getElementById(targetId)?.textContent;
      if (val && val !== '-') {
        clipboard.writeText(val);
        showNotification("Copiato negli appunti!", "info");
      }
    });
  });

  window.addEventListener("click", (e) => {
    if (projectInfoPopover && !projectInfoPopover.contains(e.target) && e.target !== footerProjectChip) {
      projectInfoPopover.classList.add("hidden");
    }
  });

  // ====== DOCUMENT OUTLINE ======
  function updateOutlineTree() {
    const outlineTree = document.getElementById("outline-tree");
    if (!outlineTree || !cm) return;
    const outline = cm.getOutline();

    if (outline.length === 0) {
      outlineTree.innerHTML = '<div style="padding:12px; font-size:12px; opacity:0.6; text-align:center;">Nessuna sezione trovata</div>';
      return;
    }

    outlineTree.innerHTML = outline.map(item => `
      <div class="outline-item outline-level-${item.type}" data-line="${item.line}" data-title="${escapeHtml(item.title)}">
        <span>${escapeHtml(item.title)}</span>
      </div>
    `).join('');

    outlineTree.querySelectorAll('.outline-item').forEach(el => {
      el.onclick = () => {
        const line = parseInt(el.dataset.line, 10);
        const title = el.dataset.title;
        cm.jumpToLine(line);
        if (title && typeof pdfViewer.goToSection === "function") {
          pdfViewer.goToSection(title);
        }
      };
    });
  }

  // Sidebar tab switching (Files vs Outline)
  document.getElementById("sidebar-tab-files")?.addEventListener("click", () => {
    document.getElementById("sidebar-tab-files")?.classList.add("active");
    document.getElementById("sidebar-tab-outline")?.classList.remove("active");
    document.getElementById("file-tree")?.classList.remove("hidden");
    document.getElementById("folder-path")?.classList.remove("hidden");
    document.getElementById("outline-view")?.classList.add("hidden");
  });

  document.getElementById("sidebar-tab-outline")?.addEventListener("click", () => {
    document.getElementById("sidebar-tab-outline")?.classList.add("active");
    document.getElementById("sidebar-tab-files")?.classList.remove("active");
    document.getElementById("file-tree")?.classList.add("hidden");
    document.getElementById("folder-path")?.classList.add("hidden");
    document.getElementById("outline-view")?.classList.remove("hidden");
    updateOutlineTree();
  });

  // Explorer Resizer
  const explorerPanel = document.getElementById("explorer-panel");
  const explorerResizerEl = document.getElementById("explorer-resizer");
  let isResizing = false;

  if (explorerResizerEl && explorerPanel) {
    explorerResizerEl.addEventListener("mousedown", (e) => {
      isResizing = true;
      document.body.style.cursor = "col-resize";
      explorerResizerEl.classList.add("is-resizing");
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const newWidth = Math.max(160, Math.min(600, e.clientX));
      explorerPanel.style.width = `${newWidth}px`;
    });

    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = "default";
        explorerResizerEl.classList.remove("is-resizing");
      }
    });
  }

  // ====== TEMPLATE GALLERY MODAL ======
  const templateModal = document.getElementById("template-gallery-modal");
  const templateGrid = document.getElementById("template-cards-grid");
  const templatePreviewDrawer = document.getElementById("template-preview-drawer");
  let previewedTemplate = null;

  function openTemplateGallery(category = "all") {
    renderSidebarCategories();
    renderTemplateCards(category);
    templateModal.classList.remove("hidden");
  }

  function generateMiniSheet(t) {
    if (t.id === 'ieee-conference') {
      return `
        <div style="text-align:center; display:flex; flex-direction:column; align-items:center; margin-bottom:4px;">
          <div class="sheet-mini-title" style="width:85%;"></div>
          <div class="sheet-mini-sub" style="width:55%;"></div>
          <div class="sheet-mini-badges">
            <span class="sheet-mini-badge" style="width:28px;"></span>
            <span class="sheet-mini-badge" style="width:28px;"></span>
          </div>
        </div>
        <div class="sheet-mini-cols">
          <div class="sheet-mini-col">
            <div class="sheet-mini-line w-full"></div>
            <div class="sheet-mini-line w-80"></div>
            <div class="sheet-mini-math"></div>
            <div class="sheet-mini-line w-full"></div>
            <div class="sheet-mini-line w-60"></div>
          </div>
          <div class="sheet-mini-col">
            <div class="sheet-mini-line w-full"></div>
            <div class="sheet-mini-line w-full"></div>
            <div class="sheet-mini-line w-80"></div>
            <div class="sheet-mini-line w-60"></div>
            <div class="sheet-mini-line w-40"></div>
          </div>
        </div>
      `;
    }
    if (t.id === 'lab-report' || t.category === 'reports') {
      return `
        <div style="text-align:center; display:flex; flex-direction:column; align-items:center;">
          <div class="sheet-mini-title" style="width:75%;"></div>
          <div class="sheet-mini-sub" style="width:45%;"></div>
        </div>
        <div class="sheet-mini-line w-full" style="opacity:0.4;"></div>
        <div class="sheet-mini-line w-full"></div>
        <div class="sheet-mini-line w-80"></div>
        <div class="sheet-mini-math"></div>
        <div class="sheet-mini-table">
          <div class="sheet-mini-line w-full"></div>
          <div class="sheet-mini-line w-full" style="opacity:0.15;"></div>
        </div>
        <div class="sheet-mini-cols">
          <div class="sheet-mini-col"><div class="sheet-mini-line w-full"></div><div class="sheet-mini-line w-60"></div></div>
          <div class="sheet-mini-col"><div class="sheet-mini-line w-full"></div><div class="sheet-mini-line w-80"></div></div>
        </div>
      `;
    }
    if (t.id === 'beamer-presentation' || t.category === 'beamer') {
      return `
        <div style="height:10px; background:currentColor; opacity:0.75; border-radius:2px 2px 0 0; margin:-10px -10px 4px -10px;"></div>
        <div class="sheet-mini-title" style="width:70%;"></div>
        <div class="sheet-mini-line w-60" style="margin-bottom:6px;"></div>
        <div class="sheet-mini-box">
          <div class="sheet-mini-title" style="width:40%; height:4px;"></div>
          <div class="sheet-mini-line w-full"></div>
          <div class="sheet-mini-line w-80"></div>
        </div>
        <div class="sheet-mini-line w-full"></div>
        <div class="sheet-mini-line w-60"></div>
      `;
    }
    if (t.id === 'academic-thesis' || t.category === 'thesis') {
      return `
        <div style="margin-top:8px;">
          <div class="sheet-mini-title" style="width:50%; height:8px; margin-bottom:6px;"></div>
          <div class="sheet-mini-sub" style="width:30%; margin-bottom:8px;"></div>
        </div>
        <div class="sheet-mini-line w-full"></div>
        <div class="sheet-mini-line w-80"></div>
        <div class="sheet-mini-line w-full"></div>
        <div class="sheet-mini-line w-60"></div>
        <div class="sheet-mini-line w-full"></div>
        <div class="sheet-mini-line w-80"></div>
        <div class="sheet-mini-line w-40"></div>
      `;
    }
    if (t.id === 'modern-cv' || t.category === 'cv') {
      return `
        <div class="sheet-mini-cols">
          <div class="sheet-mini-col" style="flex:0 0 35px; border-right:1px solid rgba(0,0,0,0.1); padding-right:4px;">
            <div style="width:18px; height:18px; border-radius:50%; background:currentColor; opacity:0.35; margin:0 auto 4px;"></div>
            <div class="sheet-mini-line w-full"></div>
            <div class="sheet-mini-line w-full"></div>
            <div class="sheet-mini-line w-full"></div>
          </div>
          <div class="sheet-mini-col">
            <div class="sheet-mini-title" style="width:70%;"></div>
            <div class="sheet-mini-sub" style="width:40%;"></div>
            <div class="sheet-mini-line w-full"></div>
            <div class="sheet-mini-line w-80"></div>
            <div class="sheet-mini-line w-full"></div>
            <div class="sheet-mini-line w-60"></div>
          </div>
        </div>
      `;
    }
    if (t.id === 'homework-assignment' || t.category === 'assignments') {
      return `
        <div class="sheet-mini-title" style="width:85%;"></div>
        <div class="sheet-mini-sub" style="width:50%;"></div>
        <div class="sheet-mini-box">
          <div class="sheet-mini-line w-full"></div>
          <div class="sheet-mini-line w-80"></div>
        </div>
        <div class="sheet-mini-line w-full"></div>
        <div class="sheet-mini-line w-60"></div>
        <div class="sheet-mini-math"></div>
        <div class="sheet-mini-line w-full"></div>
        <div class="sheet-mini-line w-80"></div>
        <div class="sheet-mini-line w-40"></div>
      `;
    }
    return `
      <div class="sheet-mini-title" style="width:80%;"></div>
      <div class="sheet-mini-sub" style="width:45%;"></div>
      <div class="sheet-mini-line w-full"></div>
      <div class="sheet-mini-line w-80"></div>
      <div class="sheet-mini-line w-full"></div>
      <div class="sheet-mini-line w-60"></div>
      <div class="sheet-mini-code">
        <div class="sheet-mini-line w-80"></div>
      </div>
      <div class="sheet-mini-line w-full"></div>
      <div class="sheet-mini-line w-40"></div>
    `;
  }

  function renderTemplateCards(category = "all", filterText = "") {
    templateGrid.innerHTML = "";
    const all = LackTemplates.getAllTemplates();
    const official = all.filter(t => !t.isCustom);
    const custom = all.filter(t => !!t.isCustom);

    const countAllEl = document.getElementById("count-all");
    const countOfficialEl = document.getElementById("count-official");
    const countCustomEl = document.getElementById("count-custom");
    if (countAllEl) countAllEl.textContent = all.length;
    if (countOfficialEl) countOfficialEl.textContent = official.length;
    if (countCustomEl) countCustomEl.textContent = custom.length;

    const filtered = all.filter(t => {
      const matchCat = category === "all" ? true :
                       category === "official" ? !t.isCustom :
                       category === "custom" ? !!t.isCustom :
                       t.category === category;
      const matchText = !filterText ? true :
                        (t.title + " " + t.description + " " + (t.categoryLabel || t.category)).toLowerCase().includes(filterText.toLowerCase());
      return matchCat && matchText;
    });

    const visibleCountEl = document.getElementById("template-visible-count");
    if (visibleCountEl) {
      visibleCountEl.textContent = `${filtered.length} template ${filtered.length === 1 ? 'disponibile' : 'disponibili'}`;
    }

    if (filtered.length === 0) {
      templateGrid.innerHTML = `
        <div class="template-cards-empty" style="grid-column: 1 / -1; text-align: center; padding: 40px; opacity: 0.6;">
          <p>Nessun template trovato</p>
        </div>
      `;
      return;
    }

    templateGrid.innerHTML = filtered.map(t => {
      const isCustom = !!t.isCustom;
      const customBadge = isCustom ? `<span class="template-badge-pill custom">Custom</span>` : '';

      return `
        <div class="template-card" data-template-id="${escapeHtml(t.id)}">
          <div class="template-card-sheet-preview">
            <div class="template-card-sheet">
              ${generateMiniSheet(t)}
            </div>
          </div>
          <div class="template-card-content">
            <div class="template-card-meta">
              <span class="template-category-pill">${escapeHtml(t.categoryLabel || t.category || '')}</span>
              ${customBadge}
            </div>
            <h4 class="template-card-title">${escapeHtml(t.title)}</h4>
            <p class="template-card-description">${escapeHtml(t.description || '')}</p>
          </div>
          <div class="template-card-footer">
            <button type="button" class="template-card-btn-use" data-action="use-template" data-template-id="${escapeHtml(t.id)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              <span>${i18n.t('template_use') || 'Usa template'}</span>
            </button>
            <button type="button" class="template-card-btn-preview" data-action="preview-template" data-template-id="${escapeHtml(t.id)}">
              <span>${i18n.t('template_preview') || 'Anteprima'}</span>
            </button>
            ${isCustom ? `
            <button type="button" class="template-card-btn-edit" data-action="edit-template" data-template-id="${escapeHtml(t.id)}" title="${i18n.t('template_edit_modal_title') || 'Modifica'}">
              Modifica
            </button>
            <button type="button" class="template-card-btn-delete" data-action="delete-template" data-template-id="${escapeHtml(t.id)}" title="${i18n.t('template_delete') || 'Elimina'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    templateGrid.querySelectorAll(".template-card").forEach(card => {
      const templateId = card.dataset.templateId;
      const template = LackTemplates.getTemplateById(templateId);
      if (!template) return;

      card.querySelector(".template-card-btn-use").onclick = (e) => {
        e.stopPropagation();
        useTemplate(template);
      };
      card.querySelector(".template-card-btn-preview").onclick = (e) => {
        e.stopPropagation();
        showTemplatePreview(template);
      };
      const editBtn = card.querySelector(".template-card-btn-edit");
      if (editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
          openEditTemplateModal(templateId);
        };
      }
      const deleteBtn = card.querySelector(".template-card-btn-delete");
      if (deleteBtn) {
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          handleDeleteTemplate(templateId);
        };
      }
      card.onclick = () => showTemplatePreview(template);
    });
  }

  function showTemplatePreview(t) {
    previewedTemplate = t;
    document.getElementById("preview-category-pill").textContent = t.categoryLabel || t.category;
    document.getElementById("preview-template-title").textContent = t.title;
    document.getElementById("preview-template-desc").textContent = t.description;

    const sourceBody = document.getElementById("preview-source-body");
    const renderedBody = document.getElementById("preview-rendered-body");
    sourceBody.value = t.content;

    const parsed = latexCompiler.convertLatexToHtml(t.content);
    renderedBody.innerHTML = parsed.html;
    if (window.renderMathInElement) {
      window.renderMathInElement(renderedBody, {
        delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
        throwOnError: false
      });
    }

    templatePreviewDrawer.classList.remove("hidden");
  }

  async function useTemplate(t) {
    if (!t) return;
    templateModal.classList.add("hidden");
    if (templatePreviewDrawer) templatePreviewDrawer.classList.add("hidden");

    const currentTab = getActiveTab();
    const currentContent = cm ? cm.getValue() : (currentTab ? currentTab.content : "");
    const isCurrentEmpty = !currentTab || !currentContent || currentContent.trim() === "";

    if (isCurrentEmpty) {
      if (currentTab && cm) {
        cm.setValue(t.content || "");
        currentTab.content = t.content || "";
        currentTab.dirty = true;
        if (!currentTab.filePath && currentTab.title && currentTab.title.startsWith("untitled")) {
          currentTab.title = t.suggestedFilename || `${t.title || "template"}.tex`;
        }
        renderTabs();
        showNotification(i18n.t("template_loaded", { name: t.title }) || `Template "${t.title}" caricato!`, "info");
        triggerCompile(false);
      } else {
        newFile(t.content);
        showNotification(i18n.t("template_loaded", { name: t.title }) || `Template "${t.title}" caricato!`, "info");
      }
    } else {
      const choice = await showCustomConfirmDialog({
        title: i18n.t("template_gallery_title") || "Template",
        message: i18n.t("template_replace_confirm") || "Il documento corrente contiene testo. Vuoi sostituire il contenuto o aprire in una nuova scheda?",
        icon: "question",
        buttons: [
          { text: i18n.t("dialog_cancel") || "Annulla", value: "cancel", isCancel: true },
          { text: i18n.t("template_btn_replace") || "Sostituisci", value: "replace", isDanger: true },
          { text: i18n.t("template_btn_new_tab") || "Nuova scheda", value: "new-tab", isPrimary: true }
        ]
      });

      if (choice === "replace") {
        if (cm) {
          cm.setValue(t.content || "");
          if (currentTab) {
            currentTab.content = t.content || "";
            currentTab.dirty = true;
          }
          renderTabs();
          showNotification(i18n.t("template_loaded", { name: t.title }) || `Template "${t.title}" caricato!`, "info");
          triggerCompile(false);
        }
      } else if (choice === "new-tab") {
        newFile(t.content);
        showNotification(i18n.t("template_loaded", { name: t.title }) || `Template "${t.title}" caricato!`, "info");
      }
    }
  }

  document.getElementById("btn-use-previewed-template").onclick = () => {
    if (previewedTemplate) useTemplate(previewedTemplate);
  };
  document.getElementById("btn-close-template-preview").onclick = () => {
    templatePreviewDrawer.classList.add("hidden");
  };
  document.getElementById("btn-close-template-gallery").onclick = () => {
    templateModal.classList.add("hidden");
  };
  document.getElementById("template-gallery-overlay").onclick = () => {
    templateModal.classList.add("hidden");
  };

  document.querySelectorAll(".template-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".template-nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const cat = btn.dataset.category;
      document.getElementById("template-current-category-title").textContent = btn.querySelector("span")?.textContent || cat;
      renderTemplateCards(cat, document.getElementById("template-search-input").value);
    });
  });

  const templateSearchInput = document.getElementById("template-search-input");
  const templateSearchClear = document.getElementById("template-search-clear");
  templateSearchInput.addEventListener("input", (e) => {
    const val = e.target.value;
    if (templateSearchClear) {
      if (val) templateSearchClear.classList.remove("hidden");
      else templateSearchClear.classList.add("hidden");
    }
    const activeNav = document.querySelector(".template-nav-btn.active");
    const cat = activeNav ? activeNav.dataset.category : "all";
    renderTemplateCards(cat, val);
  });
  if (templateSearchClear) {
    templateSearchClear.addEventListener("click", () => {
      templateSearchInput.value = "";
      templateSearchClear.classList.add("hidden");
      const activeNav = document.querySelector(".template-nav-btn.active");
      const cat = activeNav ? activeNav.dataset.category : "all";
      renderTemplateCards(cat, "");
      templateSearchInput.focus();
    });
  }

  document.getElementById("btn-gallery-save-current")?.addEventListener("click", () => {
    openSaveTemplateModal();
  });

  // ====== SAVE / EDIT TEMPLATE MODAL (MARK STYLE) ======
  const saveTemplateModal = document.getElementById("save-template-modal");
  const saveTemplateOverlay = document.getElementById("save-template-overlay");
  const saveTemplateModalTitle = document.getElementById("save-template-modal-title");
  const saveTemplateEditId = document.getElementById("save-template-edit-id");
  const btnCloseSaveTemplate = document.getElementById("btn-close-save-template");
  const btnCancelSaveTemplate = document.getElementById("btn-cancel-save-template");
  const btnConfirmSaveTemplate = document.getElementById("btn-confirm-save-template");
  const saveTemplateTitleInput = document.getElementById("save-template-title");
  const saveTemplateFilenameInput = document.getElementById("save-template-filename");
  const saveTemplateCategorySelect = document.getElementById("save-template-category");
  const btnToggleNewCategory = document.getElementById("btn-toggle-new-category");
  const saveTemplateNewCategoryBox = document.getElementById("save-template-new-category-box");
  const saveTemplateNewCategoryInput = document.getElementById("save-template-new-category-input");
  const saveTemplateScopeSelect = document.getElementById("save-template-scope");
  const optTemplateScopeProject = document.getElementById("opt-template-scope-project");
  const saveTemplateDescInput = document.getElementById("save-template-desc");
  const btnExportTemplateFile = document.getElementById("btn-export-template-file");

  function renderSidebarCategories() {
    const listEl = document.getElementById("template-categories-nav-list");
    if (!listEl || !LackTemplates) return;
    const allCats = LackTemplates.getAllCategories();
    const defaultIds = new Set(['academic', 'reports', 'thesis', 'beamer', 'cv', 'assignments', 'other']);
    const customCats = allCats.filter(c => !defaultIds.has(c.id));

    listEl.querySelectorAll('.template-nav-btn.custom-cat-btn').forEach(el => el.remove());

    customCats.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'template-nav-btn custom-cat-btn';
      btn.dataset.category = c.id;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span>${escapeHtml(c.label)}</span>
      `;
      btn.addEventListener('click', () => {
        document.querySelectorAll(".template-nav-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("template-current-category-title").textContent = c.label;
        renderTemplateCards(c.id, templateSearchInput?.value || "");
      });
      listEl.appendChild(btn);
    });
  }

  function populateSaveTemplateCategories(selectedId = 'academic') {
    if (!saveTemplateCategorySelect || !LackTemplates) return;
    const cats = LackTemplates.getAllCategories();
    saveTemplateCategorySelect.innerHTML = cats.map(c => `
      <option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.label)}</option>
    `).join('');
  }

  function openSaveTemplateModal() {
    if (!saveTemplateModal) return;
    const content = cm ? cm.getValue() : "";
    if (!content || !content.trim()) {
      showNotification(i18n.t("editor_placeholder") || "Documento vuoto: inserisci del codice LaTeX prima di salvarlo come template", "warning");
      return;
    }

    const currentTab = getActiveTab();
    let initialTitle = "";
    if (currentTab && currentTab.title) {
      initialTitle = currentTab.title.replace(/\.tex$/i, "");
      if (initialTitle.startsWith("untitled")) {
        initialTitle = "Il mio template";
      }
    }

    if (saveTemplateModalTitle) saveTemplateModalTitle.textContent = i18n.t("template_save_modal_title") || "Salva come Template";
    if (saveTemplateEditId) saveTemplateEditId.value = "";
    if (btnConfirmSaveTemplate) btnConfirmSaveTemplate.textContent = i18n.t("save") || "Salva Template";

    populateSaveTemplateCategories('academic');
    if (saveTemplateTitleInput) {
      saveTemplateTitleInput.value = initialTitle;
    }
    if (saveTemplateFilenameInput) {
      const slug = (initialTitle || 'template').toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_');
      saveTemplateFilenameInput.value = `${slug}.tex`;
    }
    if (saveTemplateDescInput) saveTemplateDescInput.value = "";
    if (saveTemplateNewCategoryBox) saveTemplateNewCategoryBox.classList.add("hidden");
    if (saveTemplateNewCategoryInput) saveTemplateNewCategoryInput.value = "";

    if (optTemplateScopeProject) {
      const hasActiveProject = !!(currentProjectDir || (isLinkedProject && currentProject));
      optTemplateScopeProject.disabled = !hasActiveProject;
      optTemplateScopeProject.textContent = hasActiveProject
        ? (i18n.t("template_location_project") || "Progetto corrente") + ` (${currentProject ? currentProject.name : path.basename(currentProjectDir || '')})`
        : (i18n.t("template_location_project") || "Progetto corrente") + " (Nessun progetto aperto)";
    }
    if (saveTemplateScopeSelect) {
      saveTemplateScopeSelect.value = "global";
    }

    saveTemplateModal.classList.remove("hidden");
    if (saveTemplateTitleInput) {
      setTimeout(() => {
        saveTemplateTitleInput.focus();
        saveTemplateTitleInput.select();
      }, 80);
    }
  }

  function openEditTemplateModal(templateId) {
    if (!LackTemplates || !saveTemplateModal) return;
    const template = LackTemplates.getTemplateById(templateId);
    if (!template) return;

    if (saveTemplateModalTitle) saveTemplateModalTitle.textContent = i18n.t("template_edit_modal_title") || "Modifica Template";
    if (saveTemplateEditId) saveTemplateEditId.value = templateId;
    if (btnConfirmSaveTemplate) btnConfirmSaveTemplate.textContent = i18n.t("template_update_btn") || "Aggiorna Template";

    populateSaveTemplateCategories(template.category);
    if (saveTemplateTitleInput) saveTemplateTitleInput.value = template.title || "";
    if (saveTemplateFilenameInput) saveTemplateFilenameInput.value = template.suggestedFilename || `${(template.title || 'template').toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.tex`;
    if (saveTemplateCategorySelect) saveTemplateCategorySelect.value = template.category || "academic";
    if (saveTemplateScopeSelect) saveTemplateScopeSelect.value = template.scope || "global";
    if (saveTemplateDescInput) saveTemplateDescInput.value = template.description || "";
    if (saveTemplateNewCategoryBox) saveTemplateNewCategoryBox.classList.add("hidden");
    if (saveTemplateNewCategoryInput) saveTemplateNewCategoryInput.value = "";

    saveTemplateModal.classList.remove("hidden");
    if (saveTemplateTitleInput) {
      setTimeout(() => {
        saveTemplateTitleInput.focus();
        saveTemplateTitleInput.select();
      }, 80);
    }
  }

  function closeSaveTemplateModal() {
    if (!saveTemplateModal) return;
    saveTemplateModal.classList.add("hidden");
  }

  async function handleDeleteTemplate(templateId) {
    if (!LackTemplates) return;
    const template = LackTemplates.getTemplateById(templateId);
    if (!template) return;

    const confirmMsg = i18n.t("template_delete_confirm", { name: template.title }) || `Eliminare il template "${template.title}"?`;
    const confirmed = await showCustomConfirmDialog({
      title: i18n.t("template_delete") || "Elimina Template",
      message: confirmMsg,
      okText: i18n.t("template_delete") || "Elimina",
      cancelText: i18n.t("cancel") || "Annulla",
      isDanger: true
    });

    if (confirmed) {
      LackTemplates.deleteCustomTemplate(templateId);
      if (previewedTemplate && previewedTemplate.id === templateId) {
        templatePreviewDrawer.classList.add("hidden");
      }
      const activeNav = document.querySelector(".template-nav-btn.active");
      const activeCat = activeNav ? activeNav.dataset.category : "all";
      renderTemplateCards(activeCat, templateSearchInput?.value || "");
      showNotification(i18n.t("template_deleted_success") || "Template rimosso con successo!", "info");
    }
  }

  saveTemplateTitleInput?.addEventListener("input", (e) => {
    if (!saveTemplateEditId?.value && saveTemplateFilenameInput) {
      const slug = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_');
      saveTemplateFilenameInput.value = slug ? `${slug}.tex` : 'template.tex';
    }
  });

  btnToggleNewCategory?.addEventListener("click", () => {
    if (saveTemplateNewCategoryBox) {
      saveTemplateNewCategoryBox.classList.toggle("hidden");
      if (!saveTemplateNewCategoryBox.classList.contains("hidden") && saveTemplateNewCategoryInput) {
        saveTemplateNewCategoryInput.focus();
      }
    }
  });

  btnCloseSaveTemplate?.addEventListener("click", closeSaveTemplateModal);
  btnCancelSaveTemplate?.addEventListener("click", closeSaveTemplateModal);
  saveTemplateOverlay?.addEventListener("click", closeSaveTemplateModal);

  btnExportTemplateFile?.addEventListener("click", async () => {
    const content = cm ? cm.getValue() : "";
    if (!content.trim()) {
      showNotification("Documento vuoto: nulla da esportare", "warning");
      return;
    }
    const title = saveTemplateTitleInput?.value.trim() || "template";
    const defaultFilename = saveTemplateFilenameInput?.value.trim() || `${title.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.tex`;

    try {
      const { filePath } = await dialog.showSaveDialog({
        title: "Esporta Template LaTeX",
        defaultPath: defaultFilename,
        filters: [{ name: "File LaTeX", extensions: ["tex"] }]
      });

      if (filePath) {
        fs.writeFileSync(filePath, content, "utf8");
        showNotification(`Template esportato in ${path.basename(filePath)}`, "info");
      }
    } catch (err) {
      showNotification("Errore esportazione template: " + err.message, "error");
    }
  });

  btnConfirmSaveTemplate?.addEventListener("click", () => {
    if (!LackTemplates) {
      showNotification("Modulo template non disponibile", "error");
      return;
    }

    const title = saveTemplateTitleInput ? saveTemplateTitleInput.value.trim() : "";
    if (!title) {
      showNotification("Inserisci un nome per il template", "warning");
      saveTemplateTitleInput?.focus();
      return;
    }

    let category = saveTemplateCategorySelect ? saveTemplateCategorySelect.value : "academic";
    const newCatName = saveTemplateNewCategoryInput ? saveTemplateNewCategoryInput.value.trim() : "";
    if (newCatName) {
      const addedCat = LackTemplates.addCategory(newCatName);
      if (addedCat) category = addedCat.id;
    }

    const filename = saveTemplateFilenameInput ? saveTemplateFilenameInput.value.trim() : "";
    const scope = saveTemplateScopeSelect ? saveTemplateScopeSelect.value : "global";
    const description = saveTemplateDescInput ? saveTemplateDescInput.value.trim() : "";
    const editId = saveTemplateEditId ? saveTemplateEditId.value : "";

    try {
      if (editId) {
        LackTemplates.updateCustomTemplate(editId, {
          title,
          category,
          suggestedFilename: filename,
          scope,
          description
        });
        showNotification(i18n.t("template_updated_success") || "Template modificato con successo!", "success");
      } else {
        const content = cm ? cm.getValue() : "";
        LackTemplates.saveCustomTemplate({
          title,
          category,
          suggestedFilename: filename,
          scope,
          description,
          content
        });
        showNotification(i18n.t("template_saved_success") || "Template salvato con successo!", "success");
      }

      closeSaveTemplateModal();
      renderSidebarCategories();
      const activeNav = document.querySelector(".template-nav-btn.active");
      const activeCat = activeNav ? activeNav.dataset.category : "all";
      renderTemplateCards(activeCat, templateSearchInput?.value || "");
    } catch (err) {
      showNotification(err.message || "Errore salvataggio template", "error");
    }
  });

  ipcRenderer.on("save-as-template", () => openSaveTemplateModal());

  // ====== TOOLBAR LATEX ACTIONS ======
  function wrapSelection(prefix, suffix) {
    if (cm) cm.wrapSelection(prefix, suffix);
  }

  document.getElementById("btn-bold").onclick = () => wrapSelection("\\textbf{", "}");
  document.getElementById("btn-italic").onclick = () => wrapSelection("\\textit{", "}");
  document.getElementById("btn-underline").onclick = () => wrapSelection("\\underline{", "}");
  document.getElementById("btn-code").onclick = () => wrapSelection("\\texttt{", "}");
  document.getElementById("btn-math-inline").onclick = () => { if (cm) cm.toggleMath(); };
  document.getElementById("btn-math-display").onclick = () => wrapSelection("\\[\n  ", "\n\\]");
  document.getElementById("btn-fraction").onclick = () => wrapSelection("\\frac{", "}{denominator}");
  document.getElementById("btn-sqrt").onclick = () => wrapSelection("\\sqrt{", "}");

  // Greek and Symbol Palettes
  document.querySelectorAll(".greek-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = item.dataset.symbol;
      wrapSelection(sym, "");
      closeAllToolbarDropdowns();
    });
  });

  document.querySelectorAll("#dropdown-content .dropdown-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      if (action === "insert-section") wrapSelection("\\section{", "}");
      if (action === "insert-subsection") wrapSelection("\\subsection{", "}");
      if (action === "insert-subsubsection") wrapSelection("\\subsubsection{", "}");
      if (action === "insert-paragraph") wrapSelection("\\paragraph{", "}");
      closeAllToolbarDropdowns();
    });
  });

  document.querySelectorAll("#dropdown-extra .extra-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      if (action === "insert-figure") {
        wrapSelection("\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{filename}\n  \\caption{Caption text}\n  \\label{fig:mylabel}\n\\end{figure}\n", "");
      } else if (action === "insert-table") {
        wrapSelection("\\begin{table}[htbp]\n  \\centering\n  \\caption{Table Caption}\n  \\label{tab:mytable}\n  \\begin{tabular}{|c|c|}\n    \\hline\n    Header 1 & Header 2 \\\\\n    \\hline\n    Row 1 & Value 1 \\\\\n    \\hline\n  \\end{tabular}\n\\end{table}\n", "");
      } else if (action === "insert-equation") {
        wrapSelection("\\begin{equation}\n  ", "\n\\end{equation}\n");
      } else if (action === "insert-align") {
        wrapSelection("\\begin{align}\n  ", "\n\\end{align}\n");
      } else if (action === "insert-itemize") {
        wrapSelection("\\begin{itemize}\n  \\item ", "\n\\end{itemize}\n");
      } else if (action === "insert-enumerate") {
        wrapSelection("\\begin{enumerate}\n  \\item ", "\n\\end{enumerate}\n");
      } else if (action === "insert-cite") {
        wrapSelection("\\cite{", "}");
      } else if (action === "insert-ref") {
        wrapSelection("\\ref{", "}");
      } else if (action === "insert-label") {
        wrapSelection("\\label{", "}");
      } else if (action === "insert-href") {
        wrapSelection("\\href{https://", "}{link text}");
      }
      closeAllToolbarDropdowns();
    });
  });

  // Dropdown toggles
  const dropdownTitle = document.getElementById("dropdown-title");
  const btnTitle = document.getElementById("btn-title");
  const dropdownGreek = document.getElementById("dropdown-greek");
  const btnGreek = document.getElementById("btn-greek");
  const dropdownExtra = document.getElementById("dropdown-extra");
  const btnExtra = document.getElementById("btn-extra");

  function closeAllToolbarDropdowns() {
    dropdownTitle?.classList.remove("open");
    btnTitle?.classList.remove("active");
    dropdownGreek?.classList.remove("open");
    btnGreek?.classList.remove("active");
    dropdownExtra?.classList.remove("open");
    btnExtra?.classList.remove("active");
  }

  btnTitle?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllTitlebarMenus();
    const isOpen = dropdownTitle?.classList.contains("open");
    closeAllToolbarDropdowns();
    if (!isOpen) {
      dropdownTitle?.classList.add("open");
      btnTitle?.classList.add("active");
    }
  });

  btnGreek?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllTitlebarMenus();
    const isOpen = dropdownGreek?.classList.contains("open");
    closeAllToolbarDropdowns();
    if (!isOpen) {
      dropdownGreek?.classList.add("open");
      btnGreek?.classList.add("active");
    }
  });

  btnExtra?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllTitlebarMenus();
    const isOpen = dropdownExtra?.classList.contains("open");
    closeAllToolbarDropdowns();
    if (!isOpen) {
      dropdownExtra?.classList.add("open");
      btnExtra?.classList.add("active");
    }
  });

  // ====== TITLEBAR MENUS ======
  const titlebarDropdowns = document.querySelectorAll('.titlebar-menu-dropdown');
  let isAnyTitlebarMenuOpen = false;

  function closeAllTitlebarMenus() {
    titlebarDropdowns.forEach(d => d.classList.remove('open'));
    isAnyTitlebarMenuOpen = false;
  }

  function openTitlebarMenu(dropdown) {
    closeAllTitlebarMenus();
    closeAllToolbarDropdowns();
    dropdown.classList.add('open');
    isAnyTitlebarMenuOpen = true;
  }

  titlebarDropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.titlebar-menu-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('open')) {
        closeAllTitlebarMenus();
      } else {
        openTitlebarMenu(dropdown);
      }
    });

    trigger.addEventListener('mouseenter', () => {
      if (isAnyTitlebarMenuOpen && !dropdown.classList.contains('open')) {
        openTitlebarMenu(dropdown);
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.titlebar-menu-dropdown')) closeAllTitlebarMenus();
    if (!e.target.closest('#dropdown-title') && !e.target.closest('#dropdown-greek') && !e.target.closest('#dropdown-extra')) {
      closeAllToolbarDropdowns();
    }
  });

  document.getElementById('explorer-panel')?.addEventListener('click', (e) => {
    if (!e.target.closest('input, textarea, select, button, .tree-item')) {
      document.getElementById('explorer-panel')?.focus({ preventScroll: true });
    }
  });

  document.addEventListener('keydown', (e) => {
    const appConfirmModal = document.getElementById('app-confirm-modal');
    if (appConfirmModal && !appConfirmModal.classList.contains('hidden')) {
      if (e.key === 'Enter') {
        const primaryBtn = appConfirmModal.querySelector('.app-confirm-btn-primary, .app-confirm-btn-danger');
        if (primaryBtn) {
          e.preventDefault();
          primaryBtn.click();
          return;
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCustomConfirmDialog(currentCancelValue);
        return;
      }
      return;
    }

    if (e.key === 'Escape') {
      closeAllTitlebarMenus();
      closeAllToolbarDropdowns();
      document.getElementById('new-file-popup')?.classList.add('hidden');
    }

    if (document.querySelector('.modal:not(.hidden)')) {
      return;
    }

    const activeEl = document.activeElement;
    const tag = activeEl ? activeEl.tagName : '';

    // Explorer Undo shortcut (Ctrl+Z / Cmd+Z) when focus is not inside a text editor or input
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      const inEditor = activeEl?.closest?.('.cm-editor') || e.target?.closest?.('.cm-editor');
      const inTextControl = ['TEXTAREA', 'INPUT', 'SELECT'].includes(tag) || activeEl?.isContentEditable;
      if (!inEditor && !inTextControl && explorerUndoStack.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        undoLastExplorerAction();
        return;
      }
    }

    if (['TEXTAREA', 'INPUT', 'BUTTON', 'SELECT'].includes(tag) || activeEl?.isContentEditable) {
      return;
    }

    // Rename shortcut (F2) on single selected explorer item
    if (e.key === 'F2' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (selectedExplorerPaths && selectedExplorerPaths.length > 1) return;
      if (selectedExplorerElement && selectedExplorerPath) {
        e.preventDefault();
        showInlineRename(selectedExplorerElement, selectedExplorerPath, () => {
          if (isLinkedProject && currentProject) renderProjectPane(currentProject.storePath);
          if (currentProjectDir) renderFolderPane(currentProjectDir);
        });
        return;
      }
    }

    // Delete shortcut (Delete / Canc / Del / Mac Cmd+Backspace)
    if (selectedExplorerPath || (selectedExplorerPaths && selectedExplorerPaths.length > 0)) {
      const isExplorerFocused =
        (selectedExplorerElement && document.activeElement === selectedExplorerElement) ||
        document.getElementById('explorer-panel')?.contains(document.activeElement) ||
        document.activeElement === document.body;

      if (isExplorerFocused) {
        const isDarwin = process.platform === 'darwin';
        const isDelete = isDarwin
          ? (e.metaKey && (e.key === 'Backspace' || e.key === 'Delete'))
          : (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'Delete' || e.key === 'Del' || e.code === 'Delete' || e.key === 'Canc'));

        if (isDelete) {
          e.preventDefault();
          const targets = (selectedExplorerPaths && selectedExplorerPaths.length > 0)
            ? selectedExplorerPaths
            : (selectedExplorerPath ? [selectedExplorerPath] : []);
          if (targets.length > 0) {
            deleteExplorerFiles(targets);
          }
          return;
        }
      }
    }
  });

  document.querySelectorAll('.titlebar-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      if (!action) return;
      closeAllTitlebarMenus();

      switch (action) {
        case 'new-file': newFile(); break;
        case 'new-project': openNewProjectModal(); break;
        case 'open-projects': openProjectsManager(); break;
        case 'export-project': openExportModal(); break;
        case 'open-file': openFileDialog(); break;
        case 'open-folder': openFolderDialog(); break;
        case 'save-file': saveFile(); break;
        case 'save-as-template': openSaveTemplateModal(); break;
        case 'choose-template': openTemplateGallery(); break;
        case 'export-pdf': downloadPdf(); break;
        case 'open-settings': settingsModal.classList.remove('hidden'); break;
        case 'close-tab': if (activeTabId) closeTab(activeTabId); break;
        case 'quit-app': ipcRenderer.send('window-close'); break;
        case 'undo':
          if (!document.activeElement?.closest?.('.cm-editor') && explorerUndoStack.length > 0) {
            await undoLastExplorerAction();
          } else {
            document.execCommand('undo');
          }
          break;
        case 'redo': document.execCommand('redo'); break;
        case 'cut': document.execCommand('cut'); break;
        case 'copy': document.execCommand('copy'); break;
        case 'paste':
          try {
            const clipText = clipboard.readText();
            if (clipText) wrapSelection(clipText, "");
          } catch (_) {
            document.execCommand('paste');
          }
          break;
        case 'select-all': cm.view.dispatch({ selection: { anchor: 0, head: cm.view.state.doc.length } }); break;
        case 'find':
          openDocumentSearch();
          break;
        case 'find-in-project':
          openProjectSearch();
          break;
        case 'trigger-compile': triggerCompile(false); break;
        case 'toggle-compile-on-save':
          config.compileOnSave = !config.compileOnSave;
          localStorage.setItem("lack-compileOnSave", config.compileOnSave);
          updateCompileOnSaveMenuLabel();
          showNotification(`Compila al salvataggio (Ctrl+S): ${config.compileOnSave ? 'Attivo' : 'Disattivato'}`, "info");
          break;
        case 'toggle-auto-compile':
          config.autoCompile = !config.autoCompile;
          localStorage.setItem("lack-autoCompile", config.autoCompile);
          if (checkAutoCompile) checkAutoCompile.checked = config.autoCompile;
          updateAutoCompileMenuLabel();
          showNotification(`Auto-compile: ${config.autoCompile ? 'On' : 'Off'}`, "info");
          break;
        case 'recompile-from-scratch':
          cleanAuxiliaryFiles();
          triggerCompile(false);
          break;
        case 'stop-compile':
          await ipcRenderer.invoke('stop-compilation');
          isCompiling = false;
          btnRecompile.classList.remove("compiling");
          showNotification("Compilazione interrotta", "info");
          break;
        case 'toggle-logs': logsDrawer.classList.toggle('hidden'); break;
        case 'clean-aux': cleanAuxiliaryFiles(); break;
        case 'toggle-explorer': document.getElementById('explorer-panel')?.classList.toggle('hidden'); break;
        case 'toggle-outline':
          document.getElementById("sidebar-tab-outline")?.click();
          break;
        case 'view-editor': setViewMode('solo-editor'); break;
        case 'view-split': setViewMode('split-view'); break;
        case 'view-preview': setViewMode('solo-preview'); break;
        case 'zoom-in':
          applyUiZoom(currentZoomLevel + 0.1);
          break;
        case 'zoom-out':
          applyUiZoom(currentZoomLevel - 0.1);
          break;
        case 'zoom-reset':
          applyUiZoom(1.0);
          break;
        case 'set-theme-light': applyTheme('light'); break;
        case 'set-theme-dark': applyTheme('dark'); break;
        case 'set-theme-github': applyTheme('github'); break;
      }
    });
  });

  // ====== VIEW MODES (PREVIEW ONLY <, SPLIT >|<, EDITOR ONLY >) ======
  const btnSoloPreview = document.getElementById("btn-view-preview");
  const btnSplitView = document.getElementById("btn-view-split");
  const btnSoloEditor = document.getElementById("btn-view-editor");

  function setViewMode(mode) {
    if (mode === "split") mode = "split-view";
    config.viewMode = mode;
    localStorage.setItem("lack-viewMode", mode);

    mainStageContainer.classList.remove("split-view", "solo-editor", "solo-preview");
    mainStageContainer.classList.add(mode);

    btnSoloPreview?.classList.toggle("active", mode === "solo-preview");
    btnSplitView?.classList.toggle("active", mode === "split-view");
    btnSoloEditor?.classList.toggle("active", mode === "solo-editor");
  }

  // < = Solo Preview, >|< = Split, > = Solo Editor
  btnSoloPreview?.addEventListener("click", () => setViewMode("solo-preview"));
  btnSplitView?.addEventListener("click", () => setViewMode("split-view"));
  btnSoloEditor?.addEventListener("click", () => setViewMode("solo-editor"));

  // Apply saved view mode
  setViewMode(config.viewMode);

  // ====== P2P WEBRTC COLLABORATION ======
  let collabModuleRef = null;
  function getCollabModule() {
    if (!collabModuleRef) {
      collabModuleRef = require("./collaboration.js");
    }
    return collabModuleRef;
  }

  function getCollabSignalingConfig() {
    const raw = localStorage.getItem("lack-collab-signaling");
    if (!raw) return null;
    return raw.split("\n").map(s => s.trim()).filter(Boolean);
  }

  function getCollabIceConfig() {
    const raw = localStorage.getItem("lack-collab-ice");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  const collabModal = document.getElementById("collab-modal");
  const btnCollab = document.getElementById("btn-collab");
  const collabStatusPill = document.getElementById("collab-status-container");
  const collabStatusText = document.getElementById("collab-status-text");

  btnCollab.onclick = () => {
    const collab = getCollabModule();
    const state = collab.getCollabState();
    const disconnectedView = document.getElementById("collab-disconnected-view");
    const connectedView = document.getElementById("collab-connected-view");

    if (state.isActive) {
      connectedView?.classList.remove("hidden");
      disconnectedView?.classList.add("hidden");
      const activeInput = document.getElementById("collab-active-room-id");
      if (activeInput) activeInput.value = state.roomId;
    } else {
      connectedView?.classList.add("hidden");
      disconnectedView?.classList.remove("hidden");
      const newRoomInput = document.getElementById("collab-new-room-id");
      if (newRoomInput) newRoomInput.value = collab.generateRoomId();
    }

    // Reset status indicators
    document.getElementById("collab-status-create")?.classList.add("hidden");
    document.getElementById("collab-status-join")?.classList.add("hidden");
    const btnCreate = document.getElementById("btn-collab-create");
    const btnJoin = document.getElementById("btn-collab-join");
    if (btnCreate) btnCreate.disabled = false;
    if (btnJoin) btnJoin.disabled = false;

    collabModal.classList.remove("hidden");
  };

  document.getElementById("btn-close-collab")?.addEventListener("click", () => collabModal.classList.add("hidden"));
  document.getElementById("collab-overlay")?.addEventListener("click", () => collabModal.classList.add("hidden"));

  document.getElementById("tab-btn-create")?.addEventListener("click", () => {
    document.getElementById("tab-btn-create")?.classList.add("active");
    document.getElementById("tab-btn-join")?.classList.remove("active");
    document.getElementById("collab-pane-create")?.classList.remove("hidden");
    document.getElementById("collab-pane-join")?.classList.add("hidden");
  });

  document.getElementById("tab-btn-join")?.addEventListener("click", () => {
    document.getElementById("tab-btn-join")?.classList.add("active");
    document.getElementById("tab-btn-create")?.classList.remove("active");
    document.getElementById("collab-pane-join")?.classList.remove("hidden");
    document.getElementById("collab-pane-create")?.classList.add("hidden");
  });

  document.getElementById("btn-collab-regen-id").onclick = () => {
    document.getElementById("collab-new-room-id").value = getCollabModule().generateRoomId();
  };

  document.getElementById("btn-collab-copy-id").onclick = () => {
    const id = document.getElementById("collab-new-room-id").value;
    clipboard.writeText(id);
    showNotification(i18n.t("notif_copied"), "info");
  };

  document.getElementById("btn-collab-copy-active-id").onclick = () => {
    const id = document.getElementById("collab-active-room-id").value;
    clipboard.writeText(id);
    showNotification(i18n.t("notif_copied"), "info");
  };

  document.getElementById("btn-collab-create").onclick = () => {
    const roomId = document.getElementById("collab-new-room-id").value;
    const password = document.getElementById("collab-create-password")?.value || null;
    const btn = document.getElementById("btn-collab-create");
    const statusEl = document.getElementById("collab-status-create");
    const statusText = document.getElementById("collab-status-create-text");

    btn.disabled = true;
    statusEl?.classList.remove("hidden", "status-error");
    if (statusText) statusText.textContent = i18n.t("collab_connecting");

    const collab = getCollabModule();
    const customSig = getCollabSignalingConfig();
    const customIce = getCollabIceConfig();

    const ok = collab.startCollaboration({
      roomId: roomId,
      password: password,
      cm: cm,
      isJoining: false,
      signalingServers: customSig,
      iceServers: customIce,
      onRemoteUpdate: () => updateWordCount(),
      onUsersChange: (count) => {
        const userCountEl = document.getElementById("collab-users-count");
        if (userCountEl) userCountEl.textContent = count;
        collabStatusText.textContent = `${count} online (${roomId})`;
      },
      onStatusChange: (status, errDetail) => {
        if (status === 'connected') {
          collabStatusPill.classList.remove("hidden");
          collabStatusText.textContent = `1 online (${roomId})`;
          btnCollab?.classList.add("active-collab");

          // Transition modal view to connected
          const connectedView = document.getElementById("collab-connected-view");
          const disconnectedView = document.getElementById("collab-disconnected-view");
          connectedView?.classList.remove("hidden");
          disconnectedView?.classList.add("hidden");
          const activeInput = document.getElementById("collab-active-room-id");
          if (activeInput) activeInput.value = roomId;

          setTimeout(() => collabModal.classList.add("hidden"), 300);
          showNotification(i18n.t("notif_session_started", { room: roomId }), "info");
        } else if (status === 'error') {
          statusEl?.classList.add("status-error");
          if (statusText) statusText.textContent = `Errore di connessione: ${errDetail || 'impossibile connettersi'}`;
        }
        btn.disabled = false;
      },
      onError: (err) => {
        btn.disabled = false;
        statusEl?.classList.add("status-error");
        if (statusText) statusText.textContent = `Errore: ${err.message}`;
      },
      showNotification: showNotification
    });

    if (!ok) {
      btn.disabled = false;
    }
  };

  document.getElementById("btn-collab-join").onclick = () => {
    const roomId = document.getElementById("collab-join-room-id").value.trim();
    if (!roomId) return;
    const password = document.getElementById("collab-join-password")?.value || null;
    const btn = document.getElementById("btn-collab-join");
    const statusEl = document.getElementById("collab-status-join");
    const statusText = document.getElementById("collab-status-join-text");

    btn.disabled = true;
    statusEl?.classList.remove("hidden", "status-error");
    if (statusText) statusText.textContent = i18n.t("collab_connecting");

    const collab = getCollabModule();
    const customSig = getCollabSignalingConfig();
    const customIce = getCollabIceConfig();

    const ok = collab.startCollaboration({
      roomId: roomId,
      password: password,
      cm: cm,
      isJoining: true,
      signalingServers: customSig,
      iceServers: customIce,
      onRemoteUpdate: () => updateWordCount(),
      onUsersChange: (count) => {
        const userCountEl = document.getElementById("collab-users-count");
        if (userCountEl) userCountEl.textContent = count;
        collabStatusText.textContent = `${count} online (${roomId})`;
      },
      onStatusChange: (status, errDetail) => {
        if (status === 'connected') {
          collabStatusPill.classList.remove("hidden");
          collabStatusText.textContent = `1 online (${roomId})`;
          btnCollab?.classList.add("active-collab");

          const connectedView = document.getElementById("collab-connected-view");
          const disconnectedView = document.getElementById("collab-disconnected-view");
          connectedView?.classList.remove("hidden");
          disconnectedView?.classList.add("hidden");
          const activeInput = document.getElementById("collab-active-room-id");
          if (activeInput) activeInput.value = roomId;

          setTimeout(() => collabModal.classList.add("hidden"), 300);
          showNotification(i18n.t("notif_session_joined", { room: roomId }), "info");
        } else if (status === 'error') {
          statusEl?.classList.add("status-error");
          if (statusText) statusText.textContent = `Errore di connessione: ${errDetail || 'impossibile connettersi'}`;
        }
        btn.disabled = false;
      },
      onError: (err) => {
        btn.disabled = false;
        statusEl?.classList.add("status-error");
        if (statusText) statusText.textContent = `Errore: ${err.message}`;
      },
      showNotification: showNotification
    });

    if (!ok) {
      btn.disabled = false;
    }
  };

  document.getElementById("btn-collab-leave").onclick = () => {
    getCollabModule().leaveCollaboration();
    collabStatusPill.classList.add("hidden");
    btnCollab?.classList.remove("active-collab");
    collabModal.classList.add("hidden");
    showNotification(i18n.t("notif_session_ended"), "info");
  };

  // Wire up Collab Settings tab controls
  const sigTextarea = document.getElementById("settings-collab-signaling");
  const iceTextarea = document.getElementById("settings-collab-ice");
  if (sigTextarea) {
    const saved = localStorage.getItem("lack-collab-signaling");
    sigTextarea.value = saved || getCollabModule().DEFAULT_SIGNALING_SERVERS.join("\n");
    sigTextarea.addEventListener("change", () => {
      localStorage.setItem("lack-collab-signaling", sigTextarea.value);
    });
  }
  if (iceTextarea) {
    const saved = localStorage.getItem("lack-collab-ice");
    iceTextarea.value = saved || JSON.stringify(getCollabModule().DEFAULT_ICE_SERVERS, null, 2);
    iceTextarea.addEventListener("change", () => {
      localStorage.setItem("lack-collab-ice", iceTextarea.value);
    });
  }

  document.getElementById("btn-test-collab-signaling")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("collab-test-status");
    const resultsEl = document.getElementById("collab-test-results");
    const btn = document.getElementById("btn-test-collab-signaling");
    if (!statusEl || !resultsEl) return;

    btn.disabled = true;
    statusEl.textContent = i18n.t("collab_testing");
    statusEl.style.color = "var(--fg)";
    resultsEl.innerHTML = "";

    const servers = getCollabSignalingConfig() || getCollabModule().DEFAULT_SIGNALING_SERVERS;
    const results = await getCollabModule().pingSignalingServers(servers);

    let html = "";
    let okCount = 0;
    for (const res of results) {
      if (res.ok) {
        okCount++;
        html += `<div style="color: #10b981; margin: 2px 0;">✓ ${res.url} (${res.latency}ms)</div>`;
      } else {
        html += `<div style="color: #ef4444; margin: 2px 0;">✕ ${res.url}: ${res.error}</div>`;
      }
    }
    resultsEl.innerHTML = html;
    statusEl.textContent = `${okCount}/${results.length} server raggiungibili`;
    statusEl.style.color = okCount > 0 ? "#10b981" : "#ef4444";
    btn.disabled = false;
  });

  // ====== SETTINGS MODAL ======
  const settingsModal = document.getElementById("settings-modal");
  function updateSettingsZoomDisplay() {
    const zoomDisp = document.getElementById("settings-zoom-display");
    if (zoomDisp) {
      zoomDisp.textContent = `${Math.round(currentZoomLevel * 100)}%`;
    }
  }

  function applyUiZoom(targetLevel) {
    currentZoomLevel = Math.max(0.5, Math.min(2.5, Math.round(targetLevel * 10) / 10));
    webFrame.setZoomFactor(currentZoomLevel);
    updateSettingsZoomDisplay();
    showNotification(`Zoom: ${Math.round(currentZoomLevel * 100)}%`, "info", { replaceKey: "ui-zoom" });
  }

  function applyWindowControlsStyle(style) {
    document.body.classList.remove('win-ctrl-ubuntu', 'win-ctrl-mac', 'win-ctrl-win');
    document.body.classList.add(`win-ctrl-${style}`);
    localStorage.setItem('lack.windowControlsStyle', style);
    document.querySelectorAll('#win-controls-segmented button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.controlsStyle === style);
    });
  }

  const savedControlsStyle = localStorage.getItem('lack.windowControlsStyle') || (process.platform === 'linux' ? 'ubuntu' : 'win');
  applyWindowControlsStyle(savedControlsStyle);

  document.querySelectorAll('#win-controls-segmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.controlsStyle;
      if (style) applyWindowControlsStyle(style);
    });
  });

  document.getElementById("btn-options").onclick = () => {
    settingsModal.classList.remove("hidden");
    updateSettingsZoomDisplay();
    const currTheme = config.theme || 'light';
    document.querySelectorAll("#theme-segmented button").forEach(b => {
      b.classList.toggle("active", b.dataset.theme === currTheme);
    });
    const currLang = i18n.currentLocale || 'it';
    document.getElementById("lang-btn-it")?.classList.toggle("active", currLang === 'it');
    document.getElementById("lang-btn-en")?.classList.toggle("active", currLang === 'en');
    const currCtrl = localStorage.getItem('lack.windowControlsStyle') || (process.platform === 'linux' ? 'ubuntu' : 'win');
    document.querySelectorAll('#win-controls-segmented button').forEach(b => {
      b.classList.toggle('active', b.dataset.controlsStyle === currCtrl);
    });
  };
  document.getElementById("btn-close-settings").onclick = () => settingsModal.classList.add("hidden");
  document.getElementById("modal-overlay").onclick = () => settingsModal.classList.add("hidden");

  // Zoom controls in Settings modal
  document.getElementById("btn-zoom-in")?.addEventListener("click", () => applyUiZoom(currentZoomLevel + 0.1));
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => applyUiZoom(currentZoomLevel - 0.1));
  document.getElementById("btn-zoom-reset")?.addEventListener("click", () => applyUiZoom(1.0));

  // Tab indentation size
  const inputTabSize = document.getElementById("input-tab-size");
  if (inputTabSize) {
    const savedTabSize = parseInt(localStorage.getItem("lack-tabSize") || "2", 10);
    inputTabSize.value = savedTabSize;
    inputTabSize.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (val >= 2 && val <= 8) {
        localStorage.setItem("lack-tabSize", String(val));
      }
    });
  }

  document.querySelectorAll(".settings-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".settings-nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".settings-tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPane = document.getElementById(`pane-settings-${btn.dataset.settingsTab}`);
      if (targetPane) targetPane.classList.add("active");

      if (btn.dataset.settingsTab === "projects") {
        ipcRenderer.invoke('project-get-store-root').then(storeRoot => {
          const storeInput = document.getElementById("input-store-root");
          if (storeInput) storeInput.value = storeRoot;
        }).catch(() => {});
      }
    });
  });

  document.getElementById("btn-browse-store-root")?.addEventListener("click", async () => {
    const res = await dialog.showOpenDialog({
      title: "Seleziona Cartella Archivio Progetti",
      properties: ["openDirectory", "createDirectory"]
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const newRoot = res.filePaths[0];
      await ipcRenderer.invoke('project-set-store-root', newRoot);
      const storeInput = document.getElementById("input-store-root");
      if (storeInput) storeInput.value = newRoot;
      showNotification("Cartella archivio progetti aggiornata!", "info");
    }
  });

  const toggleEmbedSnapshot = document.getElementById("toggle-embed-snapshot-default");
  if (toggleEmbedSnapshot) {
    toggleEmbedSnapshot.checked = config.embedSnapshotDefault;
    toggleEmbedSnapshot.addEventListener("change", (e) => {
      config.embedSnapshotDefault = e.target.checked;
      localStorage.setItem("lack-embedSnapshotDefault", config.embedSnapshotDefault);
      showNotification(`Istantanee sorgenti incorporate nei PDF: ${config.embedSnapshotDefault ? 'Attive' : 'Disattivate'}`, "info");
    });
  }

  function applyTheme(theme) {
    config.theme = theme;
    localStorage.setItem("lack-theme", theme);
    document.documentElement.classList.remove("dark", "theme-github");
    document.body.classList.remove("dark", "theme-github");

    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.body.classList.add("dark");
    } else if (theme === "github") {
      document.documentElement.classList.add("dark", "theme-github");
      document.body.classList.add("dark", "theme-github");
    }

    if (cm && typeof cm.setTheme === "function") {
      cm.setTheme(theme);
    }

    document.querySelectorAll("#theme-segmented button").forEach(b => {
      b.classList.toggle("active", b.dataset.theme === theme);
    });
  }

  function cycleTheme() {
    const cycle = { light: 'dark', dark: 'github', github: 'light' };
    const nextTheme = cycle[config.theme] || 'dark';
    applyTheme(nextTheme);
  }

  window.cycleTheme = cycleTheme;
  window.applyTheme = applyTheme;

  document.getElementById("theme-btn-light").onclick = () => applyTheme("light");
  document.getElementById("theme-btn-dark").onclick = () => applyTheme("dark");
  document.getElementById("theme-btn-github").onclick = () => applyTheme("github");

  // Language settings
  document.getElementById("lang-btn-it").onclick = () => {
    i18n.setLanguage("it");
    ipcRenderer.send("app-language-changed", "it");
    document.getElementById("footer-lang-display").textContent = "IT";
    document.getElementById("lang-btn-it").classList.add("active");
    document.getElementById("lang-btn-en").classList.remove("active");
  };
  document.getElementById("lang-btn-en").onclick = () => {
    i18n.setLanguage("en");
    ipcRenderer.send("app-language-changed", "en");
    document.getElementById("footer-lang-display").textContent = "EN";
    document.getElementById("lang-btn-en").classList.add("active");
    document.getElementById("lang-btn-it").classList.remove("active");
  };

  // Font size
  document.getElementById("input-font-size").value = config.fontSize;
  document.getElementById("input-font-size").addEventListener("change", (e) => {
    config.fontSize = parseInt(e.target.value, 10);
    localStorage.setItem("lack-fontSize", config.fontSize);
    editorMount.style.fontSize = `${config.fontSize}px`;
  });

  // Compiler settings
  const selectEngine = document.getElementById("select-tex-engine");
  selectEngine.value = config.engine;
  selectEngine.addEventListener("change", (e) => {
    config.engine = e.target.value;
    localStorage.setItem("lack-engine", config.engine);
    updateEngineFooter();
  });

  const toggleAutoCompileEl = document.getElementById("toggle-autocompile");
  if (toggleAutoCompileEl) {
    toggleAutoCompileEl.checked = config.autoCompile;
    toggleAutoCompileEl.addEventListener("change", (e) => {
      config.autoCompile = e.target.checked;
      localStorage.setItem("lack-autoCompile", config.autoCompile);
      if (checkAutoCompile) checkAutoCompile.checked = config.autoCompile;
      updateAutoCompileMenuLabel();
    });
  }

  const toggleCleanAuxEl = document.getElementById("toggle-clean-aux");
  if (toggleCleanAuxEl) {
    toggleCleanAuxEl.checked = config.cleanAux;
    toggleCleanAuxEl.addEventListener("change", (e) => {
      config.cleanAux = e.target.checked;
      localStorage.setItem("lack-cleanAux", config.cleanAux);
    });
  }

  // Spell checker footer indicator & language toggler
  const footerLangEl = document.getElementById("footer-lang-display");
  function updateSpellFooterLabel() {
    if (!footerLangEl) return;
    const l = config.spellLanguage;
    footerLangEl.textContent = l === 'it+en' ? 'IT+EN' : l === 'it' ? 'IT' : l === 'en' ? 'EN' : 'OFF';
  }
  updateSpellFooterLabel();

  if (footerLangEl) {
    footerLangEl.style.cursor = 'pointer';
    footerLangEl.title = 'Correttore ortografico (clicca per cambiare: IT+EN, IT, EN, OFF)';
    footerLangEl.addEventListener("click", () => {
      const order = ['it+en', 'it', 'en', 'none'];
      const nextIdx = (order.indexOf(config.spellLanguage) + 1) % order.length;
      config.spellLanguage = order[nextIdx];
      localStorage.setItem('lack-spellLanguage', config.spellLanguage);
      editorLib.setSpellLanguage(config.spellLanguage, __dirname);
      updateSpellFooterLabel();
      showNotification(`Correttore ortografico: ${footerLangEl.textContent}`, "info");
    });
  }

  // ====== GLOBAL KEYBOARD SHORTCUTS ======
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (searchContainer && !searchContainer.classList.contains("hidden")) {
        closeDocumentSearch();
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (e.shiftKey) {
          openProjectSearch();
        } else {
          openDocumentSearch();
        }
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        newFile();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        if (e.shiftKey) saveFileAs();
        else saveFile();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        if (e.shiftKey) openFolderDialog();
        else openFileDialog();
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      } else if (e.key === "m" || e.key === "M") {
        if (!e.shiftKey && !e.altKey) {
          e.preventDefault();
          cycleTheme();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        triggerCompile(false);
      } else if (e.key === "u" || e.key === "U") {
        if (e.shiftKey) {
          e.preventDefault();
          logsDrawer.classList.toggle("hidden");
        }
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        if (e.shiftKey) {
          openSaveTemplateModal();
        } else {
          openTemplateGallery();
        }
      } else if (e.key === "Escape") {
        if (saveTemplateModal && !saveTemplateModal.classList.contains("hidden")) {
          closeSaveTemplateModal();
        } else if (templateModal && !templateModal.classList.contains("hidden")) {
          templateModal.classList.add("hidden");
        }
      } else if (e.key === ",") {
        e.preventDefault();
        settingsModal.classList.remove("hidden");
      }
    }
  });

  // ====== IPC SHORTCUTS & MENU LISTENERS ======
  ipcRenderer.on("open-search", () => openDocumentSearch());
  ipcRenderer.on("open-project-search", () => openProjectSearch());
  ipcRenderer.on("new-file", () => newFile());
  ipcRenderer.on("trigger-save", () => saveFile());
  ipcRenderer.on("trigger-compile", () => triggerCompile(false));
  ipcRenderer.on("recompile-from-scratch", () => {
    cleanAuxiliaryFiles();
    triggerCompile(false);
  });
  ipcRenderer.on("stop-compile", async () => {
    await ipcRenderer.invoke('stop-compilation');
    isCompiling = false;
    btnRecompile.classList.remove("compiling");
    showNotification("Compilazione interrotta", "info");
  });
  ipcRenderer.on("toggle-logs", () => logsDrawer.classList.toggle("hidden"));
  ipcRenderer.on("choose-template", () => openTemplateGallery());
  ipcRenderer.on("open-settings", () => settingsModal.classList.remove("hidden"));
  ipcRenderer.on("set-view-editor", () => setViewMode("solo-editor"));
  ipcRenderer.on("set-view-split", () => setViewMode("split-view"));
  ipcRenderer.on("set-view-preview", () => setViewMode("solo-preview"));
  ipcRenderer.on("toggle-outline", () => {
    document.getElementById("sidebar-tab-outline")?.click();
  });
  ipcRenderer.on("close-active-tab", () => {
    if (activeTabId) closeTab(activeTabId);
  });
  ipcRenderer.on("show-start-screen", () => {
    if (tabs.length === 0) {
      renderTabs();
    }
  });
  ipcRenderer.on("bind-buffer", (_e, { filePath, createOnSave }) => {
    const existing = filePath ? tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(filePath)) : null;
    if (existing) {
      switchTab(existing.id);
    } else {
      createTab(path.basename(filePath), "", filePath);
      const tab = tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(filePath));
      if (tab && createOnSave) {
        tab.createOnSave = true;
      }
    }
  });
  ipcRenderer.on("prompt-convert-folder-to-project", async (_e, { folderPath }) => {
    if (!folderPath || !fs.existsSync(folderPath)) return;
    const isDeclined = await ipcRenderer.invoke('project-is-folder-declined', folderPath);
    if (isDeclined) return;

    const scan = await ipcRenderer.invoke('project-scan-folder', folderPath);
    if (!scan || !scan.texFiles || scan.texFiles.length === 0) return;

    const mainCandidate = scan.candidateMain || scan.texFiles[0];
    const folderName = path.basename(folderPath);

    const answer = await showCustomConfirmDialog({
      title: "Converti cartella in Progetto Lack",
      message: `La cartella "${folderName}" contiene ${scan.texFiles.length} file LaTeX (documento principale rilevato: "${mainCandidate}").\n\nVuoi che questi file diventino il tuo Progetto Lack collegato?\nI file sorgente verranno organizzati nell'ambiente di lavoro Lack e verrà creato automaticamente il PDF nella cartella.`,
      buttons: [
        { text: "Non chiedere più per questa cartella", value: "decline", isCancel: true },
        { text: "No, mantieni file singoli", value: "no", isCancel: true },
        { text: "Sì, converti in Progetto", value: "yes", isPrimary: true }
      ]
    });

    if (answer === "decline") {
      await ipcRenderer.invoke('project-decline-folder', folderPath);
      return;
    }

    if (answer === "yes") {
      try {
        const res = await ipcRenderer.invoke('project-convert-folder', {
          folderPath,
          mainFileName: mainCandidate,
          projectTitle: folderName
        });

        if (res.collided) {
          showNotification(`Attenzione: un file PDF esisteva già. È stato creato "${path.basename(res.targetPath)}".`, "warning");
        }

        // Migrate any open tabs from folderPath to their new destination in storePath
        for (const tab of tabs) {
          if (tab.filePath && isPathInsideDir(tab.filePath, folderPath)) {
            const rel = path.relative(folderPath, tab.filePath);
            const newStorePath = path.join(res.storePath, rel);
            if (fs.existsSync(newStorePath)) {
              for (const [watchPath, watcher] of Array.from(activeFileWatchers.entries())) {
                if (path.resolve(watchPath) === path.resolve(tab.filePath)) {
                  try { watcher.close(); } catch (_) {}
                  activeFileWatchers.delete(watchPath);
                }
              }
              tab.filePath = newStorePath;
              watchFileForChanges(newStorePath);
            }
          }
        }

        await openLinkedProject({
          projectId: res.id,
          name: res.name,
          storePath: res.storePath,
          targetPath: res.targetPath,
          mainFile: res.main,
          compileImmediate: false
        });

        await triggerCompile(false);

        if (res.journalPath) {
          showNotificationWithAction(
            `Cartella "${folderName}" convertita in progetto collegato!`,
            "Annulla",
            async () => {
              const undoRes = await ipcRenderer.invoke('project-undo-move', res.journalPath);
              if (undoRes.success) {
                showNotification(`Ripristinati ${undoRes.count} file nella cartella`, "info");
                closeLinkedProject();
                renderFolderPane(folderPath);
              } else {
                showNotification("Errore ripristino: " + undoRes.error, "error");
              }
            },
            "info"
          );
        }
      } catch (convErr) {
        showNotification("Errore durante la conversione: " + convErr.message, "error");
      }
    }
  });
  ipcRenderer.on("load-tex", (_e, filePath, content) => {
    const existing = filePath ? tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(filePath)) : null;
    if (existing) {
      switchTab(existing.id);
    } else if (filePath && fs.existsSync(filePath)) {
      openFileFromPath(filePath);
    } else {
      createTab(path.basename(filePath || "untitled.tex"), content || "", filePath || null);
    }
  });
  ipcRenderer.on("open-folder", (_e, folderPath) => openFolder(folderPath));
  ipcRenderer.on("open-linked-project", (_e, payload) => {
    openLinkedProject(payload);
  });
  ipcRenderer.on("prompt-claim-pdf", (_e, payload) => {
    promptClaimPdf(payload);
  });
  ipcRenderer.on("prompt-relink-or-restore", (_e, payload) => {
    promptRelinkOrRestore(payload);
  });
  ipcRenderer.on("prompt-convert-tex-to-project", async (_e, { texPath }) => {
    if (!texPath || !fs.existsSync(texPath)) return;
    const resolvedTex = path.resolve(texPath);
    const baseName = path.basename(texPath, ".tex");
    const folderDir = path.dirname(texPath);

    const answer = await showCustomConfirmDialog({
      title: "Converti in Progetto LaTeX",
      message: `Vuoi convertire "${path.basename(texPath)}" in un progetto Lack collegato?\n\nIl file sorgente verrà spostato nello store dei progetti Lack e nella cartella corrente resterà solo il documento PDF "${baseName}.pdf".`,
      buttons: [
        { text: "No, mantieni file singolo", value: "no", isCancel: true },
        { text: "Sì, converti in Progetto", value: "yes", isPrimary: true }
      ]
    });

    if (answer === "yes") {
      try {
        saveActiveTabState();
        const matchingTabs = tabs.filter(t => t.filePath && path.resolve(t.filePath) === resolvedTex);
        const content = matchingTabs.length > 0
          ? matchingTabs[0].content
          : fs.readFileSync(texPath, "utf8");

        const targetPdfPath = path.join(folderDir, `${baseName}.pdf`);
        const created = await ipcRenderer.invoke("project-create", {
          name: baseName,
          targetPath: targetPdfPath,
          templateContent: content
        });

        const mainTexInStore = path.join(created.storePath, created.manifest.main);

        // Stop watching the original .tex before moving it out of folderDir
        for (const [watchPath, watcher] of Array.from(activeFileWatchers.entries())) {
          if (path.resolve(watchPath) === resolvedTex) {
            try { watcher.close(); } catch (_) {}
            activeFileWatchers.delete(watchPath);
          }
        }

        // Remove original .tex from folderDir so only the compiled PDF remains in CARTELLA
        if (fs.existsSync(mainTexInStore) && fs.existsSync(texPath)) {
          await fs.promises.unlink(texPath);
        }

        // Migrate existing open tab in-place to the moved store .tex file (close any duplicate tabs)
        if (matchingTabs.length > 0) {
          const primaryTab = matchingTabs[0];
          primaryTab.filePath = mainTexInStore;
          primaryTab.title = created.manifest.main;
          primaryTab.content = content;
          primaryTab.savedContent = content;
          updateTabDirty(primaryTab.id, false);
          saveFileHistorySnapshot(mainTexInStore, content);
          watchFileForChanges(mainTexInStore);

          for (let i = 1; i < matchingTabs.length; i++) {
            matchingTabs[i].dirty = false;
            closeTab(matchingTabs[i].id);
          }
          renderTabs();
        }

        showNotification(`File "${path.basename(texPath)}" spostato nello store del progetto!`, "info");
        await openLinkedProject({
          projectId: created.id,
          name: created.manifest.name,
          storePath: created.storePath,
          targetPath: targetPdfPath,
          mainFile: created.manifest.main,
          compileImmediate: false
        });
        await triggerCompile(false);
      } catch (err) {
        showNotification("Errore conversione progetto: " + err.message, "error");
      }
    }
  });
  ipcRenderer.on("menu-new-project", () => {
    openNewProjectModal();
  });
  ipcRenderer.on("open-projects-manager", () => {
    openProjectsManager();
  });
  ipcRenderer.on("menu-export-project", () => {
    openExportModal();
  });
  ipcRenderer.on("toggle-compile-on-save", () => {
    config.compileOnSave = !config.compileOnSave;
    localStorage.setItem("lack-compileOnSave", config.compileOnSave);
    updateCompileOnSaveMenuLabel();
    showNotification(`Compila al salvataggio (Ctrl+S): ${config.compileOnSave ? 'Attivo' : 'Disattivato'}`, "info");
  });
  // Contextual zoom handling (PDF viewer when hovering preview, UI otherwise)
  let isMouseOverPreview = false;
  const previewContainer = document.getElementById("preview-container");
  if (previewContainer) {
    previewContainer.addEventListener("mouseenter", () => { isMouseOverPreview = true; });
    previewContainer.addEventListener("mouseleave", () => { isMouseOverPreview = false; });
  }

  function handleZoomIn() {
    if (isMouseOverPreview && typeof pdfViewer.zoomIn === "function") {
      pdfViewer.zoomIn();
    } else {
      applyUiZoom(currentZoomLevel + 0.1);
    }
  }

  function handleZoomOut() {
    if (isMouseOverPreview && typeof pdfViewer.zoomOut === "function") {
      pdfViewer.zoomOut();
    } else {
      applyUiZoom(currentZoomLevel - 0.1);
    }
  }

  function handleZoomReset() {
    if (isMouseOverPreview && typeof pdfViewer.resetZoom === "function") {
      pdfViewer.resetZoom();
    } else {
      applyUiZoom(1.0);
    }
  }

  ipcRenderer.on("zoom-in", handleZoomIn);
  ipcRenderer.on("zoom-out", handleZoomOut);
  ipcRenderer.on("zoom-reset", handleZoomReset);

  window.addEventListener("keydown", (e) => {
    const isCtrlOrCmd = process.platform === "darwin" ? e.metaKey : e.ctrlKey;
    if (!isCtrlOrCmd || e.altKey) return;

    if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd" || (e.shiftKey && e.code === "Equal")) {
      e.preventDefault();
      handleZoomIn();
    } else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" || e.code === "Minus") {
      e.preventDefault();
      handleZoomOut();
    } else if (e.key === "0" || e.code === "Numpad0" || e.code === "Digit0") {
      e.preventDefault();
      handleZoomReset();
    }
  }, true);

  window.addEventListener("wheel", (e) => {
    const isCtrlOrCmd = process.platform === "darwin" ? e.metaKey : e.ctrlKey;
    if (isCtrlOrCmd) {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleZoomIn();
      } else if (e.deltaY > 0) {
        handleZoomOut();
      }
    }
  }, { passive: false });
  ipcRenderer.on("toggle-theme", () => cycleTheme());
  ipcRenderer.on("open-install-guide", () => {
    const cmd = latexCompiler.getInstallCommand();
    clipboard.writeText(cmd);
    showNotification(`Comando di installazione TeX copiato negli appunti: ${cmd}`, "info");
  });
  ipcRenderer.on("open-about", () => {
    let appVersion = "1.1.2";
    try { appVersion = require("./package.json").version; } catch (_) {}
    showNotification(`Lack - Editor LaTeX Professionale v${appVersion}`, "info");
  });

  // Empty state buttons
  document.getElementById("empty-btn-new-file")?.addEventListener("click", () => newFile());
  document.getElementById("empty-btn-open-file")?.addEventListener("click", () => openFileDialog());
  document.getElementById("empty-btn-open-folder")?.addEventListener("click", () => openFolderDialog());
  document.getElementById("empty-btn-templates")?.addEventListener("click", () => openTemplateGallery());
  document.getElementById("btn-new-tab")?.addEventListener("click", () => newFile());

  // Exposed for tests and external triggers
  window.__lackNewFile = newFile;
  window.__lackSaveFile = saveFile;
  window.__lackGetActiveTab = getActiveTab;
  window.__lackOpenLinkedProject = openLinkedProject;
  window.__lackOpenSaveTemplateModal = openSaveTemplateModal;
  window.__lackOpenEditTemplateModal = openEditTemplateModal;
  window.__lackCloseSaveTemplateModal = closeSaveTemplateModal;
  window.__lackHandleDeleteTemplate = handleDeleteTemplate;
  window.__lackOpenTemplateGallery = openTemplateGallery;
  window.__lackPdfViewer = pdfViewer;
  window.__lackOpenDocumentSearch = openDocumentSearch;
  window.__lackCloseDocumentSearch = closeDocumentSearch;
  window.__lackOpenProjectSearch = openProjectSearch;
  window.__lackExecuteProjectSearch = executeProjectSearch;

  // Initial state: show start screen if no tabs opened
  renderTabs();
});
