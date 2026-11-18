const test = require('node:test');
const assert = require('assert');
const { windowChromeFor } = require('../src/main/window-chrome');

test('windowChromeFor: macOS native traffic lights when style is macos', () => {
  const chrome = windowChromeFor('darwin', 'macos');
  assert.strictEqual(chrome.browserWindowOptions.titleBarStyle, 'hidden');
  assert.deepStrictEqual(chrome.browserWindowOptions.trafficLightPosition, { x: 12, y: 12 });
  assert.strictEqual(chrome.nativeButtonsVisible, true);
  assert.strictEqual(chrome.customControls.visible, false);
});

test('windowChromeFor: macOS with windows or gnome style hides native traffic lights', () => {
  const chromeWin = windowChromeFor('darwin', 'windows');
  assert.strictEqual(chromeWin.nativeButtonsVisible, false);
  assert.strictEqual(chromeWin.customControls.visible, true);
  assert.strictEqual(chromeWin.customControls.style, 'windows');
  assert.strictEqual(chromeWin.customControls.position, 'right');

  const chromeGnome = windowChromeFor('darwin', 'gnome');
  assert.strictEqual(chromeGnome.nativeButtonsVisible, false);
  assert.strictEqual(chromeGnome.customControls.visible, true);
  assert.strictEqual(chromeGnome.customControls.style, 'gnome');
});

test('windowChromeFor: Linux returns custom controls for all styles', () => {
  const linuxGnome = windowChromeFor('linux', 'gnome');
  assert.strictEqual(linuxGnome.nativeButtonsVisible, false);
  assert.strictEqual(linuxGnome.customControls.visible, true);
  assert.strictEqual(linuxGnome.customControls.style, 'gnome');

  const linuxMac = windowChromeFor('linux', 'macos');
  assert.strictEqual(linuxMac.customControls.style, 'macos');
  assert.strictEqual(linuxMac.customControls.position, 'left');
});

test('windowChromeFor: Windows with windows style uses titleBarOverlay', () => {
  const winChrome = windowChromeFor('win32', 'windows');
  assert.strictEqual(winChrome.nativeButtonsVisible, true);
  assert.ok(winChrome.browserWindowOptions.titleBarOverlay);
});
