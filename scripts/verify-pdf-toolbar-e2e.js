const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const tmpUserData = path.join('/tmp', `lack-test-tb-${Date.now()}`);
  fs.mkdirSync(tmpUserData, { recursive: true });

  console.log('[TEST] Launching Electron to verify PDF toolbar responsiveness and SyncTeX pill...');
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

    // 1. Verify SyncTeX Pill position and styling
    const pillBox = await page.locator('#synctex-divider-control').boundingBox();
    const viewportBox = await page.locator('#pdf-viewport').boundingBox();
    console.log(`[TEST] SyncTeX pill box:`, pillBox);
    console.log(`[TEST] PDF viewport box:`, viewportBox);

    assert(pillBox, 'SyncTeX pill boundingBox must exist');
    assert(viewportBox, 'PDF viewport boundingBox must exist');

    // Pill top must be < viewport top (so it is docked above the document canvas in the toolbar/gutter header)
    assert(pillBox.y < viewportBox.y, `SyncTeX pill y (${pillBox.y}) must be above viewport y (${viewportBox.y})`);
    assert(pillBox.y + pillBox.height <= viewportBox.y, `SyncTeX pill bottom (${pillBox.y + pillBox.height}) must not overlap viewport (${viewportBox.y})`);
    console.log('[PASS] SyncTeX pill is positioned cleanly above PDF document canvas without overlap!');

    // 2. Full Width Toolbar (>= 560px)
    await page.evaluate(() => {
      const tb = document.getElementById('pdf-toolbar');
      if (tb) tb.style.width = '700px';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(400);

    const fitWidthVisibleFull = await page.locator('#pdf-btn-fit-width').isVisible();
    const fitPageVisibleFull = await page.locator('#pdf-btn-fit-page').isVisible();
    const dlVisibleFull = await page.locator('#pdf-btn-download').isVisible();
    const overflowVisibleFull = await page.locator('#pdf-btn-overflow').isVisible();

    console.log(`[TEST] Full width: fit-width=${fitWidthVisibleFull}, fit-page=${fitPageVisibleFull}, dl=${dlVisibleFull}, overflow=${overflowVisibleFull}`);
    assert(fitWidthVisibleFull && fitPageVisibleFull, 'Fit buttons must be visible at full width');
    assert(dlVisibleFull, 'Download button must be visible at full width');
    assert(!overflowVisibleFull, 'Overflow button ⋯ must be hidden when all items fit');
    console.log('[PASS] Full width toolbar verified!');

    // 3. Medium / Split Pane Width (~420px)
    await page.evaluate(() => {
      const tb = document.getElementById('pdf-toolbar');
      if (tb) tb.style.width = '420px';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(400);

    const fitWidthVisibleMid = await page.locator('#pdf-btn-fit-width').isVisible();
    const fitPageVisibleMid = await page.locator('#pdf-btn-fit-page').isVisible();
    const dlVisibleMid = await page.locator('#pdf-btn-download').isVisible();
    const overflowVisibleMid = await page.locator('#pdf-btn-overflow').isVisible();

    console.log(`[TEST] Mid width (420px): fit-width=${fitWidthVisibleMid}, fit-page=${fitPageVisibleMid}, dl=${dlVisibleMid}, overflow=${overflowVisibleMid}`);
    assert(fitWidthVisibleMid && fitPageVisibleMid, 'Fit buttons (↔ and ↕) MUST remain visible at mid width (420px)!');
    assert(!dlVisibleMid, 'Secondary button download should collapse into overflow at 420px');
    assert(overflowVisibleMid, 'Overflow button ⋯ must become visible when secondary items collapse');
    console.log('[PASS] Mid-width toolbar verified: fit controls stay visible, secondaries collapse to ⋯!');

    // 4. Click ⋯ overflow button to inspect popover
    await page.locator('#pdf-btn-overflow').click();
    await page.waitForTimeout(300);
    const dropdownVisible = await page.locator('#pdf-overflow-dropdown').isVisible();
    assert(dropdownVisible, 'Overflow dropdown must open on click');

    const menuDlVisible = await page.locator('#pdf-menu-download').isVisible();
    assert(menuDlVisible, 'Download option must be visible inside overflow dropdown');
    console.log('[PASS] Overflow dropdown opens cleanly and shows collapsed secondary actions!');

    // Save screenshot
    const artifactPath = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5/verify_pdf_toolbar_and_synctex.png';
    await page.screenshot({ path: artifactPath });
    console.log(`[TEST] Verification screenshot saved to ${artifactPath}`);

  } finally {
    await app.close();
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  }
})().then(() => {
  console.log('[SUCCESS] All PDF toolbar & SyncTeX pill checks passed!');
  process.exit(0);
}).catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
