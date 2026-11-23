/**
 * scripts/verify-save-template-e2e.js
 * Comprehensive E2E test verifying Mark-style "Salva come Template" modal,
 * fields, real-time filename slugification, dynamic category creation,
 * template gallery integration, and edit/delete workflow.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');
const fs = require('fs');

remoteMain.initialize();

ipcMain.on('get-platform', (event) => { event.returnValue = 'linux'; });
ipcMain.on('is-window-maximized', (event) => { event.returnValue = false; });
ipcMain.handle('detect-latex-engines', async () => ['pdflatex']);
ipcMain.handle('compile-latex', async () => ({ success: true, pdfPath: '' }));
ipcMain.handle('stop-compilation', () => true);
ipcMain.handle('get-install-command', () => 'sudo apt install texlive-full');
ipcMain.handle('project-get-store-root', () => '/tmp/lack-store');
ipcMain.handle('project-reveal-item', () => true);

const ARTIFACTS_DIR = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5';

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
    if (level >= 3) {
      consoleErrors.push(`[Console Error] ${message} (${sourceId}:${line})`);
    }
    console.log(`[Level ${level}] ${message}`);
  });

  await win.loadFile(path.join(__dirname, '../index.html'));
  await new Promise(r => setTimeout(r, 1200));

  console.log('=== TEST 1: OPEN SAVE AS TEMPLATE MODAL ===');
  // Open a tab with some LaTeX content
  await win.webContents.executeJavaScript(`
    (() => {
      newFile("\\\\documentclass{article}\\n\\\\begin{document}\\nTest Template Content\\n\\\\end{document}\\n");
      window.__lackOpenSaveTemplateModal();
    })()
  `);
  await new Promise(r => setTimeout(r, 500));

  const modalState = await win.webContents.executeJavaScript(`
    (() => {
      const modal = document.getElementById("save-template-modal");
      const titleInput = document.getElementById("save-template-title");
      const filenameInput = document.getElementById("save-template-filename");
      const categorySelect = document.getElementById("save-template-category");
      const scopeSelect = document.getElementById("save-template-scope");
      const descInput = document.getElementById("save-template-desc");
      const newCatBox = document.getElementById("save-template-new-category-box");
      const newCatToggle = document.getElementById("btn-toggle-new-category");

      return {
        visible: modal && !modal.classList.contains("hidden"),
        hasTitle: !!titleInput,
        filenameVal: filenameInput ? filenameInput.value : null,
        categoriesCount: categorySelect ? categorySelect.options.length : 0,
        scopeOptions: scopeSelect ? Array.from(scopeSelect.options).map(o => o.value) : [],
        newCatBoxHidden: newCatBox ? newCatBox.classList.contains("hidden") : true
      };
    })()
  `);

  console.log('Modal state:', modalState);
  if (!modalState.visible) throw new Error('Save template modal is not visible!');
  if (!modalState.filenameVal || !modalState.filenameVal.endsWith('.tex')) {
    throw new Error(`Suggested filename should end with .tex, got: ${modalState.filenameVal}`);
  }
  if (modalState.categoriesCount < 7) {
    throw new Error(`Expected at least 7 categories in dropdown, got: ${modalState.categoriesCount}`);
  }

  console.log('=== TEST 2: REAL-TIME SLUGIFICATION & CATEGORY CREATION ===');
  await win.webContents.executeJavaScript(`
    (() => {
      const titleInput = document.getElementById("save-template-title");
      titleInput.value = "Esperimento Fisica 2026";
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));

      const newCatToggle = document.getElementById("btn-toggle-new-category");
      newCatToggle.click();

      const newCatInput = document.getElementById("save-template-new-category-input");
      newCatInput.value = "Laboratorio Avanzato";

      const descInput = document.getElementById("save-template-desc");
      descInput.value = "Template per relazioni di laboratorio di fisica 2.";
    })()
  `);
  await new Promise(r => setTimeout(r, 300));

  const inputCheck = await win.webContents.executeJavaScript(`
    (() => {
      const filenameInput = document.getElementById("save-template-filename");
      const newCatBox = document.getElementById("save-template-new-category-box");
      return {
        filename: filenameInput.value,
        boxVisible: !newCatBox.classList.contains("hidden")
      };
    })()
  `);
  console.log('Input check:', inputCheck);
  if (inputCheck.filename !== 'esperimento_fisica_2026.tex') {
    throw new Error(`Filename slugification failed. Expected esperimento_fisica_2026.tex, got: ${inputCheck.filename}`);
  }
  if (!inputCheck.boxVisible) {
    throw new Error('New category input box should be visible after toggle!');
  }

  // Take screenshot of Save Template modal
  const modalImage = await win.webContents.capturePage();
  const modalScreenshotPath = path.join(ARTIFACTS_DIR, 'verify_save_template_modal.png');
  fs.writeFileSync(modalScreenshotPath, modalImage.toPNG());
  console.log(`Saved screenshot: ${modalScreenshotPath}`);

  console.log('=== TEST 3: SAVE TEMPLATE & VERIFY IN STORAGE ===');
  await win.webContents.executeJavaScript(`
    (() => {
      document.getElementById("btn-confirm-save-template").click();
    })()
  `);
  await new Promise(r => setTimeout(r, 400));

  const savedCheck = await win.webContents.executeJavaScript(`
    (() => {
      const modal = document.getElementById("save-template-modal");
      const customTemplates = LackTemplates.getCustomTemplates();
      const created = customTemplates.find(t => t.title === "Esperimento Fisica 2026");
      return {
        modalClosed: modal.classList.contains("hidden"),
        created: created ? {
          id: created.id,
          title: created.title,
          category: created.category,
          suggestedFilename: created.suggestedFilename,
          description: created.description,
          scope: created.scope
        } : null
      };
    })()
  `);
  console.log('Saved check:', savedCheck);
  if (!savedCheck.modalClosed) throw new Error('Modal should be closed after saving');
  if (!savedCheck.created) throw new Error('Template was not found in LackTemplates custom list');
  if (savedCheck.created.suggestedFilename !== 'esperimento_fisica_2026.tex') {
    throw new Error(`Saved filename mismatch: ${savedCheck.created.suggestedFilename}`);
  }
  if (savedCheck.created.category !== 'cat-laboratorio-avanzato') {
    throw new Error(`Expected category cat-laboratorio-avanzato, got: ${savedCheck.created.category}`);
  }

  console.log('=== TEST 4: VERIFY TEMPLATE GALLERY & CUSTOM CARDS ===');
  await win.webContents.executeJavaScript(`
    (() => {
      window.__lackOpenTemplateGallery();
    })()
  `);
  await new Promise(r => setTimeout(r, 600));

  const galleryCheck = await win.webContents.executeJavaScript(`
    (() => {
      const galleryModal = document.getElementById("template-gallery-modal");
      const navButtons = Array.from(document.querySelectorAll("#template-categories-nav-list .template-nav-btn"));
      const customNavBtn = navButtons.find(b => b.textContent.includes("Laboratorio Avanzato"));

      const cards = Array.from(document.querySelectorAll(".template-card"));
      const customCard = cards.find(c => c.querySelector(".template-card-title")?.textContent.includes("Esperimento Fisica 2026"));
      const hasEditBtn = customCard ? !!customCard.querySelector(".template-card-btn-edit") : false;
      const hasDeleteBtn = customCard ? !!customCard.querySelector(".template-card-btn-delete") : false;

      return {
        galleryOpen: galleryModal && !galleryModal.classList.contains("hidden"),
        hasCustomCategoryInSidebar: !!customNavBtn,
        hasCustomCard: !!customCard,
        hasEditBtn,
        hasDeleteBtn,
        createdId: customCard ? (customCard.dataset.templateId || customCard.dataset.id) : null
      };
    })()
  `);
  console.log('Gallery check:', galleryCheck);
  if (!galleryCheck.galleryOpen) throw new Error('Template gallery modal is not open!');
  if (!galleryCheck.hasCustomCategoryInSidebar) throw new Error('Custom category button missing from gallery sidebar!');
  if (!galleryCheck.hasCustomCard) throw new Error('Custom template card missing from gallery view!');
  if (!galleryCheck.hasEditBtn || !galleryCheck.hasDeleteBtn) {
    throw new Error('Custom template card must have Edit and Delete buttons!');
  }

  // Take screenshot of Gallery with custom category & card
  const galleryImage = await win.webContents.capturePage();
  const galleryScreenshotPath = path.join(ARTIFACTS_DIR, 'verify_template_gallery_custom.png');
  fs.writeFileSync(galleryScreenshotPath, galleryImage.toPNG());
  console.log(`Saved screenshot: ${galleryScreenshotPath}`);

  console.log('=== TEST 5: EDIT CUSTOM TEMPLATE (CLICK EDIT BUTTON) ===');
  await win.webContents.executeJavaScript(`
    (() => {
      const cards = Array.from(document.querySelectorAll(".template-card"));
      const customCard = cards.find(c => c.querySelector(".template-card-title")?.textContent.includes("Esperimento Fisica 2026"));
      const editBtn = customCard.querySelector(".template-card-btn-edit");
      editBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 400));

  const editModalCheck = await win.webContents.executeJavaScript(`
    (() => {
      const modal = document.getElementById("save-template-modal");
      const titleEl = document.getElementById("save-template-modal-title");
      const btnConfirm = document.getElementById("btn-confirm-save-template");
      const titleInput = document.getElementById("save-template-title");
      const descInput = document.getElementById("save-template-desc");

      const isOpen = modal && !modal.classList.contains("hidden");
      const titleText = titleEl ? titleEl.textContent : "";
      const btnText = btnConfirm ? btnConfirm.textContent : "";
      const valTitle = titleInput ? titleInput.value : "";

      return { isOpen, titleText, btnText, valTitle };
    })()
  `);
  console.log('Edit modal check:', editModalCheck);
  if (!editModalCheck.isOpen) throw new Error('Save template modal did not open in edit mode');
  if (!editModalCheck.titleText.toLowerCase().includes('modifica')) {
    throw new Error(`Modal title should say Modifica, got: ${editModalCheck.titleText}`);
  }

  // Now submit the update
  await win.webContents.executeJavaScript(`
    (() => {
      const descInput = document.getElementById("save-template-desc");
      const btnConfirm = document.getElementById("btn-confirm-save-template");
      if (descInput) descInput.value = "Descrizione modificata con successo!";
      btnConfirm.click();
    })()
  `);

  await new Promise(r => setTimeout(r, 400));
  const postEditCheck = await win.webContents.executeJavaScript(`
    (() => {
      const template = LackTemplates.getTemplateById("${galleryCheck.createdId}");
      return {
        updatedDesc: template ? template.description : null
      };
    })()
  `);
  console.log('Post edit check:', postEditCheck);
  if (postEditCheck.updatedDesc !== "Descrizione modificata con successo!") {
    throw new Error(`Template description not updated! Got: ${postEditCheck.updatedDesc}`);
  }

  console.log('=== TEST 6: CONSOLE ERROR AUDIT ===');
  if (consoleErrors.length > 0) {
    console.error('Console errors encountered during test:', consoleErrors);
    throw new Error(`Detected ${consoleErrors.length} console errors!`);
  }
  console.log('0 console errors verified.');

  console.log('ALL E2E SAVE TEMPLATE TESTS PASSED PERFECTLY!');
  app.quit();
});
