// ====== LACK PDF.JS VIEWER MODULE ======
const path = require('path');
const fs = require('fs');

let pdfjsLib = null;
let currentPdfDoc = null;
let currentPdfOutline = null;
let containerEl = null;
let zoomLabelEl = null;
let pageInputEl = null;
let totalPagesEl = null;
let currentScale = 1.0;
let fitMode = null; // 'width' | 'page' | null
let onSyncTexCallback = null;
let renderedPages = new Map();
let isRendering = false;
let renderPending = false;

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

function getScrollContainer() {
  if (!containerEl) return null;
  if (containerEl.parentElement && (containerEl.parentElement.classList.contains('pdf-viewport') || containerEl.parentElement.id === 'pdf-viewport')) {
    return containerEl.parentElement;
  }
  return containerEl;
}

function initPdfViewer(elements = {}, callbacks = {}) {
  containerEl = elements.container;
  zoomLabelEl = elements.zoomLabel;
  pageInputEl = elements.pageInput;
  totalPagesEl = elements.totalPages;
  onSyncTexCallback = callbacks.onSyncTex;

  const scrollContainer = getScrollContainer();
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', onContainerScroll, { passive: true });
    scrollContainer.addEventListener('wheel', onContainerWheel, { passive: false });
  }

  if (containerEl && containerEl !== scrollContainer) {
    containerEl.addEventListener('wheel', onContainerWheel, { passive: false });
  }

  // Auto-refit on resize if fitMode is active
  const resizeTarget = scrollContainer || containerEl;
  if (resizeTarget && typeof ResizeObserver !== 'undefined') {
    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
      if (fitMode && currentPdfDoc && !isRendering) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (fitMode === 'width') autoFitWidth();
          else if (fitMode === 'page') autoFitPage();
        }, 120);
      }
    });
    ro.observe(resizeTarget);
  }

  if (pageInputEl) {
    pageInputEl.addEventListener('change', () => {
      const p = parseInt(pageInputEl.value, 10);
      if (!isNaN(p)) goToPage(p);
    });
  }
}

function updateFitButtonStates() {
  const btnFitWidth = document.getElementById('pdf-btn-fit-width');
  const btnFitPage = document.getElementById('pdf-btn-fit-page');
  if (btnFitWidth) btnFitWidth.classList.toggle('active', fitMode === 'width');
  if (btnFitPage) btnFitPage.classList.toggle('active', fitMode === 'page');
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

    try {
      currentPdfOutline = await currentPdfDoc.getOutline();
    } catch (_) {
      currentPdfOutline = null;
    }

    const numPages = currentPdfDoc.numPages;
    if (totalPagesEl) totalPagesEl.textContent = numPages;
    if (pageInputEl) {
      pageInputEl.max = numPages;
      pageInputEl.value = 1;
    }

    if (containerEl) containerEl.classList.remove('hidden');
    const placeholder = document.getElementById('pdf-empty-placeholder');
    if (placeholder) placeholder.classList.add('hidden');
    const livePreviewEl = document.getElementById('preview');
    if (livePreviewEl) livePreviewEl.classList.add('hidden');

    if (fitMode === 'width') {
      await autoFitWidth();
    } else if (fitMode === 'page') {
      await autoFitPage();
    } else {
      updateZoomLabel();
      updateFitButtonStates();
      await renderAllPages();
    }
    return true;
  } catch (err) {
    console.error('Failed to load PDF in PDF.js:', err);
    return false;
  }
}

async function renderAllPages() {
  if (!currentPdfDoc || !containerEl) return;
  if (isRendering) {
    renderPending = true;
    return;
  }
  isRendering = true;

  try {
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

      const annotationLayer = document.createElement('div');
      annotationLayer.className = 'pdf-annotation-layer';
      wrapper.appendChild(annotationLayer);

      containerEl.appendChild(wrapper);

      await renderPage(pageNum, canvas, textLayer, annotationLayer);
    }
  } finally {
    isRendering = false;
    if (renderPending) {
      renderPending = false;
      renderAllPages();
    }
  }
}

async function renderPage(pageNum, canvas, textLayerDiv, annotationLayerDiv) {
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

  // Render annotations layer (links, TOC, internal destinations, URLs)
  try {
    if (annotationLayerDiv) {
      await renderAnnotations(page, viewport, annotationLayerDiv);
    }
  } catch (e) {}

  renderedPages.set(pageNum, { canvas, textLayerDiv, annotationLayerDiv });
}

