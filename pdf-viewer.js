// ====== LACK PDF.JS VIEWER MODULE ======
const path = require('path');
const fs = require('fs');

let pdfjsLib = null;
let currentPdfDoc = null;
let containerEl = null;
let zoomLabelEl = null;
let pageInputEl = null;
let totalPagesEl = null;
let currentScale = 1.0;
let fitMode = null; // 'width' | 'page' | null
let onSyncTexCallback = null;
let renderedPages = new Map();

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
    try {
      const workerPath = path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.mjs');
      if (fs.existsSync(workerPath)) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
      }
    } catch (e) {}
  }
  return pdfjsLib;
}

function initPdfViewer(elements = {}, callbacks = {}) {
  containerEl = elements.container;
  zoomLabelEl = elements.zoomLabel;
  pageInputEl = elements.pageInput;
  totalPagesEl = elements.totalPages;
  onSyncTexCallback = callbacks.onSyncTex;

  if (containerEl) {
    containerEl.addEventListener('scroll', onContainerScroll, { passive: true });
    containerEl.addEventListener('wheel', onContainerWheel, { passive: false });
  }

  if (pageInputEl) {
    pageInputEl.addEventListener('change', () => {
      const p = parseInt(pageInputEl.value, 10);
      if (!isNaN(p)) goToPage(p);
    });
  }
}

async function loadPdfDocument(pdfPathOrBytes) {
  const lib = await getPdfJs();

  let data;
  if (typeof pdfPathOrBytes === 'string') {
    if (!fs.existsSync(pdfPathOrBytes)) return false;
    data = new Uint8Array(fs.readFileSync(pdfPathOrBytes));
  } else {
    data = new Uint8Array(pdfPathOrBytes);
  }

  try {
    const loadingTask = lib.getDocument({ data });
    currentPdfDoc = await loadingTask.promise;

    const numPages = currentPdfDoc.numPages;
    if (totalPagesEl) totalPagesEl.textContent = numPages;
    if (pageInputEl) {
      pageInputEl.max = numPages;
      pageInputEl.value = 1;
    }

    if (fitMode === 'width') {
      await autoFitWidth();
    } else if (fitMode === 'page') {
      await autoFitPage();
    } else {
      updateZoomLabel();
    }

    await renderAllPages();
    return true;
  } catch (err) {
    console.error('Failed to load PDF in PDF.js:', err);
    return false;
  }
}

async function renderAllPages() {
  if (!currentPdfDoc || !containerEl) return;
  containerEl.innerHTML = '';
  renderedPages.clear();

  const numPages = currentPdfDoc.numPages;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrapper';
    wrapper.dataset.pageNum = pageNum;

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    wrapper.appendChild(canvas);

    const textLayer = document.createElement('div');
    textLayer.className = 'pdf-text-layer';
    wrapper.appendChild(textLayer);

    containerEl.appendChild(wrapper);

    await renderPage(pageNum, canvas, textLayer);
  }
}

async function renderPage(pageNum, canvas, textLayerDiv) {
  if (!currentPdfDoc) return;
  const page = await currentPdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: currentScale });

  const outputScale = window.devicePixelRatio || 1;

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(outputScale, outputScale);

  await page.render({
    canvasContext: ctx,
    viewport
  }).promise;

  ctx.restore();

  // Render text layer
  try {
    const textContent = await page.getTextContent();
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;

    textContent.items.forEach((item) => {
      if (!item.str) return;
      const span = document.createElement('span');
      span.textContent = item.str;
      const tx = item.transform[4];
      const ty = item.transform[5];
      span.style.left = `${tx * (viewport.width / page.view[2])}px`;
      span.style.top = `${viewport.height - ty * (viewport.height / page.view[3]) - (item.height * currentScale)}px`;
      span.style.fontSize = `${item.height * currentScale}px`;

      // SyncTeX reverse click
      span.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) {
          if (typeof onSyncTexCallback === 'function') {
            onSyncTexCallback({
              page: pageNum,
              text: item.str
            });
          }
        }
      });

      textLayerDiv.appendChild(span);
    });
  } catch (e) {}

  renderedPages.set(pageNum, { canvas, textLayerDiv });
}

function updateZoomLabel() {
  if (zoomLabelEl) {
    zoomLabelEl.textContent = `${Math.round(currentScale * 100)}%`;
  }
}

async function autoFitWidth() {
  if (!currentPdfDoc || !containerEl) return;
  fitMode = 'width';
  const page = await currentPdfDoc.getPage(1);
  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const containerWidth = containerEl.clientWidth - 48;
  if (containerWidth > 0) {
    currentScale = Math.max(0.4, Math.min(3.0, containerWidth / unscaledViewport.width));
    updateZoomLabel();
  }
}

async function autoFitPage() {
  if (!currentPdfDoc || !containerEl) return;
  fitMode = 'page';
  const page = await currentPdfDoc.getPage(1);
  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const containerHeight = containerEl.clientHeight - 64;
  if (containerHeight > 0) {
    currentScale = Math.max(0.4, Math.min(3.0, containerHeight / unscaledViewport.height));
    updateZoomLabel();
  }
}

async function zoomIn() {
  fitMode = null;
  currentScale = Math.min(3.0, currentScale + 0.15);
  updateZoomLabel();
  await reRenderVisiblePages();
}

async function zoomOut() {
  fitMode = null;
  currentScale = Math.max(0.4, currentScale - 0.15);
  updateZoomLabel();
  await reRenderVisiblePages();
}

async function resetZoom() {
  fitMode = null;
  currentScale = 1.0;
  updateZoomLabel();
  await reRenderVisiblePages();
}

async function reRenderVisiblePages() {
  if (!currentPdfDoc) return;
  await renderAllPages();
}

function onContainerScroll() {
  if (!containerEl || !currentPdfDoc) return;
  const wrappers = containerEl.querySelectorAll('.pdf-page-wrapper');
  const containerTop = containerEl.scrollTop;
  const containerMid = containerTop + containerEl.clientHeight / 3;

  for (let i = 0; i < wrappers.length; i++) {
    const w = wrappers[i];
    if (w.offsetTop <= containerMid && (w.offsetTop + w.offsetHeight) > containerMid) {
      const pageNum = parseInt(w.dataset.pageNum, 10);
      if (pageInputEl && parseInt(pageInputEl.value, 10) !== pageNum) {
        pageInputEl.value = pageNum;
      }
      break;
    }
  }
}

function onContainerWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else {
      zoomOut();
    }
  }
}

function goToPage(pageNum) {
  if (!containerEl || !currentPdfDoc) return;
  const target = Math.max(1, Math.min(pageNum, currentPdfDoc.numPages));
  const wrapper = containerEl.querySelector(`.pdf-page-wrapper[data-page-num="${target}"]`);
  if (wrapper) {
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (pageInputEl) pageInputEl.value = target;
  }
}

function nextPage() {
  const cur = pageInputEl ? parseInt(pageInputEl.value, 10) || 1 : 1;
  goToPage(cur + 1);
}

function prevPage() {
  const cur = pageInputEl ? parseInt(pageInputEl.value, 10) || 1 : 1;
  goToPage(cur - 1);
}

module.exports = {
  initPdfViewer,
  loadPdfDocument,
  zoomIn,
  zoomOut,
  resetZoom,
  autoFitWidth,
  autoFitPage,
  goToPage,
  nextPage,
  prevPage
};
