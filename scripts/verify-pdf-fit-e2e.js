const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const tmpUserData = path.join('/tmp', `lack-test-fit-${Date.now()}`);
  fs.mkdirSync(tmpUserData, { recursive: true });

  const testPdf = '/home/sgabelli/gpu_prog/progetto/presentazione.pdf';
  assert(fs.existsSync(testPdf), `Test PDF must exist at ${testPdf}`);

  console.log('[TEST] Launching Electron to verify PDF Fit to Width and Fit to Page...');
  const app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: {
      ...process.env,
      LACK_USER_DATA: tmpUserData,
      NODE_ENV: 'test'
    }
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Open a new document to activate the split view (#container)
    await page.evaluate(() => window.__lackNewFile());
    await page.waitForTimeout(600);

    // Load test PDF into pdfViewer
    console.log('[TEST] Loading PDF document:', testPdf);
    const loaded = await page.evaluate(async (pdfPath) => {
      const viewer = window.__lackPdfViewer;
      if (!viewer) return false;
      return await viewer.loadPdfDocument(pdfPath);
    }, testPdf);

    assert(loaded, 'PDF must load successfully in pdfViewer');
    await page.waitForTimeout(1200);

    // 1. TEST FIT TO WIDTH (↔)
    console.log('[TEST] Testing Fit to Width (↔)...');
    await page.click('#pdf-btn-fit-width');
    await page.waitForTimeout(600);

    const fitWidthResult = await page.evaluate(() => {
      const container = document.getElementById('pdf-canvas-container');
      const viewport = document.getElementById('pdf-viewport');
      const canvas = container.querySelector('.pdf-page-canvas');
      const wrapper = container.querySelector('.pdf-page-wrapper');
      const zoomText = document.getElementById('pdf-zoom-level')?.textContent;

      const viewportRect = viewport.getBoundingClientRect();
      const canvasRect = canvas ? canvas.getBoundingClientRect() : null;
      const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : null;

      return {
        hasWidthClass: container.classList.contains('fit-mode-width'),
        viewportClientWidth: viewport.clientWidth,
        canvasWidth: canvasRect ? canvasRect.width : 0,
        wrapperWidth: wrapperRect ? wrapperRect.width : 0,
        zoomText
      };
    });

    console.log('[TEST] Fit to width result:', fitWidthResult);
    assert(fitWidthResult.hasWidthClass, 'container must have fit-mode-width class');
    assert(
      Math.abs(fitWidthResult.canvasWidth - fitWidthResult.viewportClientWidth) <= 4,
      `Canvas width (${fitWidthResult.canvasWidth}) must match viewport clientWidth (${fitWidthResult.viewportClientWidth}) within 4px for flush borders`
    );
    console.log('[PASS] Fit to Width stretches canvas flush edge-to-edge!');

    const fitWidthScreenshot = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5/verify_fit_width.png';
    await page.screenshot({ path: fitWidthScreenshot });
    console.log('[PASS] Saved fit-width screenshot to:', fitWidthScreenshot);

    // 2. TEST FIT TO PAGE (↕)
    console.log('[TEST] Testing Fit to Page (↕)...');
    await page.click('#pdf-btn-fit-page');
    await page.waitForTimeout(600);

    const fitPageResult = await page.evaluate(() => {
      const container = document.getElementById('pdf-canvas-container');
      const viewport = document.getElementById('pdf-viewport');
      const wrappers = Array.from(container.querySelectorAll('.pdf-page-wrapper'));
      const zoomText = document.getElementById('pdf-zoom-level')?.textContent;

      const viewportRect = viewport.getBoundingClientRect();
      const w1Rect = wrappers[0] ? wrappers[0].getBoundingClientRect() : null;
      const w2Rect = wrappers[1] ? wrappers[1].getBoundingClientRect() : null;

      return {
        hasPageClass: container.classList.contains('fit-mode-page'),
        viewportHeight: viewport.clientHeight,
        w1Height: w1Rect ? w1Rect.height : 0,
        w1Top: w1Rect ? w1Rect.top - viewportRect.top : 0,
        w2Top: w2Rect ? w2Rect.top - viewportRect.top : 0,
        zoomText
      };
    });

    console.log('[TEST] Fit to page result:', fitPageResult);
    assert(fitPageResult.hasPageClass, 'container must have fit-mode-page class');
    assert(
      fitPageResult.w2Top >= fitPageResult.viewportHeight - 20,
      `Page 2 top (${fitPageResult.w2Top}) must be at or below viewport height (${fitPageResult.viewportHeight}) so it does not bleed under page 1`
    );
    console.log('[PASS] Fit to Page frames page 1 cleanly with page 2 offscreen!');

    const fitPageScreenshot = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5/verify_fit_page.png';
    await page.screenshot({ path: fitPageScreenshot });
    console.log('[PASS] Saved fit-page screenshot to:', fitPageScreenshot);

    // 3. TEST ZOOM IN / OUT CLEARS FIT MODE
    console.log('[TEST] Testing Manual Zoom clearing fitMode...');
    await page.click('#pdf-btn-zoom-in');
    await page.waitForTimeout(400);

    const manualZoomResult = await page.evaluate(() => {
      const container = document.getElementById('pdf-canvas-container');
      const btnWidth = document.getElementById('pdf-btn-fit-width');
      const btnPage = document.getElementById('pdf-btn-fit-page');
      return {
        hasWidthClass: container.classList.contains('fit-mode-width'),
        hasPageClass: container.classList.contains('fit-mode-page'),
        widthBtnActive: btnWidth?.classList.contains('active'),
        pageBtnActive: btnPage?.classList.contains('active')
      };
    });

    assert(!manualZoomResult.hasWidthClass && !manualZoomResult.hasPageClass, 'Classes must be removed on manual zoom');
    assert(!manualZoomResult.widthBtnActive && !manualZoomResult.pageBtnActive, 'Fit buttons must be inactive on manual zoom');
    console.log('[PASS] Manual zoom cleanly deactivates fit modes!');

    // 4. TEST SOLO PREVIEW MODE (MAXIMIZED, LIKE GOOGLE CHROME)
    console.log('[TEST] Testing Solo Preview mode (maximized like Google Chrome)...');
    await page.click('#btn-view-preview');
    await page.waitForTimeout(600);

    // Fit to Page in Solo Preview
    await page.click('#pdf-btn-fit-page');
    await page.waitForTimeout(600);
    const soloPageScreenshot = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5/verify_fit_page_solo.png';
    await page.screenshot({ path: soloPageScreenshot });
    console.log('[PASS] Saved solo fit-page screenshot to:', soloPageScreenshot);

    // Fit to Width in Solo Preview
    await page.click('#pdf-btn-fit-width');
    await page.waitForTimeout(600);
    const soloWidthScreenshot = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5/verify_fit_width_solo.png';
    await page.screenshot({ path: soloWidthScreenshot });
    console.log('[PASS] Saved solo fit-width screenshot to:', soloWidthScreenshot);

    console.log('[ALL VERIFICATIONS PASSED SUCCESSFULLY]');
  } finally {
    await app.close();
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  }
})();
