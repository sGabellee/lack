// ====== LACK RENDERER PROCESS ======
const i18n = require("./i18n.js");
const { ipcRenderer, webFrame } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { dialog, clipboard } = require("@electron/remote");

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
const { LatexAutocomplete } = require("./latex-autocomplete.js");
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

// ====== DOM READY ======
window.addEventListener("DOMContentLoaded", async () => {

  // ====== PLATFORM DETECTION & WINDOW CONTROLS ======
  const platform = ipcRenderer.sendSync('get-platform') || 'linux';
  document.body.classList.add(`platform-${platform}`);

  function applyWindowControlsStyle(style) {
    document.body.classList.remove('win-ctrl-ubuntu', 'win-ctrl-mac', 'win-ctrl-win');
    document.body.classList.add(`win-ctrl-${style}`);
    localStorage.setItem('lack.windowControlsStyle', style);
    document.querySelectorAll('#win-controls-segmented button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.controlsStyle === style);
    });
  }
  const savedControlsStyle = localStorage.getItem('lack.windowControlsStyle') || (platform === 'linux' ? 'ubuntu' : 'win');
  applyWindowControlsStyle(savedControlsStyle);

  document.querySelectorAll('#win-controls-segmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.controlsStyle;
      if (style) applyWindowControlsStyle(style);
    });
  });

  const minBtn = document.getElementById('win-minimize');
  const maxBtn = document.getElementById('win-maximize');
  const closeBtn = document.getElementById('win-close');

  if (minBtn) minBtn.onclick = () => ipcRenderer.send('window-minimize');
  if (maxBtn) maxBtn.onclick = () => ipcRenderer.send('window-maximize');
  if (closeBtn) closeBtn.onclick = () => ipcRenderer.send('window-close');

  const setMaximizeState = (isMax) => {
    document.body.classList.toggle('window-maximized', isMax);
    if (maxBtn) {
      const key = isMax ? 'win_restore' : 'win_maximize';
      maxBtn.setAttribute('data-i18n-title', key);
      maxBtn.title = i18n.t(key) || (isMax ? 'Ripristina' : 'Ingrandisci');
    }
  };

  ipcRenderer.on('window-maximize-changed', (_event, isMax) => {
    setMaximizeState(isMax);
  });

  try {
    const isInitiallyMaximized = ipcRenderer.sendSync('is-window-maximized');
    if (isInitiallyMaximized) {
      setMaximizeState(true);
    }
  } catch (err) {}

  // In-app confirm modal helper
  let currentConfirmResolver = null;
  function showCustomConfirmDialog(options = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('app-confirm-modal');
      const titleEl = document.getElementById('app-confirm-title');
      const messageEl = document.getElementById('app-confirm-message');
      const actionsEl = document.getElementById('app-confirm-actions');

      if (!modal) return resolve(false);
      currentConfirmResolver = resolve;

      if (titleEl) titleEl.textContent = options.title || i18n.t('confirm');
      if (messageEl) messageEl.textContent = options.message || '';

      if (actionsEl) {
        actionsEl.innerHTML = '';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'pdf-export-btn-cancel';
        cancelBtn.textContent = options.cancelText || i18n.t('cancel');
        cancelBtn.onclick = () => {
          modal.classList.add('hidden');
          resolve(false);
        };

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'collab-submit-btn app-confirm-btn-primary';
        okBtn.textContent = options.okText || i18n.t('confirm');
        okBtn.onclick = () => {
          modal.classList.add('hidden');
          resolve(true);
        };

        actionsEl.appendChild(cancelBtn);
        actionsEl.appendChild(okBtn);
      }
      modal.classList.remove('hidden');
    });
  }

  document.getElementById('btn-close-app-confirm')?.addEventListener('click', () => {
    document.getElementById('app-confirm-modal')?.classList.add('hidden');
    if (currentConfirmResolver) currentConfirmResolver(false);
  });
  document.getElementById('app-confirm-overlay')?.addEventListener('click', () => {
    document.getElementById('app-confirm-modal')?.classList.add('hidden');
    if (currentConfirmResolver) currentConfirmResolver(false);
  });

  // --- STATE ---
  let tabs = [];
  let activeTabId = null;
  let untitledCounter = 0;
  let currentProjectDir = null;
  let mainDocumentPath = null;
  let currentCompiledPdfPath = null;
  let latestIssues = [];
  let currentZoomLevel = 1.0;
  let pdfZoomPercent = 100;
  let isCompiling = false;

  // Settings state
  let config = {
    theme: savedTheme,
    lang: savedLang,
    fontSize: parseInt(localStorage.getItem('lack-fontSize') || '15', 10),
    tabSize: parseInt(localStorage.getItem('lack-tabSize') || '2', 10),
    engine: localStorage.getItem('lack-engine') || 'pdflatex',
    customEnginePath: localStorage.getItem('lack-customEnginePath') || '',
    autoCompile: localStorage.getItem('lack-autoCompile') !== 'false',
    autoSave: localStorage.getItem('lack-autoSave') === 'true',
    autoScroll: localStorage.getItem('lack-autoScroll') !== 'false',
    autocomplete: localStorage.getItem('lack-autocomplete') !== 'false',
    cleanAux: localStorage.getItem('lack-cleanAux') === 'true'
  };

  // --- DOM REFERENCES ---
  const editor = document.getElementById("editor");
  const editorLineNumbers = document.getElementById("editor-line-numbers");
  const tabsScrollArea = document.getElementById("tabs-scroll-area");
  const tabsBar = document.getElementById("tabs-bar");
  const emptyState = document.getElementById("empty-state");
  const mainStageContainer = document.getElementById("container");
  const btnRecompile = document.getElementById("btn-recompile");
  const compileStatusDot = btnRecompile.querySelector(".compile-status-dot");
  const btnToggleLogs = document.getElementById("btn-toggle-logs");
  const badgeErrors = document.getElementById("badge-errors");
  const badgeWarnings = document.getElementById("badge-warnings");
  const logsDrawer = document.getElementById("logs-drawer");
  const logsIssuesList = document.getElementById("logs-issues-list");
  const logsRawText = document.getElementById("logs-raw-text");
  const pdfFrame = document.getElementById("pdf-frame");
  const pdfEmptyPlaceholder = document.getElementById("pdf-empty-placeholder");
  const livePreviewEl = document.getElementById("preview");
  const footerMainDoc = document.getElementById("footer-main-doc");
  const footerCompilerEngine = document.getElementById("footer-compiler-engine");
  const lineColCounter = document.getElementById("line-col-counter");
  const wordCountEl = document.getElementById("word-count");
  const titlebarTitle = document.getElementById("titlebar-title");

  // Detect available TeX engines on startup
  try {
    const detected = await ipcRenderer.invoke('detect-latex-engines');
    const available = detected.filter(d => d.available);
    if (!available.some(a => a.id === config.engine)) {
      config.engine = latexCompiler.getBestAvailableEngine();
    }
  } catch (e) {}

  updateEngineFooter();

  // Initialize Autocomplete
  let autocompleteInstance = null;
  if (config.autocomplete) {
    autocompleteInstance = new LatexAutocomplete(editor, document.body, () => {
      onEditorContentChange();
    });
  }

  // ====== MULTI-TAB MANAGEMENT ======
  function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) || null;
  }

  function saveActiveTabState() {
    const tab = getActiveTab();
    if (tab && editor) {
      tab.content = editor.value;
      tab.scrollTop = editor.scrollTop;
      tab.selectionStart = editor.selectionStart;
      tab.selectionEnd = editor.selectionEnd;
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

      tabEl.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          closeTab(tab.id);
        }
      });

      tabsScrollArea.appendChild(tabEl);
    });

    updateTitle();
  }

  function createTab(title, content = "", filePath = null) {
    saveActiveTabState();
    const id = "tab-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4);
    const newTab = {
      id: id,
      title: title,
      content: content,
      filePath: filePath,
      dirty: false,
      scrollTop: 0,
      selectionStart: 0,
      selectionEnd: 0
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
    if (tab) {
      editor.value = tab.content;
      editor.selectionStart = tab.selectionStart || 0;
      editor.selectionEnd = tab.selectionEnd || 0;
      editor.scrollTop = tab.scrollTop || 0;
      updateLineNumbers();
      updateCursorCounters();
    }
    renderTabs();
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
        editor.value = "";
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
    onEditorContentChange();
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
        title: "Salva file LaTeX",
        defaultPath: targetTab.title.endsWith(".tex") ? targetTab.title : `${targetTab.title}.tex`,
        filters: [{ name: "LaTeX Document", extensions: ["tex", "bib", "cls", "sty"] }]
      });
      if (result.canceled || !result.filePath) return;
      targetTab.filePath = result.filePath;
      targetTab.title = path.basename(result.filePath);
    }

    try {
      fs.writeFileSync(targetTab.filePath, targetTab.content, "utf8");
      updateTabDirty(targetTab.id, false);
      showNotification(i18n.t("notif_saved"), "info");
      renderTabs();

      if (!mainDocumentPath && targetTab.filePath.endsWith(".tex")) {
        setMainDocument(targetTab.filePath);
      }

      if (config.autoCompile) {
        triggerCompile();
      }
    } catch (err) {
      showNotification("Errore nel salvataggio: " + err.message, "error");
    }
  }

  async function saveFileAs() {
    const targetTab = getActiveTab();
    if (!targetTab) return;
    saveActiveTabState();
    try {
      const result = await dialog.showSaveDialog({
        title: "Salva file LaTeX con nome",
        defaultPath: targetTab.filePath || (targetTab.title.endsWith(".tex") ? targetTab.title : `${targetTab.title}.tex`),
        filters: [{ name: "LaTeX Document", extensions: ["tex", "bib", "cls", "sty"] }]
      });
      if (result.canceled || !result.filePath) return;
      targetTab.filePath = result.filePath;
      targetTab.title = path.basename(result.filePath);
      fs.writeFileSync(targetTab.filePath, targetTab.content, "utf8");
      updateTabDirty(targetTab.id, false);
      showNotification(i18n.t("notif_saved"), "info");
      renderTabs();
    } catch (err) {
      showNotification("Errore nel salvataggio: " + err.message, "error");
    }
  }

  async function openFileDialog() {
    try {
      const result = await dialog.showOpenDialog({
        title: "Apri file LaTeX",
        filters: [{ name: "LaTeX Documents", extensions: ["tex", "bib", "cls", "sty"] }],
        properties: ["openFile", "multiSelections"]
      });
      if (!result.canceled && result.filePaths.length > 0) {
        for (const fp of result.filePaths) {
          openFileFromPath(fp);
        }
      }
    } catch (err) {
      showNotification("Errore apertura file: " + err.message, "error");
    }
  }

  async function openFolderDialog() {
    try {
      const result = await dialog.showOpenDialog({
        title: "Apri cartella progetto LaTeX",
        properties: ["openDirectory"]
      });
      if (!result.canceled && result.filePaths.length > 0) {
        openFolder(result.filePaths[0]);
      }
    } catch (err) {
      showNotification("Errore apertura cartella: " + err.message, "error");
    }
  }

  function cleanAuxiliaryFiles() {
    const targetDir = currentProjectDir || (mainDocumentPath ? path.dirname(mainDocumentPath) : null);
    if (!targetDir || !fs.existsSync(targetDir)) {
      showNotification("Nessuna cartella di progetto aperta per pulire i file ausiliari.", "warning");
      return;
    }
    const auxExts = [".aux", ".out", ".toc", ".fls", ".fdb_latexmk", ".nav", ".snm", ".vrb", ".synctex.gz", ".bbl", ".blg"];
    let count = 0;
    try {
      const files = fs.readdirSync(targetDir);
      for (const file of files) {
        if (auxExts.some(ext => file.endsWith(ext))) {
          try {
            fs.unlinkSync(path.join(targetDir, file));
            count++;
          } catch (_) {}
        }
      }
      showNotification(`Pulizia completata: rimossi ${count} file ausiliari.`, "info");
    } catch (err) {
      showNotification("Errore pulizia file ausiliari: " + err.message, "error");
    }
  }

  async function downloadPdf() {
    if (!currentCompiledPdfPath || !fs.existsSync(currentCompiledPdfPath)) {
      showNotification("Nessun PDF compilato disponibile. Compila prima il documento.", "warning");
      return;
    }
    try {
      const res = await dialog.showSaveDialog({
        title: "Salva/Esporta PDF",
        defaultPath: path.basename(currentCompiledPdfPath),
        filters: [{ name: "PDF Document", extensions: ["pdf"] }]
      });
      if (!res.canceled && res.filePath) {
        fs.copyFileSync(currentCompiledPdfPath, res.filePath);
        showNotification("PDF esportato con successo!", "info");
      }
    } catch (err) {
      showNotification("Errore esportazione PDF: " + err.message, "error");
    }
  }

  function openSaveTemplateModal() {
    const tab = getActiveTab();
    if (!tab || !tab.content.trim()) {
      showNotification("Nessun contenuto da salvare come template.", "warning");
      return;
    }
    const name = prompt("Nome del template:");
    if (!name || !name.trim()) return;
    const desc = prompt("Descrizione del template:") || "Template personalizzato";
    const newTpl = {
      id: "custom-" + Date.now(),
      title: name.trim(),
      description: desc.trim(),
      category: "custom",
      categoryLabel: "Personalizzati",
      isCustom: true,
      content: tab.content
    };
    if (LackTemplates && LackTemplates.saveCustomTemplate) {
      LackTemplates.saveCustomTemplate(newTpl);
      showNotification(`Template "${newTpl.title}" salvato con successo!`, "info");
    }
  }

  // ====== LINE NUMBERS & CURSOR COUNTERS ======
  function updateLineNumbers() {
    const text = editor.value;
    const lines = text.split("\n");
    const count = lines.length;

    let numbersHtml = "";
    for (let i = 1; i <= count; i++) {
      const hasError = latestIssues.some(iss => iss.type === "error" && iss.line === i);
      numbersHtml += `<span class="editor-gutter-line ${hasError ? 'has-error' : ''}">${i}</span>`;
    }
    editorLineNumbers.innerHTML = numbersHtml;
  }

  function updateCursorCounters() {
    const pos = editor.selectionStart;
    const text = editor.value.substring(0, pos);
    const lines = text.split("\n");
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;

    lineColCounter.textContent = `Ln ${line}, Col ${col}`;

    // Word count
    const words = editor.value.trim().split(/\s+/).filter(w => w.length > 0).length;
    wordCountEl.textContent = i18n.t("word_count", { count: words });
  }

  editor.addEventListener("scroll", () => {
    editorLineNumbers.scrollTop = editor.scrollTop;
  });

  editor.addEventListener("keyup", updateCursorCounters);
  editor.addEventListener("click", updateCursorCounters);

  // Auto-indentation & Smart formatting
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const spaces = " ".repeat(config.tabSize);
      editor.value = editor.value.substring(0, start) + spaces + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + config.tabSize;
      onEditorContentChange();
    } else if (e.key === "Enter") {
      // Auto indent previous line
      const pos = editor.selectionStart;
      const textBefore = editor.value.substring(0, pos);
      const lines = textBefore.split("\n");
      const lastLine = lines[lines.length - 1];
      const indentMatch = lastLine.match(/^(\s+)/);
      let indent = indentMatch ? indentMatch[1] : "";

      if (lastLine.trim().startsWith("\\begin{") && !lastLine.includes("\\end{")) {
        indent += "  ";
      }

      if (indent.length > 0) {
        e.preventDefault();
        const textAfter = editor.value.substring(pos);
        editor.value = textBefore + "\n" + indent + textAfter;
        editor.selectionStart = editor.selectionEnd = pos + 1 + indent.length;
        onEditorContentChange();
      }
    } else if (e.key === "{" && !e.ctrlKey && !e.altKey) {
      // Auto close braces
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      e.preventDefault();
      editor.value = editor.value.substring(0, start) + "{" + selected + "}" + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 1;
      onEditorContentChange();
    } else if (e.key === "$" && !e.ctrlKey && !e.altKey) {
      // Auto close dollar
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      e.preventDefault();
      editor.value = editor.value.substring(0, start) + "$" + selected + "$" + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 1;
      onEditorContentChange();
    }
  });

  const debouncedAutoCompile = debounce(() => {
    if (config.autoCompile) {
      triggerCompile();
    }
  }, 1600);

  function onEditorContentChange() {
    const tab = getActiveTab();
    if (tab) {
      tab.content = editor.value;
      updateTabDirty(tab.id, true);
    }
    updateLineNumbers();
    updateCursorCounters();

    if (config.autoSave && tab && tab.filePath) {
      saveFile(tab);
    }

    debouncedAutoCompile();
  }

  editor.addEventListener("input", onEditorContentChange);

  // ====== WRAP SELECTION HELPER (FIXES LOSS OF WORDS) ======
  function wrapSelection(prefix, suffix) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.substring(start, end);
    const before = editor.value.substring(0, start);
    const after = editor.value.substring(end);

    editor.value = before + prefix + selected + suffix + after;
    editor.selectionStart = start + prefix.length;
    editor.selectionEnd = start + prefix.length + selected.length;
    editor.focus();
    onEditorContentChange();
  }

  // ====== TOOLBAR LATEX INSERT ACTIONS ======
  document.getElementById("btn-bold").onclick = () => wrapSelection("\\textbf{", "}");
  document.getElementById("btn-italic").onclick = () => wrapSelection("\\textit{", "}");
  document.getElementById("btn-underline").onclick = () => wrapSelection("\\underline{", "}");
  document.getElementById("btn-code").onclick = () => wrapSelection("\\texttt{", "}");
  document.getElementById("btn-math-inline").onclick = () => wrapSelection("$", "$");
  document.getElementById("btn-math-display").onclick = () => wrapSelection("\\[\n  ", "\n\\]");
  document.getElementById("btn-fraction").onclick = () => wrapSelection("\\frac{", "}{denominator}");
  document.getElementById("btn-sqrt").onclick = () => wrapSelection("\\sqrt{", "}");

  // ====== TOOLBAR DROPDOWNS & PALETTES ======
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

  // Greek palette click handlers
  document.querySelectorAll(".greek-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = item.dataset.symbol;
      wrapSelection(sym, "");
      closeAllToolbarDropdowns();
    });
  });

  // Sections dropdown actions
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

  // Environments & Extra actions
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

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.titlebar-menu-dropdown')) {
      closeAllTitlebarMenus();
    }
    if (!e.target.closest('#dropdown-title') && !e.target.closest('#dropdown-greek') && !e.target.closest('#dropdown-extra')) {
      closeAllToolbarDropdowns();
    }
    const popup = document.getElementById('new-file-popup');
    if (popup && !popup.classList.contains('hidden')) {
      if (!e.target.closest('#new-file-popup') && !e.target.closest('#new-file')) {
        popup.classList.add('hidden');
      }
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isAnyTitlebarMenuOpen) closeAllTitlebarMenus();
      closeAllToolbarDropdowns();
      document.getElementById('new-file-popup')?.classList.add('hidden');
    }
  });

  // Titlebar Menu Item Actions
  document.querySelectorAll('.titlebar-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      if (!action) return;
      closeAllTitlebarMenus();

      switch (action) {
        case 'new-file':
          newFile();
          break;
        case 'open-file':
          openFileDialog();
          break;
        case 'open-folder':
          openFolderDialog();
          break;
        case 'save-file':
          saveFile();
          break;
        case 'save-as-template':
          openSaveTemplateModal();
          break;
        case 'choose-template':
          openTemplateGallery();
          break;
        case 'export-pdf':
          downloadPdf();
          break;
        case 'open-settings':
          settingsModal.classList.remove('hidden');
          break;
        case 'close-tab':
          if (activeTabId) closeTab(activeTabId);
          break;
        case 'quit-app':
          ipcRenderer.send('window-close');
          break;
        case 'undo':
          document.execCommand('undo');
          break;
        case 'redo':
          document.execCommand('redo');
          break;
        case 'cut':
          document.execCommand('cut');
          break;
        case 'copy':
          document.execCommand('copy');
          break;
        case 'paste':
          try {
            const clipText = clipboard.readText();
            if (clipText) wrapSelection(clipText, "");
          } catch (_) {
            document.execCommand('paste');
          }
          break;
        case 'select-all':
          editor.select();
          break;
        case 'find':
          document.getElementById('search-container')?.classList.remove('hidden');
          document.getElementById('search-input')?.focus();
          break;
        case 'trigger-compile':
          triggerCompile();
          break;
        case 'toggle-logs':
          logsDrawer.classList.toggle('hidden');
          break;
        case 'clean-aux':
          cleanAuxiliaryFiles();
          break;
        case 'toggle-explorer':
          document.getElementById('explorer-panel')?.classList.toggle('hidden');
          break;
        case 'view-editor':
          btnSoloEditor.click();
          break;
        case 'view-split':
          btnSplitView.click();
          break;
        case 'view-preview':
          btnSoloPreview.click();
          break;
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
        case 'set-theme-light':
          applyTheme('light');
          break;
        case 'set-theme-dark':
          applyTheme('dark');
          break;
        case 'set-theme-github':
          applyTheme('github');
          break;
      }
    });
  });

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

  async function triggerCompile() {
    if (isCompiling) return;
    const tab = getActiveTab();
    if (!tab && !mainDocumentPath) return;

    isCompiling = true;
    btnRecompile.classList.add("compiling");
    compileStatusDot.className = "compile-status-dot compiling";

    // Determine target file to compile
    let targetPath = mainDocumentPath || (tab ? tab.filePath : null);
    let contentToPass = tab ? tab.content : (targetPath && fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : "");

    const compileOpts = {
      filePath: targetPath,
      content: contentToPass,
      projectDir: currentProjectDir,
      engine: config.engine,
      customEnginePath: config.customEnginePath,
      cleanAux: config.cleanAux
    };

    try {
      const res = await ipcRenderer.invoke('compile-latex', compileOpts);
      isCompiling = false;
      btnRecompile.classList.remove("compiling");

      latestIssues = res.issues || [];
      renderLogIssues(latestIssues, res.log);

      if (res.success && res.pdfPath && fs.existsSync(res.pdfPath)) {
        currentCompiledPdfPath = res.pdfPath;
        compileStatusDot.className = "compile-status-dot";
        loadPdfInViewer(res.pdfPath);
        showNotification(i18n.t("notif_compiled_ok", { time: (res.durationMs / 1000).toFixed(1) }), "info");
      } else if (res.isBuiltin && res.htmlPreview) {
        // Builtin engine HTML render
        compileStatusDot.className = "compile-status-dot";
        renderBuiltinPreview(res.htmlPreview);
        showNotification("Anteprima veloce renderizzata con successo", "info");
      } else {
        compileStatusDot.className = "compile-status-dot error";
        showNotification(i18n.t("notif_compiled_fail"), "error");
        // Auto open logs on error
        logsDrawer.classList.remove("hidden");
      }
      updateLineNumbers();
    } catch (err) {
      isCompiling = false;
      btnRecompile.classList.remove("compiling");
      compileStatusDot.className = "compile-status-dot error";
      showNotification("Errore di compilazione: " + err.message, "error");
    }
  }

  btnRecompile.onclick = triggerCompile;
  document.getElementById("btn-placeholder-compile").onclick = triggerCompile;

  function loadPdfInViewer(pdfPathUrl) {
    pdfEmptyPlaceholder.classList.add("hidden");
    livePreviewEl.classList.add("hidden");
    pdfFrame.classList.remove("hidden");
    pdfFrame.src = `file://${pdfPathUrl}#toolbar=0&navpanes=0&scrollbar=1&zoom=${pdfZoomPercent}`;
  }

  function renderBuiltinPreview(htmlContent) {
    pdfEmptyPlaceholder.classList.add("hidden");
    pdfFrame.classList.add("hidden");
    livePreviewEl.classList.remove("hidden");
    livePreviewEl.innerHTML = htmlContent;

    if (window.renderMathInElement) {
      window.renderMathInElement(livePreviewEl, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false }
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
      item.innerHTML = `
        <span class="log-issue-line-badge">${iss.file || 'main.tex'}${iss.line ? ':' + iss.line : ''}</span>
        <span class="log-issue-msg">${escapeHtml(iss.message)}</span>
      `;
      item.addEventListener("click", () => {
        if (iss.line) {
          jumpToLine(iss.line);
        }
      });
      logsIssuesList.appendChild(item);
    });
  }

  function jumpToLine(lineNumber) {
    const lines = editor.value.split("\n");
    if (lineNumber <= 0 || lineNumber > lines.length) return;

    let pos = 0;
    for (let i = 0; i < lineNumber - 1; i++) {
      pos += lines[i].length + 1;
    }

    editor.focus();
    editor.selectionStart = pos;
    editor.selectionEnd = pos + lines[lineNumber - 1].length;

    // Scroll line into view
    const lineHeight = 22;
    editor.scrollTop = Math.max(0, (lineNumber - 4) * lineHeight);
  }

  btnToggleLogs.onclick = () => {
    logsDrawer.classList.toggle("hidden");
  };
  document.getElementById("btn-close-logs").onclick = () => {
    logsDrawer.classList.add("hidden");
  };
  document.getElementById("btn-clear-logs").onclick = () => {
    latestIssues = [];
    renderLogIssues([], "");
    updateLineNumbers();
  };

  // Log drawer tabs
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

  // ====== PDF TOOLBAR ACTIONS ======
  document.getElementById("pdf-btn-zoom-in").onclick = () => {
    pdfZoomPercent = Math.min(300, pdfZoomPercent + 15);
    document.getElementById("pdf-zoom-val").textContent = `${pdfZoomPercent}%`;
    if (currentCompiledPdfPath) loadPdfInViewer(currentCompiledPdfPath);
  };
  document.getElementById("pdf-btn-zoom-out").onclick = () => {
    pdfZoomPercent = Math.max(40, pdfZoomPercent - 15);
    document.getElementById("pdf-zoom-val").textContent = `${pdfZoomPercent}%`;
    if (currentCompiledPdfPath) loadPdfInViewer(currentCompiledPdfPath);
  };
  document.getElementById("pdf-btn-download").onclick = async () => {
    if (!currentCompiledPdfPath || !fs.existsSync(currentCompiledPdfPath)) {
      showNotification("Nessun PDF compilato da scaricare.", "warning");
      return;
    }
    const res = await dialog.showSaveDialog({
      title: "Salva documento PDF",
      defaultPath: path.basename(currentCompiledPdfPath),
      filters: [{ name: "PDF Document", extensions: ["pdf"] }]
    });
    if (!res.canceled && res.filePath) {
      fs.copyFileSync(currentCompiledPdfPath, res.filePath);
      showNotification("PDF salvato con successo!", "info");
    }
  };
  document.getElementById("pdf-btn-refresh").onclick = triggerCompile;

  // ====== FILE SYSTEM EXPLORER ======
  const fileTreeEl = document.getElementById("file-tree");
  const folderPathEl = document.getElementById("folder-path");

  async function openFolder(folderPath) {
    if (!fs.existsSync(folderPath)) return;
    currentProjectDir = folderPath;
    folderPathEl.textContent = path.basename(folderPath);
    folderPathEl.classList.remove("hidden");

    // Scan for main.tex in folder
    const potentialMain = path.join(folderPath, "main.tex");
    if (fs.existsSync(potentialMain)) {
      setMainDocument(potentialMain);
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

    // Sort: directories first, then files alphabetically
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

        // Context menu to set as main document
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

  // Explorer action buttons
  const newFileBtn = document.getElementById("new-file");
  const newFilePopup = document.getElementById("new-file-popup");
  const btnCloseNewFilePopup = document.getElementById("btn-close-new-file-popup");
  const btnPopupBrowseAll = document.getElementById("btn-popup-browse-all");

  newFileBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    newFilePopup?.classList.toggle("hidden");
  });

  btnCloseNewFilePopup?.addEventListener("click", (e) => {
    e.stopPropagation();
    newFilePopup?.classList.add("hidden");
  });

  btnPopupBrowseAll?.addEventListener("click", (e) => {
    e.stopPropagation();
    newFilePopup?.classList.add("hidden");
    openTemplateGallery();
  });

  document.querySelectorAll(".new-file-popup-item").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const templateId = btn.dataset.templateId;
      if (!templateId) return;
      newFilePopup?.classList.add("hidden");
      if (templateId === "blank") {
        newFile();
      } else {
        const t = LackTemplates?.getAllTemplates().find(x => x.id === templateId);
        newFile(t ? t.content : null);
      }
    });
  });

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
    const folderName = prompt("Nome della nuova cartella:");
    if (folderName && folderName.trim()) {
      const newPath = path.join(currentProjectDir, folderName.trim());
      try {
        fs.mkdirSync(newPath, { recursive: true });
        renderFileTree(currentProjectDir);
        showNotification(`Cartella "${folderName.trim()}" creata con successo!`, "info");
      } catch (err) {
        showNotification("Errore creazione cartella: " + err.message, "error");
      }
    }
  });

  document.getElementById("open-folder")?.addEventListener("click", async () => {
    openFolderDialog();
  });

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

  // Explorer Resizer
  const explorerPanelEl = document.getElementById("explorer-panel");
  const explorerResizerEl = document.getElementById("explorer-resizer");
  if (explorerResizerEl && explorerPanelEl) {
    let isResizing = false;

    explorerResizerEl.addEventListener("mousedown", (e) => {
      isResizing = true;
      document.body.style.cursor = "ew-resize";
      explorerResizerEl.classList.add("is-resizing");
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      let newWidth = e.clientX;
      if (newWidth < 150) newWidth = 150;
      if (newWidth > window.innerWidth * 0.7) newWidth = window.innerWidth * 0.7;
      explorerPanelEl.style.width = newWidth + "px";
      document.documentElement.style.setProperty("--explorer-width", newWidth + "px");
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

    filtered.forEach(t => {
      const card = document.createElement("div");
      card.className = "template-card";
      card.innerHTML = `
        <div class="template-card-category-pill">${escapeHtml(t.categoryLabel || t.category)}</div>
        <h4 class="template-card-title">${escapeHtml(t.title)}</h4>
        <p class="template-card-desc">${escapeHtml(t.description)}</p>
        <div class="template-card-footer">
          <button class="template-btn-preview collab-tab">Anteprima</button>
          <button class="template-btn-use collab-submit-btn">Usa Template</button>
        </div>
      `;

      card.querySelector(".template-btn-preview").onclick = () => showTemplatePreview(t);
      card.querySelector(".template-btn-use").onclick = () => useTemplate(t);
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

  document.getElementById("template-search-input").addEventListener("input", (e) => {
    const val = e.target.value.trim();
    renderTemplateCards("all", val);
  });

  document.querySelectorAll(".template-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".template-nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderTemplateCards(btn.dataset.category);
    });
  });

  document.getElementById("btn-preview-rendered").onclick = () => {
    document.getElementById("btn-preview-rendered").classList.add("active");
    document.getElementById("btn-preview-source").classList.remove("active");
    document.getElementById("preview-rendered-body").classList.remove("hidden");
    document.getElementById("preview-source-body").classList.add("hidden");
  };

  document.getElementById("btn-preview-source").onclick = () => {
    document.getElementById("btn-preview-source").classList.add("active");
    document.getElementById("btn-preview-rendered").classList.remove("active");
    document.getElementById("preview-source-body").classList.remove("hidden");
    document.getElementById("preview-rendered-body").classList.add("hidden");
  };

  // ====== COLLABORATION MODAL ======
  const collabModal = document.getElementById("collab-modal");
  const collabStatusPill = document.getElementById("collab-status-container");
  const collabStatusText = document.getElementById("collab-status-text");

  document.getElementById("btn-collab").onclick = () => {
    const state = getCollabState();
    if (state.isActive) {
      document.getElementById("collab-disconnected-view").classList.add("hidden");
      document.getElementById("collab-connected-view").classList.remove("hidden");
      document.getElementById("collab-active-room-id").value = state.roomId;
      document.getElementById("collab-users-count").textContent = state.connectedUsers;
    } else {
      document.getElementById("collab-disconnected-view").classList.remove("hidden");
      document.getElementById("collab-connected-view").classList.add("hidden");
      document.getElementById("collab-new-room-id").value = generateRoomId();
    }
    collabModal.classList.remove("hidden");
  };

  document.getElementById("btn-close-collab").onclick = () => collabModal.classList.add("hidden");
  document.getElementById("collab-overlay").onclick = () => collabModal.classList.add("hidden");

  document.getElementById("tab-btn-create").onclick = () => {
    document.getElementById("tab-btn-create").classList.add("active");
    document.getElementById("tab-btn-join").classList.remove("active");
    document.getElementById("collab-pane-create").classList.remove("hidden");
    document.getElementById("collab-pane-join").classList.add("hidden");
  };

  document.getElementById("tab-btn-join").onclick = () => {
    document.getElementById("tab-btn-join").classList.add("active");
    document.getElementById("tab-btn-create").classList.remove("active");
    document.getElementById("collab-pane-join").classList.remove("hidden");
    document.getElementById("collab-pane-create").classList.add("hidden");
  };

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
      editor: editor,
      isJoining: false,
      onRemoteUpdate: () => onEditorContentChange(),
      onUsersChange: (count) => {
        document.getElementById("collab-users-count").textContent = count;
        collabStatusText.textContent = `${count} online (${roomId})`;
      },
      onStatusChange: (status) => {
        collabStatusPill.classList.remove("hidden");
        collabStatusText.textContent = `${status} (${roomId})`;
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
      editor: editor,
      isJoining: true,
      onRemoteUpdate: () => onEditorContentChange(),
      onUsersChange: (count) => {
        document.getElementById("collab-users-count").textContent = count;
        collabStatusText.textContent = `${count} online (${roomId})`;
      },
      onStatusChange: (status) => {
        collabStatusPill.classList.remove("hidden");
        collabStatusText.textContent = `${status} (${roomId})`;
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

  // Settings tabs
  document.querySelectorAll(".settings-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".settings-nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".settings-tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPane = document.getElementById(`pane-settings-${btn.dataset.settingsTab}`);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // Settings theme switches
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
    editor.style.fontSize = `${config.fontSize}px`;
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
  toggleAutoCompileEl.checked = config.autoCompile;
  toggleAutoCompileEl.addEventListener("change", (e) => {
    config.autoCompile = e.target.checked;
    localStorage.setItem("lack-autoCompile", config.autoCompile);
  });

  const toggleCleanAuxEl = document.getElementById("toggle-clean-aux");
  toggleCleanAuxEl.checked = config.cleanAux;
  toggleCleanAuxEl.addEventListener("change", (e) => {
    config.cleanAux = e.target.checked;
    localStorage.setItem("lack-cleanAux", config.cleanAux);
  });

  // ====== VIEW MODES (SOLO EDITOR, SPLIT, SOLO PREVIEW) ======
  const btnSoloEditor = document.getElementById("btn-view-editor");
  const btnSplitView = document.getElementById("btn-view-split");
  const btnSoloPreview = document.getElementById("btn-view-preview");

  function setViewMode(mode) {
    mainStageContainer.classList.remove("split-view", "solo-editor", "solo-preview");
    mainStageContainer.classList.add(mode);
    btnSoloEditor?.classList.toggle("active", mode === "solo-editor");
    btnSplitView?.classList.toggle("active", mode === "split-view");
    btnSoloPreview?.classList.toggle("active", mode === "solo-preview");
  }

  btnSoloEditor.onclick = () => setViewMode("solo-editor");
  btnSplitView.onclick = () => setViewMode("split-view");
  btnSoloPreview.onclick = () => setViewMode("solo-preview");

  ipcRenderer.on("toggle-editor-view", () => setViewMode("solo-editor"));
  ipcRenderer.on("set-split-view", () => setViewMode("split-view"));
  ipcRenderer.on("toggle-preview-view", () => setViewMode("solo-preview"));

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
        triggerCompile();
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
  ipcRenderer.on("trigger-compile", () => triggerCompile());
  ipcRenderer.on("toggle-logs", () => logsDrawer.classList.toggle("hidden"));
  ipcRenderer.on("choose-template", () => openTemplateGallery());
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

  // Empty state buttons
  document.getElementById("empty-btn-new-file").onclick = () => newFile();
  document.getElementById("empty-btn-open-file").onclick = () => {
    dialog.showOpenDialog({
      filters: [{ name: "LaTeX Documents", extensions: ["tex", "bib", "cls", "sty"] }]
    }).then(res => {
      if (!res.canceled && res.filePaths.length > 0) openFileFromPath(res.filePaths[0]);
    });
  };
  document.getElementById("empty-btn-open-folder").onclick = () => {
    dialog.showOpenDialog({ properties: ["openDirectory"] }).then(res => {
      if (!res.canceled && res.filePaths.length > 0) openFolder(res.filePaths[0]);
    });
  };
  document.getElementById("empty-btn-templates").onclick = () => openTemplateGallery();
  document.getElementById("btn-new-tab").onclick = () => newFile();

  // Initial tab
  newFile();
});
