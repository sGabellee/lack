const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

(async () => {
  const tmpUserData = path.join('/tmp', `lack-test-search-${Date.now()}`);
  fs.mkdirSync(tmpUserData, { recursive: true });

  const artifactsDir = '/home/sgabelli/.gemini/antigravity/brain/cc8b937e-eec6-4cb7-b5c6-66c7804be4f5';

  console.log('[TEST] Launching Electron to verify Document Search (Ctrl+F) and Project Search...');
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

    // 1. Create a new document with repeating occurrences of a word
    await page.evaluate(() => {
      window.__lackNewFile();
    });
    await page.waitForTimeout(600);

    const testLatex = [
      '\\documentclass{article}',
      '\\begin{document}',
      '\\section{Quantum Mechanics}',
      'Quantum algorithms provide exponential speedup.',
      'A quantum computer leverages superposition.',
      'End of quantum document.',
      '\\end{document}'
    ].join('\n');

    await page.evaluate((text) => {
      window.cm.setValue(text);
    }, testLatex);
    await page.waitForTimeout(300);

    // 2. Test In-Document Search (Ctrl+F)
    console.log('[TEST] Testing In-Document Search (Ctrl+F)...');
    // Focus editor first
    const cmContent = page.locator('.cm-content');
    await cmContent.click();
    await page.waitForTimeout(200);

    // Trigger Ctrl+F via keyboard
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(400);

    const isSearchVisible = await page.evaluate(() => {
      const container = document.getElementById('search-container');
      const input = document.getElementById('search-input');
      return {
        isOpen: container && !container.classList.contains('hidden'),
        isInputFocused: document.activeElement === input
      };
    });

    console.log('[TEST] In-document search open state:', isSearchVisible);
    assert.ok(isSearchVisible.isOpen, '#search-container must be visible after Ctrl+F');
    assert.ok(isSearchVisible.isInputFocused, '#search-input must be focused after Ctrl+F');

    // Type 'quantum'
    await page.locator('#search-input').fill('quantum');
    await page.waitForTimeout(300);

    let searchResultText = await page.locator('#search-results').innerText();
    console.log('[TEST] Search results counter after typing "quantum":', searchResultText);
    assert.ok(searchResultText.includes('/4'), `Expected /4 matches, got: ${searchResultText}`);

    // Click Next
    await page.locator('#search-next').click();
    await page.waitForTimeout(200);
    searchResultText = await page.locator('#search-results').innerText();
    console.log('[TEST] Search results counter after Next:', searchResultText);
    assert.equal(searchResultText, '2/4');

    // Click Previous
    await page.locator('#search-prev').click();
    await page.waitForTimeout(200);
    searchResultText = await page.locator('#search-results').innerText();
    console.log('[TEST] Search results counter after Prev:', searchResultText);
    assert.equal(searchResultText, '1/4');

    // Screenshot of in-document search
    const screenshotDocSearch = path.join(artifactsDir, 'verify_doc_search_ctrl_f.png');
    await page.screenshot({ path: screenshotDocSearch });
    console.log('[TEST] Saved screenshot to:', screenshotDocSearch);

    // Press Escape to close search
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const isSearchClosed = await page.evaluate(() => {
      const container = document.getElementById('search-container');
      return container && container.classList.contains('hidden');
    });
    assert.ok(isSearchClosed, '#search-container must be hidden after Escape');
    console.log('[TEST] In-document search successfully dismissed on Escape');

    // 3. Test Project-Wide Search (Ctrl+Shift+F)
    console.log('[TEST] Testing Project-Wide Search (Ctrl+Shift+F)...');

    // Create a second file so project search has multiple files
    await page.evaluate(() => {
      window.__lackNewFile();
    });
    await page.waitForTimeout(500);

    const secondLatex = [
      '\\section{Appendix}',
      'Additional notes on quantum error correction.',
      'Quantum supremacy experiments.'
    ].join('\n');

    await page.evaluate((text) => {
      window.cm.setValue(text);
    }, secondLatex);
    await page.waitForTimeout(300);

    // Trigger Ctrl+Shift+F via keyboard
    await page.keyboard.press('Control+Shift+F');
    await page.waitForTimeout(500);

    const isProjectSearchOpen = await page.evaluate(() => {
      const drawer = document.getElementById('logs-drawer');
      const pane = document.getElementById('logs-search-pane');
      const tab = document.getElementById('tab-log-search');
      const input = document.getElementById('project-search-input');
      return {
        drawerOpen: drawer && !drawer.classList.contains('hidden'),
        paneActive: pane && pane.classList.contains('active'),
        tabActive: tab && tab.classList.contains('active'),
        isInputFocused: document.activeElement === input
      };
    });

    console.log('[TEST] Project search open state:', isProjectSearchOpen);
    assert.ok(isProjectSearchOpen.drawerOpen, 'Logs drawer must be open');
    assert.ok(isProjectSearchOpen.paneActive, '#logs-search-pane must be active');
    assert.ok(isProjectSearchOpen.tabActive, '#tab-log-search tab must be active');
    assert.ok(isProjectSearchOpen.isInputFocused, '#project-search-input must be focused');

    // Type 'quantum' in project search input
    await page.locator('#project-search-input').fill('quantum');
    await page.locator('#btn-project-search-run').click();
    await page.waitForTimeout(500);

    const projectResultsInfo = await page.evaluate(() => {
      const summary = document.getElementById('project-search-summary')?.innerText || '';
      const badge = document.getElementById('drawer-search-count')?.innerText || '';
      const fileGroups = document.querySelectorAll('.project-search-file-group').length;
      const resultItems = document.querySelectorAll('.project-search-item').length;
      return { summary, badge, fileGroups, resultItems };
    });

    console.log('[TEST] Project search results info:', projectResultsInfo);
    assert.equal(projectResultsInfo.fileGroups, 2, 'Should find matches across 2 files');
    assert.equal(projectResultsInfo.resultItems, 6, 'Total 6 matches (4 in first doc, 2 in second doc)');
    assert.equal(projectResultsInfo.badge, '6', 'Badge count should show 6');
    assert.ok(projectResultsInfo.summary.includes('6 corrispondenze'), `Summary should mention 6 matches: ${projectResultsInfo.summary}`);

    // Click on a result item from the first file to test navigation
    console.log('[TEST] Clicking result item from first file to verify tab navigation and line jumping...');
    await page.locator('.project-search-file-group >> nth=0 >> .project-search-item >> nth=0').click();
    await page.waitForTimeout(400);

    // Verify cursor / line in editor
    const navState = await page.evaluate(() => {
      const tab = window.__lackGetActiveTab();
      const sel = window.cm.getSelection();
      const lineCol = document.getElementById('line-col-counter')?.innerText || '';
      return {
        tabTitle: tab ? tab.title : '',
        selection: sel,
        lineCol
      };
    });
    console.log('[TEST] After navigation state:', navState);
    assert.ok(navState.selection.toLowerCase().includes('quantum'), `Selection should contain "quantum", got: ${navState.selection}`);

    // Screenshot of project search
    const screenshotProjSearch = path.join(artifactsDir, 'verify_project_search_drawer.png');
    await page.screenshot({ path: screenshotProjSearch });
    console.log('[TEST] Saved screenshot to:', screenshotProjSearch);

    console.log('[TEST] ALL SEARCH TESTS PASSED SUCCESSFULLY! ✅');
  } finally {
    await app.close();
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  }
})();
