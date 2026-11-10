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
const savedTheme = localStorage.getItem('lack-theme') || 'dark';
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
function showCustomConfirmDialog({ title, message, okText, cancelText }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'app-confirm-overlay';
    overlay.innerHTML = `
      <div class="app-confirm-box">
        <div class="app-confirm-header">
          <div class="app-confirm-icon-box question">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          <div class="app-confirm-title">${escapeHtml(title)}</div>
        </div>
        <div class="app-confirm-message">${escapeHtml(message)}</div>
        <div class="app-confirm-actions">
          <button type="button" class="app-confirm-btn app-confirm-btn-secondary" id="confirm-no">${escapeHtml(cancelText || "No")}</button>
          <button type="button" class="app-confirm-btn app-confirm-btn-primary" id="confirm-yes">${escapeHtml(okText || "Sì")}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#confirm-yes').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    overlay.querySelector('#confirm-no').onclick = () => {
      overlay.remove();
      resolve(false);
    };
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

  winMinimizeBtn?.addEventListener("click", () => ipcRenderer.send("window-minimize"));
  winMaximizeBtn?.addEventListener("click", () => ipcRenderer.send("window-maximize"));
  winCloseBtn?.addEventListener("click", () => ipcRenderer.send("window-close"));

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

  // Settings state
  let config = {
    theme: savedTheme,
    lang: savedLang,
    fontSize: parseInt(localStorage.getItem('lack-fontSize') || '14', 10),
    lineWrapping: localStorage.getItem('lack-lineWrapping') !== 'false',
    vimMode: localStorage.getItem('lack-vimMode') === 'true',
    spellLanguage: localStorage.getItem('lack-spellLanguage') || 'it',
    engine: localStorage.getItem('lack-engine') || 'pdflatex',
    customEnginePath: localStorage.getItem('lack-customEnginePath') || '',
    autoCompile: localStorage.getItem('lack-autoCompile') === 'true',
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
    onCompile: () => triggerCompile(),
    getBibKeys: projectContext.getBibKeys,
    getImageFiles: projectContext.getImageFiles,
    getTexFiles: projectContext.getTexFiles
  });
  window.cm = cm;
  window.__lackCmInstance = cm;

  cm.setLineWrapping(config.lineWrapping);
  cm.setVimMode(config.vimMode);

  // Initialize spellchecker
  editorLib.setSpellLanguage(config.spellLanguage, __dirname);

  // Document change handler
  cm.onDocChange((content) => {
    const tab = getActiveTab();
    if (tab) {
      if (tab.content !== content) {
        tab.content = content;
        updateTabDirty(tab.id, true);
      }
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
    }
    updateTitle();
  }

  function updateTitle() {
    const tab = getActiveTab();
    if (!tab) {
      titlebarTitle.textContent = "Lack";
    } else {
      titlebarTitle.textContent = `${tab.title}${tab.dirty ? " •" : ""} - Lack`;
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

      tabEl.innerHTML = `
        <span class="tab-title">${escapeHtml(tab.title)}</span>
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
      filePath: filePath,
      dirty: false
    };
    tabs.push(newTab);
    switchTab(id);

    if (filePath && !mainDocumentPath && filePath.endsWith(".tex")) {
      setMainDocument(filePath);
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
    }
    renderTabs();
    updateWordCount();
    updateOutlineTree();
  }

  async function closeTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.dirty) {
      const save = await showCustomConfirmDialog({
        title: i18n.t("save_changes_title"),
        message: i18n.t("save_changes_message", { name: tab.title }),
        okText: i18n.t("save"),
        cancelText: i18n.t("save_dont_save")
      });
      if (save) {
        await saveFile(tab);
      }
    }

    const index = tabs.findIndex(t => t.id === tabId);
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
    if (!targetTab) return;

    saveActiveTabState();

    if (!targetTab.filePath) {
      const result = await dialog.showSaveDialog({
        title: "Salva documento LaTeX",
        defaultPath: targetTab.title,
        filters: [{ name: "LaTeX Document", extensions: ["tex"] }]
      });
      if (result.canceled || !result.filePath) return;
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
      await fs.promises.writeFile(targetTab.filePath, targetTab.content, "utf8");
      updateTabDirty(targetTab.id, false);
      showNotification(`File salvato con successo: ${targetTab.title}`, "info");

      // Save local history revision in .lack-history/
      saveFileHistorySnapshot(targetTab.filePath, targetTab.content);

      if (currentProjectDir) renderFileTree(currentProjectDir);
    } catch (err) {
      showNotification("Errore di salvataggio: " + err.message, "error");
    }
  }

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
      await fs.promises.writeFile(tab.filePath, tab.content, "utf8");
      updateTabDirty(tab.id, false);
      showNotification(`File salvato: ${tab.title}`, "info");
      saveFileHistorySnapshot(tab.filePath, tab.content);
      if (currentProjectDir) renderFileTree(currentProjectDir);
    } catch (err) {
      showNotification("Errore durante il salvataggio: " + err.message, "error");
    }
  }

  // Local history snapshot writer (caps at 50 revisions)
  async function saveFileHistorySnapshot(filePath, content) {
    try {
      const dir = path.dirname(filePath);
      const historyDir = path.join(dir, '.lack-history');
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

    isCompiling = true;
    btnRecompile.classList.add("compiling");

    let targetPath = mainDocumentPath || (tab ? tab.filePath : null);
    let contentToPass = cm ? cm.getValue() : (tab ? tab.content : "");

    const compileOpts = {
      filePath: targetPath,
      content: contentToPass,
      projectDir: currentProjectDir,
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

  // ====== FILE TREE EXPLORER ======
  const fileTreeEl = document.getElementById("file-tree");
  const folderPathEl = document.getElementById("folder-path");

  function openFolder(folderPath) {
    if (!fs.existsSync(folderPath)) return;
    currentProjectDir = folderPath;
    folderPathEl.textContent = path.basename(folderPath);
    folderPathEl.classList.remove("hidden");

    // Check for main.tex in folder
    const defaultMain = path.join(folderPath, "main.tex");
    if (fs.existsSync(defaultMain)) {
      setMainDocument(defaultMain);
      openFileFromPath(defaultMain);
    }

    renderFileTree(folderPath);
  }

  function renderFileTree(dir) {
    fileTreeEl.innerHTML = "";
    const rootUl = document.createElement("ul");
    rootUl.className = "tree-root";
    buildTreeRecursive(dir, rootUl);
    fileTreeEl.appendChild(rootUl);
  }

  function buildTreeRecursive(dir, parentElement) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    entries.forEach(entry => {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "build") return;
      const fullPath = path.join(dir, entry.name);

      const li = document.createElement("li");
      li.className = "tree-node";

      const itemDiv = document.createElement("div");
      itemDiv.className = "tree-item";
      itemDiv.title = fullPath;

      if (entry.isDirectory()) {
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

        li.appendChild(itemDiv);
        li.appendChild(childUl);
        buildTreeRecursive(fullPath, childUl);
      } else {
        itemDiv.innerHTML = `
          <svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          <span class="tree-label">${escapeHtml(entry.name)}</span>
        `;

        itemDiv.addEventListener("click", () => {
          document.querySelectorAll(".tree-item").forEach(x => x.classList.remove("active"));
          itemDiv.classList.add("active");
          openFileFromPath(fullPath);
        });

        itemDiv.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          if (fullPath.endsWith(".tex")) {
            setMainDocument(fullPath);
          }
        });

        li.appendChild(itemDiv);
      }
      parentElement.appendChild(li);
    });
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

  // Inline input row for new folder and new file (Fixes window.prompt bug)
  function showInlineTreeInput(type = "file") {
    if (!currentProjectDir) return;
    const existing = document.querySelector(".tree-inline-input-row");
    if (existing) existing.remove();

    const row = document.createElement("div");
    row.className = "tree-inline-input-row";
    const icon = type === "folder" ? "📁" : "📄";
    const defaultVal = type === "folder" ? "nuova-cartella" : "nuovo-file.tex";

    row.innerHTML = `
      <span class="tree-icon" style="font-size:12px;">${icon}</span>
      <input type="text" class="tree-inline-input" value="${defaultVal}" />
    `;

    fileTreeEl.prepend(row);
    const input = row.querySelector(".tree-inline-input");
    input.focus();
    input.select();

    let committed = false;

    const commit = async () => {
      if (committed) return;
      committed = true;
      const name = input.value.trim();
      row.remove();

      if (!name || name === "." || name === "..") return;
      if (/[\/\\:*?"<>|]/.test(name)) {
        showNotification("Il nome contiene caratteri non validi: / \\ : * ? \" < > |", "error");
        return;
      }

      const targetPath = path.join(currentProjectDir, name);
      if (fs.existsSync(targetPath)) {
        showNotification(`"${name}" esiste già nella cartella di progetto.`, "warning");
        return;
      }

      try {
        if (type === "folder") {
          await fs.promises.mkdir(targetPath, { recursive: true });
          showNotification(`Cartella "${name}" creata!`, "info");
        } else {
          const filePath = name.endsWith('.tex') ? targetPath : targetPath + '.tex';
          await fs.promises.writeFile(filePath, '\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n', 'utf8');
          showNotification(`File "${path.basename(filePath)}" creato!`, "info");
          openFileFromPath(filePath);
        }
        renderFileTree(currentProjectDir);
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

  document.getElementById("new-folder")?.addEventListener("click", async () => {
    if (!currentProjectDir) {
      const res = await dialog.showOpenDialog({
        title: "Seleziona o crea la cartella di progetto",
        properties: ["openDirectory", "createDirectory"]
      });
      if (!res.canceled && res.filePaths.length > 0) {
        openFolder(res.filePaths[0]);
      }
      return;
    }
    showInlineTreeInput("folder");
  });

  document.getElementById("new-file")?.addEventListener("click", (e) => {
    if (!currentProjectDir) {
      newFile();
      return;
    }
    showInlineTreeInput("file");
  });

  document.getElementById("open-folder")?.addEventListener("click", () => openFolderDialog());
  document.getElementById("refresh-explorer")?.addEventListener("click", () => {
    if (currentProjectDir) renderFileTree(currentProjectDir);
  });
  document.getElementById("collapse-all")?.addEventListener("click", () => {
    document.querySelectorAll(".tree-children").forEach(c => c.classList.add("hidden"));
    document.querySelectorAll(".tree-chevron-icon").forEach(ch => ch.style.transform = "rotate(0deg)");
  });
  document.getElementById("btn-toggle-explorer")?.addEventListener("click", () => {
    document.getElementById("explorer-panel")?.classList.toggle("hidden");
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

  function renderTemplateCards(category = "all", filterText = "") {
    templateGrid.innerHTML = "";
    const all = LackTemplates.getAllTemplates();

    const filtered = all.filter(t => {
      const matchCat = category === "all" ? true :
                       category === "official" ? !t.isCustom :
                       category === "custom" ? !!t.isCustom :
                       t.category === category;
      const matchText = !filterText ? true :
                        (t.title + " " + t.description + " " + t.category).toLowerCase().includes(filterText.toLowerCase());
      return matchCat && matchText;
    });

    document.getElementById("template-visible-count").textContent = `${filtered.length} template disponibili`;

    const getCategoryIconSvg = (cat) => {
      switch (cat) {
        case 'academic':
          return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
        case 'beamer':
          return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
        case 'cv':
          return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        case 'reports':
          return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
        default:
          return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
      }
    };

    filtered.forEach(t => {
      const card = document.createElement("div");
      card.className = "template-card";
      card.innerHTML = `
        <div class="template-card-category-pill">${escapeHtml(t.categoryLabel || t.category)}</div>
        <div class="template-card-header-line">
          <span class="template-card-icon">${getCategoryIconSvg(t.category)}</span>
          <h4 class="template-card-title">${escapeHtml(t.title)}</h4>
        </div>
        <p class="template-card-desc">${escapeHtml(t.description)}</p>
        <div class="template-card-footer">
          <button class="template-btn-preview">Anteprima</button>
          <button class="template-btn-use">Usa Template</button>
        </div>
      `;

      card.querySelector(".template-btn-preview").onclick = (e) => { e.stopPropagation(); showTemplatePreview(t); };
      card.querySelector(".template-btn-use").onclick = (e) => { e.stopPropagation(); useTemplate(t); };
      card.onclick = () => showTemplatePreview(t);
      templateGrid.appendChild(card);
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
    cm.wrapSelection(prefix, suffix);
  }

  document.getElementById("btn-bold").onclick = () => wrapSelection("\\textbf{", "}");
  document.getElementById("btn-italic").onclick = () => wrapSelection("\\textit{", "}");
  document.getElementById("btn-underline").onclick = () => wrapSelection("\\underline{", "}");
  document.getElementById("btn-code").onclick = () => wrapSelection("\\texttt{", "}");
  document.getElementById("btn-math-inline").onclick = () => wrapSelection("$", "$");
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
    });
  });

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

    document.querySelectorAll("#theme-segmented button").forEach(b => {
      b.classList.toggle("active", b.dataset.theme === theme);
    });
  }

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
  ipcRenderer.on("zoom-in", () => {
    currentZoomLevel = Math.min(2.5, currentZoomLevel + 0.1);
    webFrame.setZoomFactor(currentZoomLevel);
  });
  ipcRenderer.on("zoom-out", () => {
    currentZoomLevel = Math.max(0.6, currentZoomLevel - 0.1);
    webFrame.setZoomFactor(currentZoomLevel);
  });
  ipcRenderer.on("zoom-reset", () => {
    currentZoomLevel = 1.0;
    webFrame.setZoomFactor(1.0);
  });
  ipcRenderer.on("toggle-theme", () => {
    const nextTheme = config.theme === "dark" ? "light" : config.theme === "light" ? "github" : "dark";
    applyTheme(nextTheme);
  });
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
