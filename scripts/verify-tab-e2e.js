const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const tmpUserData = path.join('/tmp', `lack-test-tab-${Date.now()}`);
  fs.mkdirSync(tmpUserData, { recursive: true });

  console.log('[TEST] Launching Electron to verify Tab key behavior in editor...');
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

    // Open a new document
    await page.evaluate(() => window.__lackNewFile());
    await page.waitForTimeout(600);

    // Focus editor
    const cmContent = page.locator('.cm-content');
    await cmContent.click();
    await page.waitForTimeout(200);

    // Clear existing text and set simple test text
    await page.evaluate(() => {
      const cm = window.cm;
      cm.setValue('item');
      cm.view.dispatch({ selection: { anchor: 4 } }); // cursor right after 'item'
    });
    await page.waitForTimeout(200);

    // Press Tab
    console.log('[TEST] Pressing Tab inside editor text...');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Check editor content and active element
    const tabResult = await page.evaluate(() => {
      const activeEl = document.activeElement;
      const isEditorFocused = activeEl && (activeEl.classList.contains('cm-content') || activeEl.closest('.cm-editor'));
      const text = window.cm.getValue();
      const tagName = activeEl ? activeEl.tagName : 'NONE';
      const className = activeEl ? activeEl.className : '';
      return {
        isEditorFocused,
        activeElTag: tagName,
        activeElClass: className,
        text
      };
    });

    console.log('[TEST] Result after Tab:', tabResult);
    assert(tabResult.isEditorFocused, `Focus must remain in editor, instead activeElement is <${tabResult.activeElTag} class="${tabResult.activeElClass}">`);
    assert(tabResult.text.includes('\t') || tabResult.text.includes('  '), `Text must contain tab/indentation, got: ${JSON.stringify(tabResult.text)}`);
    console.log('[PASS] Tab inserted indentation and did NOT shift focus to buttons!');

    // Test multi-line block indent
    await page.evaluate(() => {
      window.cm.setValue('line1\nline2\nline3');
    });
    // Select all and press Tab
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    const multilineResult = await page.evaluate(() => {
      return {
        text: window.cm.getValue(),
        isEditorFocused: document.activeElement && document.activeElement.classList.contains('cm-content')
      };
    });

    console.log('[TEST] Multi-line indent result:', multilineResult);
    assert(multilineResult.isEditorFocused, 'Editor must retain focus after multi-line Tab');
    assert(multilineResult.text.startsWith('  ') || multilineResult.text.startsWith('\t'), 'All lines must be indented');
    console.log('[PASS] Multi-line Tab indent works properly without losing focus!');

    // Test Shift-Tab (unindent)
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);

    const unindentResult = await page.evaluate(() => {
      return {
        text: window.cm.getValue(),
        isEditorFocused: document.activeElement && document.activeElement.classList.contains('cm-content')
      };
    });
    console.log('[TEST] Shift-Tab unindent result:', unindentResult);
    assert(unindentResult.isEditorFocused, 'Editor must retain focus after Shift+Tab');
    assert(unindentResult.text.startsWith('line1'), 'Shift-Tab must unindent back to start');
    console.log('[PASS] Shift-Tab unindent works properly without losing focus!');

    console.log('[ALL TAB TESTS PASSED SUCCESSFULLY]');
  } finally {
    await app.close();
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  }
})();