async function renderAnnotations(page, viewport, annotationLayerDiv) {
  annotationLayerDiv.innerHTML = '';
  annotationLayerDiv.style.width = `${viewport.width}px`;
  annotationLayerDiv.style.height = `${viewport.height}px`;

  try {
    const annotations = await page.getAnnotations();
    if (!annotations || annotations.length === 0) return;

    for (const a of annotations) {
      if (a.subtype !== 'Link') continue;
      if (!a.rect || a.rect.length < 4) continue;

      const p1 = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
      const p2 = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
      const left = Math.min(p1[0], p2[0]);
      const top = Math.min(p1[1], p2[1]);
      const width = Math.abs(p1[0] - p2[0]);
      const height = Math.abs(p1[1] - p2[1]);

      if (width < 2 || height < 2) continue;

      const linkEl = document.createElement('a');
      linkEl.className = 'link-annotation';
      linkEl.style.left = `${left}px`;
      linkEl.style.top = `${top}px`;
      linkEl.style.width = `${width}px`;
      linkEl.style.height = `${height}px`;

      if (a.url) {
        linkEl.href = a.url;
        linkEl.title = a.url;
        linkEl.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) {
            if (typeof onSyncTexCallback === 'function') {
              onSyncTexCallback({ page: page.pageNumber, text: a.overlaidText || a.url });
            }
            return;
          }
          e.preventDefault();
          try {
            const { shell } = require('electron');
            shell.openExternal(a.url);
          } catch (_) {
            window.open(a.url, '_blank');
          }
        });
      } else if (a.dest) {
        linkEl.title = typeof a.dest === 'string' ? a.dest : 'Vai alla destinazione';
        linkEl.addEventListener('click', async (e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) {
            if (typeof onSyncTexCallback === 'function') {
              onSyncTexCallback({ page: page.pageNumber, text: a.overlaidText || '' });
            }
            return;
          }
          e.preventDefault();
          await navigateToDestination(a.dest);
        });
      }

      annotationLayerDiv.appendChild(linkEl);
    }
  } catch (err) {
    console.warn('Failed to render PDF annotations:', err);
  }
}

async function navigateToDestination(dest) {
  if (!currentPdfDoc || !containerEl) return;
  try {
    let explicitDest = dest;
    if (typeof explicitDest === 'string') {
      explicitDest = await currentPdfDoc.getDestination(explicitDest);
    }
    if (!Array.isArray(explicitDest) || explicitDest.length === 0) return;

    let pageIndex = -1;
    const ref = explicitDest[0];
    if (typeof ref === 'number') {
      pageIndex = ref;
    } else if (ref && typeof ref === 'object') {
      pageIndex = await currentPdfDoc.getPageIndex(ref);
    }

    if (pageIndex < 0) return;
    const targetPageNum = pageIndex + 1;
    const wrapper = containerEl.querySelector(`.pdf-page-wrapper[data-page-num="${targetPageNum}"]`);
    if (!wrapper) return;

    let offsetY = 0;
    // Inspect destination parameters for y-coordinate
    for (let i = 1; i < explicitDest.length; i++) {
      if (typeof explicitDest[i] === 'number' && explicitDest[i] > 0) {
        const yCoord = explicitDest[i];
        try {
          const targetPage = await currentPdfDoc.getPage(targetPageNum);
          const targetViewport = targetPage.getViewport({ scale: currentScale });
          const pt = targetViewport.convertToViewportPoint(0, yCoord);
          if (pt && typeof pt[1] === 'number') {
            offsetY = Math.max(0, pt[1] - 30);
          }
        } catch (_) {}
        break;
      }
    }

    const scrollContainer = getScrollContainer();
    const scrollTarget = wrapper.offsetTop + offsetY;
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    } else {
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (pageInputEl) {
      pageInputEl.value = targetPageNum;
    }
  } catch (err) {
    console.warn('Failed to navigate to PDF destination:', err);
  }
}

function findOutlineDest(outlineItems, searchTitle) {
  if (!outlineItems || !Array.isArray(outlineItems)) return null;
  const clean = searchTitle.toLowerCase().trim();
  for (const item of outlineItems) {
    if (item.title && item.title.toLowerCase().trim().includes(clean)) {
      return item.dest;
    }
    if (item.items && item.items.length > 0) {
      const nested = findOutlineDest(item.items, searchTitle);
      if (nested) return nested;
    }
  }
  return null;
}

