const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const tmpUserData = path.join('/tmp', `lack-test-zoom-notif-${Date.now()}`);
  fs.mkdirSync(tmpUserData, { recursive: true });
  const artifactsDir = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5';

  console.log('[TEST] Launching Electron to verify singleton zoom notifications...');
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

    // Focus explorer (not preview) so UI zoom runs
    await page.click('#explorer-panel');
    await page.waitForTimeout(150);

    // 1. Spam Ctrl++ and Ctrl+- repeatedly
    console.log('[TEST] Pressing Ctrl+= 6 times rapidly and Ctrl+- 3 times...');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Control+Equal');
      await page.waitForTimeout(45);
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+Minus');
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(150);

    const stateAfterKeys = await page.evaluate(() => {
      const container = document.getElementById('notification-container');
      const items = container ? Array.from(container.querySelectorAll('.cloud-notification')) : [];
      return {
        count: items.length,
        texts: items.map((el) => el.innerText.trim()),
        rect: items[0] ? items[0].getBoundingClientRect().toJSON() : null,
        vw: window.innerWidth,
        vh: window.innerHeight
      };
    });

    console.log('[TEST] Notifications after rapid Ctrl+ / Ctrl-:', stateAfterKeys);
    assert.strictEqual(stateAfterKeys.count, 1, `Expected strictly 1 notification, got ${stateAfterKeys.count}`);
    assert.strictEqual(stateAfterKeys.texts[0], 'Zoom: 130%');
    assert.ok(stateAfterKeys.rect.right <= stateAfterKeys.vw && stateAfterKeys.rect.bottom <= stateAfterKeys.vh, 'Notification must remain within viewport');

    // 2. Test Settings modal zoom buttons too
    await page.click('#btn-options');
    await page.waitForTimeout(200);
    await page.click('#btn-zoom-out');
    await page.click('#btn-zoom-out');
    await page.waitForTimeout(150);
    await page.click('#btn-close-settings');
    await page.waitForTimeout(150);

    const stateAfterSettings = await page.evaluate(() => {
      const container = document.getElementById('notification-container');
      const items = container ? Array.from(container.querySelectorAll('.cloud-notification')) : [];
      return {
        count: items.length,
        texts: items.map((el) => el.innerText.trim())
      };
    });
    console.log('[TEST] Notifications after Settings zoom buttons:', stateAfterSettings);
    assert.strictEqual(stateAfterSettings.count, 1);
    assert.strictEqual(stateAfterSettings.texts[0], 'Zoom: 110%');

    // 3. Test click-dismiss mid-fade replacement
    await page.click('.cloud-notification');
    await page.waitForTimeout(50); // mid 320ms fade-out
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(200);

    const stateAfterReset = await page.evaluate(() => {
      const container = document.getElementById('notification-container');
      const items = container ? Array.from(container.querySelectorAll('.cloud-notification')) : [];
      return {
        count: items.length,
        texts: items.map((el) => el.innerText.trim())
      };
    });
    console.log('[TEST] Notifications after mid-fade Ctrl+0 reset:', stateAfterReset);
    assert.strictEqual(stateAfterReset.count, 1, 'Dismissing toast must be removed immediately before reset toast');
    assert.strictEqual(stateAfterReset.texts[0], 'Zoom: 100%');

    // Screenshot at 100% zoom shows exact bottom-right toast placement
    const screenshotPath = path.join(artifactsDir, 'verify_zoom_notification_single.png');
    await page.screenshot({ path: screenshotPath });
    console.log('[TEST] Saved screenshot to:', screenshotPath);

    console.log('[TEST] ZOOM NOTIFICATION SINGLETON E2E PASSED! ✅');
  } finally {
    await app.close();
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  }
})();
