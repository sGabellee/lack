// ====== LACK RENDERER PROCESS ======
const i18n = require("./i18n.js");
const { ipcRenderer, webFrame } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
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
const {
  startCollaboration,
  leaveCollaboration,
  generateRoomId,
  getCollabState
} = require("./collaboration.js");

const LackTemplates = (typeof window !== 'undefined' && window.LackTemplates) || (typeof require === 'function' ? require('./templates.js') : null);
const latexCompiler = require("./latex-compiler.js");
const {
  formatBytes,
  calculateDirSize,
  isCompilableLatexFile,
  filterProjectEntries,
  validateItemName
} = require("./src/projects/ui-controller.js");

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
function getOrCreateNotificationContainer() {
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    document.body.appendChild(container);
  }
  return container;
}

function showNotification(message, type = 'info') {
  const container = getOrCreateNotificationContainer();
  const notification = document.createElement('div');
  notification.className = `cloud-notification ${type}`;
  notification.innerHTML = `<span class="cloud-notification-text">${escapeHtml(message)}</span>`;
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

  dismissTimer = setTimeout(dismiss, 4000);
  notification.addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });
  notification.addEventListener('mouseenter', () => clearTimeout(dismissTimer));
  notification.addEventListener('mouseleave', () => {
    dismissTimer = setTimeout(dismiss, 2500);
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
    viewMode: localStorage.getItem('lack-viewMode') || 'split'
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
  const projectContext = {
    getBibKeys: () => getProjectBibKeys(),
    getImageFiles: () => getProjectImageFiles(),
    getTexFiles: () => getProjectTexFiles()
  };

  const cm = editorLib.createCodeMirrorEditor(editorMount, {
    initialValue: '',
    theme: config.theme,
    onCompile: () => triggerCompile(),
    onRotateTheme: () => cycleTheme(),
    getBibKeys: projectContext.getBibKeys,
    getImageFiles: projectContext.getImageFiles,
    getTexFiles: projectContext.getTexFiles
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
          if (cleanSnippet.length > 3) {
            const idx = docText.indexOf(cleanSnippet);
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

  // ====== MULTI-FILE PROJECT CONTEXT RESOLVERS ======
  function getProjectBibKeys() {
    const keys = [];
    if (!currentProjectDir || !fs.existsSync(currentProjectDir)) return keys;
    try {
      const files = fs.readdirSync(currentProjectDir);
      for (const f of files) {
        if (f.endsWith('.bib')) {
          const content = fs.readFileSync(path.join(currentProjectDir, f), 'utf8');
          const matches = content.match(/@\w+\s*\{\s*([^,\s]+)/g);
          if (matches) {
            matches.forEach(m => {
              const k = m.replace(/@\w+\s*\{\s*/, '').trim();
              if (k) keys.push(k);
            });
          }
        }
      }
    } catch (e) {}
    return keys;
  }

  function getProjectImageFiles() {
    const images = [];
    if (!currentProjectDir || !fs.existsSync(currentProjectDir)) return images;
    try {
      const scan = (dir, prefix = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'build') continue;
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          if (ent.isDirectory()) {
            scan(path.join(dir, ent.name), rel);
          } else if (/\.(png|jpe?g|pdf|eps|svg)$/i.test(ent.name)) {
            images.push(rel);
          }
        }
      };
      scan(currentProjectDir);
    } catch (e) {}
    return images;
  }

  function getProjectTexFiles() {
    const texFiles = [];
    if (!currentProjectDir || !fs.existsSync(currentProjectDir)) return texFiles;
    try {
      const scan = (dir, prefix = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'build') continue;
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          if (ent.isDirectory()) {
            scan(path.join(dir, ent.name), rel);
          } else if (ent.name.endsWith('.tex')) {
            texFiles.push(rel);
          }
        }
      };
      scan(currentProjectDir);
    } catch (e) {}
    return texFiles;
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
          let targetRel = m[1].trim();
          if (!path.extname(targetRel)) targetRel += '.tex';
          const activeTab = getActiveTab();
          const baseDir = currentProjectDir || (activeTab && activeTab.filePath ? path.dirname(activeTab.filePath) : null);
          if (baseDir) {
            const resolved = path.resolve(baseDir, targetRel);
            if (fs.existsSync(resolved)) {
              openFileFromPath(resolved);
              showNotification(`Aperto: ${path.basename(resolved)}`, "info");
            } else {
              showNotification(`File non trovato: ${targetRel}`, "warning");
            }
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

      tabEl.innerHTML = `
        ${isProjectFile ? '<span class="tab-link-badge" title="File del progetto collegato"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -1px;"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></span>' : ''}
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

    if (filePath && !mainDocumentPath && filePath.endsWith(".tex")) {
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

  function showTabContextMenu(e, tab) {
    const existing = document.getElementById("tab-context-menu");
    if (existing) existing.remove();

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

    const menuWidth = 230;
    const menuHeight = 270;
    const left = Math.max(10, Math.min(e.clientX, window.innerWidth - menuWidth - 10));
    const top = Math.max(10, Math.min(e.clientY, window.innerHeight - menuHeight - 10));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

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

    if (!targetTab.filePath) {
      const result = await dialog.showSaveDialog({
        title: "Salva documento LaTeX",
        defaultPath: targetTab.title,
        filters: [{ name: "LaTeX Document", extensions: ["tex"] }]
      });
      if (result.canceled || !result.filePath) return false;
      targetTab.filePath = result.filePath;
      targetTab.title = path.basename(result.filePath);
      if (!currentProjectDir) {
        currentProjectDir = path.dirname(result.filePath);
      }
      if (!mainDocumentPath) {
        setMainDocument(result.filePath);
      }
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
    if (!tab) return;
    saveActiveTabState();

    const result = await dialog.showSaveDialog({
      title: "Salva come...",
      defaultPath: tab.title,
      filters: [{ name: "LaTeX Document", extensions: ["tex"] }]
    });
    if (result.canceled || !result.filePath) return;

    tab.filePath = result.filePath;
    tab.title = path.basename(result.filePath);
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
  function setMainDocument(filePath) {
    mainDocumentPath = filePath;
    currentProjectDir = path.dirname(filePath);
    footerMainDoc.textContent = `Principale: ${path.basename(filePath)}`;
    showNotification(`Documento principale impostato: ${path.basename(filePath)}`, "info");
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
      showNotification("I progetti collegati richiedono un motore TeX reale (pdfLaTeX, Tectonic, XeLaTeX)", "warning");
      return;
    }

    isCompiling = true;
    btnRecompile.classList.add("compiling");

    let targetPath = mainDocumentPath || (tab ? tab.filePath : null);
    let contentToPass = cm ? cm.getValue() : (tab ? tab.content : "");

    const workDir = isLinkedProject && currentProject ? currentProject.storePath : currentProjectDir;
    const outputDir = isLinkedProject && currentProject ? path.join(currentProject.storePath, '.lack', 'build') : null;

    const compileOpts = {
      filePath: targetPath,
      content: contentToPass,
      projectDir: workDir,
      outputDir: outputDir,
      engine: config.engine,
      customEnginePath: config.customEnginePath,
      cleanAux: config.cleanAux,
      isMemoryBuffer: true // Compile in-memory buffer without overwriting disk file
    };

    try {
      const res = await ipcRenderer.invoke('compile-latex', compileOpts);
      isCompiling = false;
      btnRecompile.classList.remove("compiling");

      latestIssues = res.issues || [];
      renderLogIssues(latestIssues, res.log);

      if (res.success && res.pdfPath && fs.existsSync(res.pdfPath)) {
        currentCompiledPdfPath = res.pdfPath;
        pdfEmptyPlaceholder.classList.add("hidden");
        livePreviewEl.classList.add("hidden");
        pdfCanvasContainer.classList.remove("hidden");

        await pdfViewer.loadPdfDocument(res.pdfPath);

        // If linked project, post-process atomically to target PDF
        if (isLinkedProject && currentProject && currentProject.targetPath) {
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
        pdfEmptyPlaceholder.classList.add("hidden");
        pdfCanvasContainer.classList.add("hidden");
        livePreviewEl.classList.remove("hidden");
        renderBuiltinPreview(res.htmlPreview);

        if (!isAuto) {
          showNotification("Anteprima renderizzata con successo", "info");
        }
      } else {
        if (!isAuto) {
          showNotification(i18n.t("notif_compiled_fail"), "error");
          logsDrawer.classList.remove("hidden");
        }
      }
    } catch (err) {
      isCompiling = false;
      btnRecompile.classList.remove("compiling");
      if (!isAuto) {
        showNotification("Errore di compilazione: " + err.message, "error");
      }
    }
  }

  btnRecompile.onclick = () => triggerCompile(false);
  document.getElementById("btn-placeholder-compile")?.addEventListener("click", () => triggerCompile(false));

  function renderBuiltinPreview(htmlContent) {
    livePreviewEl.innerHTML = htmlContent;
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
  function renderLogIssues(issues, rawLog) {
    logsIssuesList.innerHTML = "";
    logsRawText.textContent = rawLog || "";

    const errors = issues.filter(i => i.type === "error");
    const warnings = issues.filter(i => i.type === "warning");

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
      const item = document.createElement("div");
      item.className = `log-issue-item ${iss.type}`;

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

      item.innerHTML = `
        <div class="log-issue-header">
          <span class="log-issue-badge ${iss.type}">${iss.type.toUpperCase()}</span>
          <span class="log-issue-file">${escapeHtml(iss.file || "main.tex")}:${iss.line}</span>
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
    logsIssuesList.innerHTML = `<div style="padding:16px; color:#888888; text-align:center;">${i18n.t("logs_no_issues")}</div>`;
    logsRawText.textContent = "";
    badgeErrors.classList.add("hidden");
    badgeWarnings.classList.add("hidden");
    document.getElementById("drawer-issues-count").textContent = "0";
    if (cm) cm.clearErrorHighlight();
  };

  document.getElementById("tab-log-issues").onclick = () => {
    document.getElementById("tab-log-issues").classList.add("active");
    document.getElementById("tab-log-raw").classList.remove("active");
    document.getElementById("logs-issues-pane").classList.add("active");
    document.getElementById("logs-raw-pane").classList.remove("active");
  };

  document.getElementById("tab-log-raw").onclick = () => {
    document.getElementById("tab-log-raw").classList.add("active");
    document.getElementById("tab-log-issues").classList.remove("active");
    document.getElementById("logs-raw-pane").classList.add("active");
    document.getElementById("logs-issues-pane").classList.remove("active");
  };

  async function cleanAuxiliaryFiles() {
    const removed = latexCompiler.cleanAuxiliaryFiles(currentProjectDir, null);
    showNotification(`File ausiliari puliti: ${removed} file rimossi.`, "info");
  }

  async function downloadPdf() {
    if (!currentCompiledPdfPath || !fs.existsSync(currentCompiledPdfPath)) {
      showNotification("Nessun PDF compilato disponibile per il download. Compila prima il documento.", "warning");
      return;
    }

    const defaultName = path.basename(currentCompiledPdfPath);
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
    currentProjectDir = folderPath;
    if (folderPathEl) {
      folderPathEl.textContent = path.basename(folderPath);
      folderPathEl.classList.remove("hidden");
    }

    // Check for main.tex in folder
    const defaultMain = path.join(folderPath, "main.tex");
    if (fs.existsSync(defaultMain)) {
      setMainDocument(defaultMain);
      openFileFromPath(defaultMain);
    }

    renderFolderPane(folderPath);
  }

  function renderFileTree(dir) {
    renderFolderPane(dir);
  }

  async function openLinkedProject(opts) {
    // opts: { projectId, name, storePath, targetPath, compileImmediate }
    isLinkedProject = true;
    currentProject = {
      projectId: opts.projectId,
      name: opts.name,
      storePath: opts.storePath,
      targetPath: opts.targetPath
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

    projectPane?.classList.remove("hidden");
    sidebarSplitter?.classList.remove("hidden");
    footerProjectChip?.classList.remove("hidden");
    if (footerProjectName) footerProjectName.textContent = opts.name;
    if (projectPaneName) projectPaneName.textContent = opts.name;

    updateTitle();

    // Folder pane = folder of target PDF
    const folderDir = path.dirname(opts.targetPath);
    currentProjectDir = folderDir;
    if (folderPathEl) {
      folderPathEl.textContent = path.basename(folderDir);
      folderPathEl.classList.remove("hidden");
    }
    renderFolderPane(folderDir);

    // Project pane = storePath
    renderProjectPane(opts.storePath);

    // Set main document to main.tex in store
    const mainTex = path.join(opts.storePath, "main.tex");
    if (fs.existsSync(mainTex)) {
      setMainDocument(mainTex);
      openFileFromPath(mainTex);
    }

    if (opts.compileImmediate) {
      triggerCompile(false);
    } else if (opts.targetPath && fs.existsSync(opts.targetPath)) {
      pdfViewer.loadPdfDocument(opts.targetPath);
    }

    startTargetPdfWatcher(opts.targetPath);
  }

  function closeLinkedProject() {
    if (currentProject && currentProject.storePath) {
      ipcRenderer.invoke('project-release-lock', currentProject.storePath);
    }
    if (targetPdfWatcher) {
      try { targetPdfWatcher.close(); } catch (_) {}
      targetPdfWatcher = null;
    }
    isLinkedProject = false;
    currentProject = null;
    projectPane?.classList.add("hidden");
    sidebarSplitter?.classList.add("hidden");
    footerProjectChip?.classList.add("hidden");
    updateTitle();
    if (currentProjectDir) renderFolderPane(currentProjectDir);
  }

  function renderFolderPane(dir) {
    const targetContainer = folderTreeEl || fileTreeLegacy;
    if (!targetContainer) return;
    targetContainer.innerHTML = "";
    if (!dir || !fs.existsSync(dir)) {
      targetContainer.innerHTML = `<div style="padding: 16px; font-size: 11.5px; opacity: 0.6; text-align: center;">Nessuna cartella aperta</div>`;
      return;
    }

    const rootUl = document.createElement("ul");
    rootUl.className = "tree-root";
    buildFolderTreeRecursive(dir, rootUl);
    targetContainer.appendChild(rootUl);
  }

  function buildFolderTreeRecursive(dir, parentElement) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    entries = filterProjectEntries(entries);

    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : Boolean(entry.isDirectory);

      const li = document.createElement("li");
      li.className = "tree-node";

      const itemDiv = document.createElement("div");
      itemDiv.className = "tree-item";
      itemDiv.title = fullPath;

      const isTargetPdf = isLinkedProject && currentProject && currentProject.targetPath && (path.resolve(fullPath) === path.resolve(currentProject.targetPath));

      if (isDir) {
        itemDiv.innerHTML = `
          <svg class="tree-chevron-icon" width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
          <span class="tree-label">${escapeHtml(entry.name)}</span>
        `;

        const childUl = document.createElement("ul");
        childUl.className = "tree-children hidden";

        itemDiv.addEventListener("click", () => {
          const chevron = itemDiv.querySelector(".tree-chevron-icon");
          const isCollapsed = childUl.classList.toggle("hidden");
          chevron.style.transform = isCollapsed ? "rotate(0deg)" : "rotate(90deg)";
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showFolderItemContextMenu(e, itemDiv, fullPath, false);
        });

        li.appendChild(itemDiv);
        li.appendChild(childUl);
        buildFolderTreeRecursive(fullPath, childUl);
      } else {
        const linkBadge = isTargetPdf ? `<span class="tree-link-badge" title="PDF collegato al progetto corrente"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 3px; vertical-align: -1px;"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>Collegato</span>` : ``;

        itemDiv.className = `tree-item ${isTargetPdf ? 'target-pdf-item' : ''}`;
        itemDiv.innerHTML = `
          <svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          <span class="tree-label">${escapeHtml(entry.name)}</span>
          ${linkBadge}
        `;

        itemDiv.addEventListener("click", () => {
          document.querySelectorAll(".tree-item").forEach(x => x.classList.remove("active"));
          itemDiv.classList.add("active");
          if (entry.name.toLowerCase().endsWith(".pdf")) {
            pdfViewer.loadPdfDocument(fullPath);
          } else {
            openFileFromPath(fullPath);
          }
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showFolderItemContextMenu(e, itemDiv, fullPath, isTargetPdf);
        });

        li.appendChild(itemDiv);
      }
      parentElement.appendChild(li);
    });
  }

  function showFolderItemContextMenu(e, itemDiv, fullPath, isTargetPdf) {
    const existing = document.getElementById("tree-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "tree-context-menu";
    menu.className = "tree-context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    let html = `
      <div class="context-menu-item" id="ctx-open">Apri</div>
      <div class="context-menu-item" id="ctx-rename">Rinomina</div>
      <div class="context-menu-item" id="ctx-reveal">Mostra nel file manager</div>
      <div class="context-menu-item" id="ctx-copy-path">Copia percorso</div>
    `;
    if (isTargetPdf) {
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

    menu.querySelector("#ctx-open").onclick = () => {
      menu.remove();
      if (fullPath.toLowerCase().endsWith(".pdf")) pdfViewer.loadPdfDocument(fullPath);
      else openFileFromPath(fullPath);
    };
    menu.querySelector("#ctx-rename").onclick = () => {
      menu.remove();
      showInlineRename(itemDiv, fullPath, () => {
        if (currentProjectDir) renderFolderPane(currentProjectDir);
      });
    };
    menu.querySelector("#ctx-reveal").onclick = () => {
      menu.remove();
      ipcRenderer.invoke('project-reveal-item', fullPath);
    };
    menu.querySelector("#ctx-copy-path").onclick = () => {
      menu.remove();
      clipboard.writeText(fullPath);
      showNotification("Percorso copiato negli appunti", "info");
    };

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

    menu.querySelector("#ctx-delete").onclick = async () => {
      menu.remove();
      const isPdf = fullPath.toLowerCase().endsWith(".pdf");
      let linkedProj = null;
      if (isPdf) {
        if (isTargetPdf && currentProject) {
          linkedProj = currentProject;
        } else {
          try {
            linkedProj = await ipcRenderer.invoke('project-find-by-target', fullPath);
          } catch (_) {}
        }
      }

      if (linkedProj) {
        const choice = await showCustomConfirmDialog({
          title: "Eliminazione PDF collegato",
          message: `Stai spostando nel cestino il file PDF "${path.basename(fullPath)}" collegato al progetto "${linkedProj.name || 'LaTeX'}".\n\nVuoi mantenere i dati sorgente del progetto archiviati (in modo da poter ricreare o duplicare il PDF in qualsiasi momento), oppure eliminare anche tutti i dati del progetto?`,
          buttons: [
            { text: "Annulla", value: 'cancel', isCancel: true },
            { text: "Mantieni sorgenti", value: 'keep_sources', isPrimary: true },
            { text: "Elimina anche dati", value: 'delete_all', isDanger: true }
          ]
        });

        if (choice === 'keep_sources') {
          await ipcRenderer.invoke('project-trash-item', fullPath);
          await ipcRenderer.invoke('project-unlink', fullPath);
          showNotification(`PDF "${path.basename(fullPath)}" spostato nel cestino. I sorgenti sono conservati nello store.`, "info");
          if (isLinkedProject && currentProject && path.resolve(currentProject.targetPath) === path.resolve(fullPath)) {
            closeLinkedProject();
          }
          if (currentProjectDir) renderFolderPane(currentProjectDir);
        } else if (choice === 'delete_all') {
          await ipcRenderer.invoke('project-trash-item', fullPath);
          if (linkedProj.storePath && fs.existsSync(linkedProj.storePath)) {
            await ipcRenderer.invoke('project-trash-item', linkedProj.storePath);
          }
          await ipcRenderer.invoke('project-unlink', fullPath);
          showNotification(`PDF e dati del progetto spostati nel cestino.`, "info");
          if (isLinkedProject && currentProject && path.resolve(currentProject.targetPath) === path.resolve(fullPath)) {
            closeLinkedProject();
          }
          if (currentProjectDir) renderFolderPane(currentProjectDir);
        }
      } else {
        const ok = await showCustomConfirmDialog({
          title: "Sposta nel cestino",
          message: `Sei sicuro di voler spostare "${path.basename(fullPath)}" nel cestino? Nessun file viene eliminato definitivamente.`
        });
        if (ok) {
          const openTab = tabs.find(t => t.filePath === fullPath);
          if (openTab) closeTab(openTab.id);
          await ipcRenderer.invoke('project-trash-item', fullPath);
          showNotification(`"${path.basename(fullPath)}" spostato nel cestino`, "info");
          if (currentProjectDir) renderFolderPane(currentProjectDir);
        }
      }
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
  }

  function buildProjectTreeRecursive(dir, parentElement) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    entries = filterProjectEntries(entries);

    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      let isSymlink = false;
      let isBroken = false;
      let isDir = false;

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

      const li = document.createElement("li");
      li.className = "tree-node";

      const itemDiv = document.createElement("div");
      itemDiv.className = "tree-item project-tree-item";
      itemDiv.title = fullPath;

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

        itemDiv.addEventListener("click", () => {
          const chevron = itemDiv.querySelector(".tree-chevron-icon");
          const isCollapsed = childUl.classList.toggle("hidden");
          chevron.style.transform = isCollapsed ? "rotate(0deg)" : "rotate(90deg)";
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showProjectItemContextMenu(e, itemDiv, fullPath, entry.name, true, false);
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

        itemDiv.addEventListener("click", () => {
          document.querySelectorAll(".tree-item").forEach(x => x.classList.remove("active"));
          itemDiv.classList.add("active");
          openFileFromPath(fullPath);
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showProjectItemContextMenu(e, itemDiv, fullPath, entry.name, false, isMain);
        });

        li.appendChild(itemDiv);
      }
      parentElement.appendChild(li);
    });
  }

  function showProjectItemContextMenu(e, itemDiv, fullPath, name, isDir, isMain) {
    const existing = document.getElementById("tree-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "tree-context-menu";
    menu.className = "tree-context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    let html = `
      <div class="context-menu-item" id="ctx-proj-open">Apri</div>
      <div class="context-menu-item" id="ctx-proj-rename">Rinomina (F2)</div>
      <div class="context-menu-item" id="ctx-proj-duplicate">Duplica</div>
    `;

    if (!isDir && fullPath.endsWith(".tex") && !isMain) {
      html += `<div class="context-menu-item" id="ctx-proj-set-main">Imposta come documento principale</div>`;
    }

    html += `
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" id="ctx-proj-reveal">Mostra nello store</div>
      <div class="context-menu-item text-danger" id="ctx-proj-delete">Sposta nel cestino</div>
    `;

    menu.innerHTML = html;
    document.body.appendChild(menu);

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
        const ext = path.extname(fullPath);
        const base = path.basename(fullPath, ext);
        const copyPath = path.join(path.dirname(fullPath), `${base}-copy${ext}`);
        if (isDir) {
          fs.cpSync(fullPath, copyPath, { recursive: true });
        } else {
          fs.copyFileSync(fullPath, copyPath);
        }
        showNotification(`Elemento duplicato in "${path.basename(copyPath)}"`, "info");
        renderProjectPane(currentProject.storePath);
      } catch (err) {
        showNotification("Errore duplicazione: " + err.message, "error");
      }
    };

    if (menu.querySelector("#ctx-proj-set-main")) {
      menu.querySelector("#ctx-proj-set-main").onclick = async () => {
        menu.remove();
        setMainDocument(fullPath);
        try {
          const manifest = await ipcRenderer.invoke('project-load-manifest', currentProject.storePath);
          manifest.main = path.relative(currentProject.storePath, fullPath);
          await ipcRenderer.invoke('project-save-manifest', currentProject.storePath, manifest);
        } catch (_) {}
        showNotification(`"${name}" impostato come documento principale`, "info");
        renderProjectPane(currentProject.storePath);
      };
    }

    menu.querySelector("#ctx-proj-reveal").onclick = () => {
      menu.remove();
      ipcRenderer.invoke('project-reveal-item', fullPath);
    };

    menu.querySelector("#ctx-proj-delete").onclick = async () => {
      menu.remove();
      const ok = await showCustomConfirmDialog({
        title: "Sposta nel cestino",
        message: `Sei sicuro di voler spostare "${name}" nel cestino? Nessun file viene eliminato definitivamente.`
      });
      if (ok) {
        const openTab = tabs.find(t => t.filePath === fullPath);
        if (openTab) closeTab(openTab.id);

        await ipcRenderer.invoke('project-trash-item', fullPath);
        showNotification(`"${name}" spostato nel cestino`, "info");
        renderProjectPane(currentProject.storePath);
      }
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

    const input = document.createElement("input");
    input.type = "text";
    input.className = "tree-inline-input";
    input.value = oldName;

    labelSpan.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      if (!newName || newName === oldName) {
        refreshFn();
        return;
      }
      const val = validateItemName(newName);
      if (!val.valid) {
        showNotification(val.error, "error");
        refreshFn();
        return;
      }
      const newPath = path.join(path.dirname(filePath), newName);
      if (fs.existsSync(newPath)) {
        showNotification(`"${newName}" esiste già.`, "warning");
        refreshFn();
        return;
      }
      try {
        fs.renameSync(filePath, newPath);
        const tab = tabs.find(t => t.filePath === filePath);
        if (tab) {
          tab.filePath = newPath;
          tab.title = newName;
          renderTabs();
        }
        if (mainDocumentPath === filePath) {
          setMainDocument(newPath);
        }
        showNotification(`Rinominato in "${newName}"`, "info");
        refreshFn();
      } catch (err) {
        showNotification("Errore rinomina: " + err.message, "error");
        refreshFn();
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      else if (e.key === "Escape") { committed = true; refreshFn(); }
    });
    input.addEventListener("blur", () => setTimeout(commit, 120));
  }

  function openFileFromPath(filePath) {
    if (!fs.existsSync(filePath)) return;
    const existing = tabs.find(t => t.filePath === filePath);
    if (existing) {
      switchTab(existing.id);
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    createTab(path.basename(filePath), content, filePath);
  }
  window.openFileFromPath = openFileFromPath;
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
  function showInlineTreeInput(containerEl, targetDir, type = "file") {
    if (!targetDir || !fs.existsSync(targetDir)) return;
    const existing = document.querySelector(".tree-inline-input-row");
    if (existing) existing.remove();

    const row = document.createElement("div");
    row.className = "tree-inline-input-row";
    const iconSvg = type === "folder"
      ? '<svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>'
      : '<svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
    const defaultVal = type === "folder" ? "nuova-cartella" : "nuovo-file.tex";

    row.innerHTML = `
      <span class="tree-icon" style="display:flex;align-items:center;">${iconSvg}</span>
      <input type="text" class="tree-inline-input" value="${defaultVal}" />
    `;

    containerEl.prepend(row);
    const input = row.querySelector(".tree-inline-input");
    input.focus();
    input.select();

    let committed = false;

    const commit = async () => {
      if (committed) return;
      committed = true;
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

      const targetPath = path.join(targetDir, name);
      if (fs.existsSync(targetPath)) {
        showNotification(`"${name}" esiste già.`, "warning");
        return;
      }

      try {
        if (type === "folder") {
          await fs.promises.mkdir(targetPath, { recursive: true });
          showNotification(`Cartella "${name}" creata!`, "info");
        } else {
          await fs.promises.writeFile(targetPath, '\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n', 'utf8');
          showNotification(`File "${name}" creato!`, "info");
          openFileFromPath(targetPath);
        }

        if (isLinkedProject && currentProject && targetDir.startsWith(currentProject.storePath)) {
          renderProjectPane(currentProject.storePath);
        } else if (currentProjectDir) {
          renderFolderPane(currentProjectDir);
        }
      } catch (err) {
        showNotification("Errore: " + err.message, "error");
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        commit();
      } else if (e.key === "Escape") {
        committed = true;
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

      const droppedFiles = e.dataTransfer.files;
      if (!droppedFiles || droppedFiles.length === 0) return;

      let count = 0;
      for (const f of droppedFiles) {
        const src = f.path;
        if (!src || !fs.existsSync(src)) continue;
        const dest = path.join(currentProject.storePath, path.basename(src));
        try {
          if (fs.statSync(src).isDirectory()) {
            fs.cpSync(src, dest, { recursive: true });
          } else {
            fs.copyFileSync(src, dest);
          }
          count++;
        } catch (err) {
          console.warn("[LACK] Drag-drop import error:", err);
        }
      }
      if (count > 0) {
        showNotification(`${count} element${count === 1 ? 'o importato' : 'i importati'} nello store di progetto`, "info");
        renderProjectPane(currentProject.storePath);
      }
    });
  }

  // Explorer & Pane Action Buttons
  document.getElementById("new-folder")?.addEventListener("click", async () => {
    if (isLinkedProject && currentProject) {
      showInlineTreeInput(projectTreeEl, currentProject.storePath, "folder");
      return;
    }
    if (!currentProjectDir) {
      const res = await dialog.showOpenDialog({
        title: "Seleziona o crea la cartella di progetto",
        properties: ["openDirectory", "createDirectory"]
      });
      if (!res.canceled && res.filePaths.length > 0) openFolder(res.filePaths[0]);
      return;
    }
    showInlineTreeInput(folderTreeEl || fileTreeLegacy, currentProjectDir, "folder");
  });

  document.getElementById("new-file")?.addEventListener("click", () => {
    if (isLinkedProject && currentProject) {
      showInlineTreeInput(projectTreeEl, currentProject.storePath, "file");
      return;
    }
    if (!currentProjectDir) {
      newFile();
      return;
    }
    showInlineTreeInput(folderTreeEl || fileTreeLegacy, currentProjectDir, "file");
  });

  document.getElementById("open-folder")?.addEventListener("click", () => openFolderDialog());
  document.getElementById("refresh-explorer")?.addEventListener("click", () => {
    if (isLinkedProject && currentProject) {
      renderProjectPane(currentProject.storePath);
      if (currentProjectDir) renderFolderPane(currentProjectDir);
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

  // Folder pane specific buttons
  document.getElementById("folder-btn-refresh")?.addEventListener("click", () => {
    if (currentProjectDir) renderFolderPane(currentProjectDir);
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
    showInlineTreeInput(projectTreeEl, currentProject.storePath, "file");
  });
  document.getElementById("proj-btn-add-folder")?.addEventListener("click", () => {
    if (!isLinkedProject || !currentProject) return;
    showInlineTreeInput(projectTreeEl, currentProject.storePath, "folder");
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
        const targetExists = proj.targetPath && fs.existsSync(proj.targetPath);
        const storeExists = proj.storePath && fs.existsSync(proj.storePath);
        const storeSize = storeExists ? formatBytes(calculateDirSize(proj.storePath)) : "0 B";
        const dateStr = proj.lastModified ? new Date(proj.lastModified).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : "N/D";

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
            <span class="project-card-target-path" title="${escapeHtml(proj.targetPath || '')}">${escapeHtml(proj.targetPath ? path.basename(proj.targetPath) : 'Nessuno')}</span>
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
            targetPath: proj.targetPath,
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
            message: `Stai eliminando il progetto "${proj.name}".\n\nVuoi mantenere i dati sorgente archiviati nello store (in modo da poter ricreare o duplicare il PDF in futuro), oppure eliminare definitivamente tutti i dati del progetto?`,
            buttons: [
              { text: "Annulla", value: 'cancel', isCancel: true },
              { text: "Mantieni dati sorgente", value: 'keep_sources', isPrimary: true },
              { text: "Elimina tutti i dati", value: 'delete_all', isDanger: true }
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
    const res = await dialog.showSaveDialog({
      title: "Seleziona destinazione file PDF",
      defaultPath: "documento.pdf",
      filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
    });
    if (!res.canceled && res.filePath) {
      if (inputNewProjTarget) inputNewProjTarget.value = res.filePath;
      if (inputNewProjName && (!inputNewProjName.value || inputNewProjName.value === "Nuovo Progetto")) {
        inputNewProjName.value = path.basename(res.filePath, ".pdf");
      }
    }
  });

  document.getElementById("btn-submit-new-proj")?.addEventListener("click", async () => {
    const name = inputNewProjName?.value.trim() || "Nuovo Progetto";
    const targetPath = inputNewProjTarget?.value.trim();
    const template = selectNewProjTemplate?.value || "standard";

    if (!targetPath) {
      showNotification("Seleziona una destinazione valida per il file PDF.", "warning");
      return;
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
        compileImmediate: true
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
      <div class="outline-item outline-level-${item.type}" data-line="${item.line}">
        <span>${escapeHtml(item.title)}</span>
      </div>
    `).join('');

    outlineTree.querySelectorAll('.outline-item').forEach(el => {
      el.onclick = () => {
        const line = parseInt(el.dataset.line, 10);
        cm.jumpToLine(line);
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

  function openTemplateGallery() {
    renderTemplateCards("all");
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

  function useTemplate(t) {
    templateModal.classList.add("hidden");
    newFile(t.content);
    showNotification(`Template "${t.title}" caricato!`, "info");
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
  templateSearchInput.addEventListener("input", (e) => {
    const activeNav = document.querySelector(".template-nav-btn.active");
    const cat = activeNav ? activeNav.dataset.category : "all";
    renderTemplateCards(cat, e.target.value);
  });

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
    }

    if (e.key === 'Escape') {
      closeAllTitlebarMenus();
      closeAllToolbarDropdowns();
      document.getElementById('new-file-popup')?.classList.add('hidden');
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
        case 'undo': document.execCommand('undo'); break;
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
          document.getElementById('search-container')?.classList.remove('hidden');
          document.getElementById('search-input')?.focus();
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
          currentZoomLevel = Math.min(2.5, currentZoomLevel + 0.1);
          webFrame.setZoomFactor(currentZoomLevel);
          break;
        case 'zoom-out':
          currentZoomLevel = Math.max(0.6, currentZoomLevel - 0.1);
          webFrame.setZoomFactor(currentZoomLevel);
          break;
        case 'zoom-reset':
          currentZoomLevel = 1.0;
          webFrame.setZoomFactor(1.0);
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
  const collabModal = document.getElementById("collab-modal");
  const btnCollab = document.getElementById("btn-collab");
  const collabStatusPill = document.getElementById("collab-status-container");
  const collabStatusText = document.getElementById("collab-status-text");

  btnCollab.onclick = () => {
    const state = getCollabState();
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
      if (newRoomInput) newRoomInput.value = generateRoomId();
    }
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
    document.getElementById("collab-new-room-id").value = generateRoomId();
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
    startCollaboration({
      roomId: roomId,
      cm: cm,
      isJoining: false,
      onRemoteUpdate: () => updateWordCount(),
      onUsersChange: (count) => {
        document.getElementById("collab-users-count").textContent = count;
        collabStatusText.textContent = `${count} online (${roomId})`;
      },
      onStatusChange: (status) => {
        collabStatusPill.classList.remove("hidden");
      },
      showNotification: showNotification
    });
    collabModal.classList.add("hidden");
    showNotification(i18n.t("notif_session_started", { room: roomId }), "info");
  };

  document.getElementById("btn-collab-join").onclick = () => {
    const roomId = document.getElementById("collab-join-room-id").value.trim();
    if (!roomId) return;
    startCollaboration({
      roomId: roomId,
      cm: cm,
      isJoining: true,
      onRemoteUpdate: () => updateWordCount(),
      onUsersChange: (count) => {
        document.getElementById("collab-users-count").textContent = count;
        collabStatusText.textContent = `${count} online (${roomId})`;
      },
      onStatusChange: (status) => {
        collabStatusPill.classList.remove("hidden");
      },
      showNotification: showNotification
    });
    collabModal.classList.add("hidden");
    showNotification(i18n.t("notif_session_joined", { room: roomId }), "info");
  };

  document.getElementById("btn-collab-leave").onclick = () => {
    leaveCollaboration();
    collabStatusPill.classList.add("hidden");
    collabModal.classList.add("hidden");
    showNotification(i18n.t("notif_session_ended"), "info");
  };

  // ====== SETTINGS MODAL ======
  const settingsModal = document.getElementById("settings-modal");
  document.getElementById("btn-options").onclick = () => settingsModal.classList.remove("hidden");
  document.getElementById("btn-close-settings").onclick = () => settingsModal.classList.add("hidden");
  document.getElementById("modal-overlay").onclick = () => settingsModal.classList.add("hidden");

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
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "n" || e.key === "N") {
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
        if (!e.shiftKey) {
          e.preventDefault();
          openTemplateGallery();
        }
      } else if (e.key === ",") {
        e.preventDefault();
        settingsModal.classList.remove("hidden");
      }
    }
  });

  // ====== IPC SHORTCUTS & MENU LISTENERS ======
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
  ipcRenderer.on("load-tex", (_e, filePath, content) => {
    openFileFromPath(filePath) || createTab(path.basename(filePath), content, filePath);
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
      currentZoomLevel = Math.min(2.5, Math.round((currentZoomLevel + 0.1) * 10) / 10);
      webFrame.setZoomFactor(currentZoomLevel);
      showNotification(`Zoom: ${Math.round(currentZoomLevel * 100)}%`, "info");
    }
  }

  function handleZoomOut() {
    if (isMouseOverPreview && typeof pdfViewer.zoomOut === "function") {
      pdfViewer.zoomOut();
    } else {
      currentZoomLevel = Math.max(0.5, Math.round((currentZoomLevel - 0.1) * 10) / 10);
      webFrame.setZoomFactor(currentZoomLevel);
      showNotification(`Zoom: ${Math.round(currentZoomLevel * 100)}%`, "info");
    }
  }

  function handleZoomReset() {
    if (isMouseOverPreview && typeof pdfViewer.resetZoom === "function") {
      pdfViewer.resetZoom();
    } else {
      currentZoomLevel = 1.0;
      webFrame.setZoomFactor(1.0);
      showNotification("Zoom: 100%", "info");
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
    showNotification("Lack - Editor LaTeX Professionale v1.0.0", "info");
  });

  // Empty state buttons
  document.getElementById("empty-btn-new-file")?.addEventListener("click", () => newFile());
  document.getElementById("empty-btn-open-file")?.addEventListener("click", () => openFileDialog());
  document.getElementById("empty-btn-open-folder")?.addEventListener("click", () => openFolderDialog());
  document.getElementById("empty-btn-templates")?.addEventListener("click", () => openTemplateGallery());
  document.getElementById("btn-new-tab")?.addEventListener("click", () => newFile());

  // Save current as template modal helper
  function openSaveTemplateModal() {
    const content = cm ? cm.getValue() : "";
    if (!content.trim()) {
      showNotification("Documento vuoto: inserisci del codice LaTeX prima di salvarlo come template", "warning");
      return;
    }
    const tab = getActiveTab();
    const title = tab ? tab.title.replace(/\.tex$/i, "") : "Nuovo Template";
    try {
      LackTemplates.saveCustomTemplate({
        title,
        category: 'academic',
        description: 'Template personalizzato',
        content
      });
      showNotification(`Template "${title}" salvato con successo!`, "info");
    } catch (e) {
      showNotification("Errore salvataggio template: " + e.message, "error");
    }
  }

  // Initial tab
  newFile();
});