async function goToSection(sectionTitle) {
  if (!sectionTitle || !currentPdfDoc || !containerEl) return false;

  // 1. Check PDF outline (bookmarks)
  if (currentPdfOutline) {
    const dest = findOutlineDest(currentPdfOutline, sectionTitle);
    if (dest) {
      await navigateToDestination(dest);
      return true;
    }
  }

  // 2. Check rendered text layer spans
  const clean = sectionTitle.toLowerCase().trim();
  const scrollContainer = getScrollContainer();
  for (const [pageNum, pageData] of renderedPages.entries()) {
    if (!pageData || !pageData.textLayerDiv) continue;
    const spans = pageData.textLayerDiv.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent && span.textContent.toLowerCase().includes(clean)) {
        const wrapper = containerEl.querySelector(`.pdf-page-wrapper[data-page-num="${pageNum}"]`);
        if (wrapper) {
          const scrollTarget = Math.max(0, wrapper.offsetTop + span.offsetTop - 30);
          if (scrollContainer) {
            scrollContainer.scrollTo({ top: scrollTarget, behavior: 'smooth' });
          } else {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          if (pageInputEl) pageInputEl.value = pageNum;
          return true;
        }
      }
    }
  }
  return false;
}

function updateZoomLabel() {
  if (zoomLabelEl) {
    zoomLabelEl.textContent = `${Math.round(currentScale * 100)}%`;
  }
}

async function autoFitWidth() {
  if (!currentPdfDoc || !containerEl) return;
  fitMode = 'width';
  updateFitButtonStates();
  const curPage = pageInputEl ? parseInt(pageInputEl.value, 10) || 1 : 1;
  const page = await currentPdfDoc.getPage(curPage || 1);
  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const scrollContainer = getScrollContainer();
  const availableWidth = (scrollContainer ? scrollContainer.clientWidth : containerEl.clientWidth) - 40;
  if (availableWidth > 0) {
    currentScale = Math.max(0.4, Math.min(3.0, availableWidth / unscaledViewport.width));
    updateZoomLabel();
    await reRenderVisiblePages();
    goToPage(curPage, false);
  }
}

async function autoFitPage() {
  if (!currentPdfDoc || !containerEl) return;
  fitMode = 'page';
  updateFitButtonStates();
  const curPage = pageInputEl ? parseInt(pageInputEl.value, 10) || 1 : 1;
  const page = await currentPdfDoc.getPage(curPage || 1);
  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const scrollContainer = getScrollContainer();
  const availableHeight = (scrollContainer ? scrollContainer.clientHeight : containerEl.clientHeight) - 50;
  if (availableHeight > 0) {
    currentScale = Math.max(0.4, Math.min(3.0, availableHeight / unscaledViewport.height));
    updateZoomLabel();
    await reRenderVisiblePages();
    goToPage(curPage, false);
  }
}

async function zoomIn() {
  fitMode = null;
  updateFitButtonStates();
  currentScale = Math.min(3.0, currentScale + 0.15);
  updateZoomLabel();
  await reRenderVisiblePages();
}

async function zoomOut() {
  fitMode = null;
  updateFitButtonStates();
  currentScale = Math.max(0.4, currentScale - 0.15);
  updateZoomLabel();
  await reRenderVisiblePages();
}

async function resetZoom() {
  fitMode = null;
  updateFitButtonStates();
  currentScale = 1.0;
  updateZoomLabel();
  await reRenderVisiblePages();
}

async function reRenderVisiblePages() {
  if (!currentPdfDoc) return;
  await renderAllPages();
}

function onContainerScroll() {
  const scrollContainer = getScrollContainer();
  if (!scrollContainer || !currentPdfDoc || !containerEl) return;
  const wrappers = containerEl.querySelectorAll('.pdf-page-wrapper');
  const containerTop = scrollContainer.scrollTop;
  const containerMid = containerTop + scrollContainer.clientHeight / 3;

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

function goToPage(pageNum, smooth = true) {
  if (!containerEl || !currentPdfDoc) return;
  const target = Math.max(1, Math.min(pageNum, currentPdfDoc.numPages));
  const wrapper = containerEl.querySelector(`.pdf-page-wrapper[data-page-num="${target}"]`);
  if (wrapper) {
    wrapper.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
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
  prevPage,
  goToSection,
  navigateToDestination
};
