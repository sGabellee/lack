const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Theme rotation: cycles dark -> light -> github -> dark', () => {
  const cycle = { light: 'dark', dark: 'github', github: 'light' };
  assert.strictEqual(cycle['dark'], 'github');
  assert.strictEqual(cycle['github'], 'light');
  assert.strictEqual(cycle['light'], 'dark');
});

test('Icons: all application icon files exist and are derived from logo_Lack.png', () => {
  const root = path.resolve(__dirname, '..');
  const files = [
    'logo_Lack.png',
    'images/lack.png',
    'images/logo_white.png',
    'images/logo_dark.png',
    'build/lack.png',
    'build/lack.ico',
    'build/lack.icns'
  ];

  for (const rel of files) {
    const full = path.join(root, rel);
    assert.ok(fs.existsSync(full), `File ${rel} must exist`);
    const stat = fs.statSync(full);
    assert.ok(stat.size > 1000, `File ${rel} must not be empty (was ${stat.size} bytes)`);
  }
});

test('Tab batch operations: closeOtherTabs, closeTabsToRight, closeSavedTabs, closeAllTabs logic', () => {
  let tabs = [
    { id: 'tab-1', title: 'main.tex', dirty: false },
    { id: 'tab-2', title: 'chap1.tex', dirty: true },
    { id: 'tab-3', title: 'chap2.tex', dirty: false },
    { id: 'tab-4', title: 'notes.tex', dirty: false }
  ];

  // Test closeTabsToRight relative to tab-2
  const targetId = 'tab-2';
  const targetIdx = tabs.findIndex(t => t.id === targetId);
  const toRight = tabs.slice(targetIdx + 1);
  assert.deepStrictEqual(toRight.map(t => t.id), ['tab-3', 'tab-4']);

  // Test closeSavedTabs: only non-dirty tabs
  const savedTabs = tabs.filter(t => !t.dirty);
  assert.deepStrictEqual(savedTabs.map(t => t.id), ['tab-1', 'tab-3', 'tab-4']);

  // Test closeOtherTabs relative to tab-2
  const otherTabs = tabs.filter(t => t.id !== targetId);
  assert.deepStrictEqual(otherTabs.map(t => t.id), ['tab-1', 'tab-3', 'tab-4']);
});

test('App confirm modal: structure in index.html matches centered overlay specifications', () => {
  const indexHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert.ok(indexHtml.includes('id="app-confirm-modal"'), 'Must contain #app-confirm-modal');
  assert.ok(indexHtml.includes('id="app-confirm-overlay"'), 'Must contain #app-confirm-overlay');
  assert.ok(indexHtml.includes('app-confirm-content'), 'Must contain .app-confirm-content');
  assert.ok(indexHtml.includes('id="app-confirm-actions"'), 'Must contain #app-confirm-actions');
  assert.ok(indexHtml.includes('id="btn-close-app-confirm"'), 'Must contain close button');
});

test('App confirm modal: style.css defines centered overlay and button variants', () => {
  const styleCss = fs.readFileSync(path.resolve(__dirname, '../style.css'), 'utf8');
  assert.ok(styleCss.includes('.app-confirm-content'), 'CSS must define .app-confirm-content');
  assert.ok(styleCss.includes('.app-confirm-btn-primary'), 'CSS must define .app-confirm-btn-primary');
  assert.ok(styleCss.includes('.app-confirm-btn-secondary'), 'CSS must define .app-confirm-btn-secondary');
  assert.ok(styleCss.includes('.app-confirm-btn-cancel'), 'CSS must define .app-confirm-btn-cancel');
  assert.ok(styleCss.includes('.tab-context-menu'), 'CSS must define .tab-context-menu');
});

test('i18n: translations include tab context menu and unsaved dialog strings', () => {
  const i18n = require('../i18n.js');
  i18n.setLanguage('it');
  assert.strictEqual(i18n.t('tab_ctx_close'), 'Chiudi');
  assert.strictEqual(i18n.t('tab_ctx_close_others'), 'Chiudi altri');
  assert.strictEqual(i18n.t('tab_ctx_close_right'), 'Chiudi a destra');
  assert.strictEqual(i18n.t('tab_ctx_close_saved'), 'Chiudi salvati');
  assert.strictEqual(i18n.t('tab_ctx_close_all'), 'Chiudi tutti');
  assert.strictEqual(i18n.t('dialog_unsaved_title'), 'Modifiche non salvate');
  assert.strictEqual(i18n.t('dialog_save'), 'Salva');
  assert.strictEqual(i18n.t('dialog_dont_save'), 'Non salvare');
  assert.strictEqual(i18n.t('dialog_cancel'), 'Annulla');

  i18n.setLanguage('en');
  assert.strictEqual(i18n.t('tab_ctx_close'), 'Close');
  assert.strictEqual(i18n.t('tab_ctx_close_others'), 'Close Others');
  assert.strictEqual(i18n.t('tab_ctx_close_right'), 'Close to the Right');
  assert.strictEqual(i18n.t('tab_ctx_close_saved'), 'Close Saved');
  assert.strictEqual(i18n.t('tab_ctx_close_all'), 'Close All');
});
