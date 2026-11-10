const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { darkHighlightStyle, lightHighlightStyle } = require('../src/editor/themes');

function hexToRgb(hex) {
  const clean = hex.replace(/^#/, '');
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function getLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function getContrastRatio(hex1, hex2) {
  const lum1 = getLuminance(hex1);
  const lum2 = getLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

test('"No pink" guard: fail if any foreground or CM color has hue in [295°, 345°] with lightness >= 55%', () => {
  // Read themes.css
  const themesCss = fs.readFileSync(path.join(__dirname, '../themes.css'), 'utf8');
  const hexMatches = themesCss.match(/#[0-9a-fA-F]{6}/g) || [];

  for (const hex of hexMatches) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const isPink = h >= 295 && h <= 345 && l >= 55;
    assert.strictEqual(isPink, false, `Forbidden pink token detected: ${hex} (H: ${h}°, L: ${l}%)`);
  }

  // Check dark highlight style tags in themes.js
  const darkTags = darkHighlightStyle.module ? darkHighlightStyle.specs : [];
  // Also check stringified rules
  const themesJs = fs.readFileSync(path.join(__dirname, '../src/editor/themes.js'), 'utf8');
  const darkMatches = themesJs.match(/color:\s*['"](#[0-9a-fA-F]{6})['"]/g) || [];
  for (const m of darkMatches) {
    const hex = m.match(/#[0-9a-fA-F]{6}/)[0];
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const isPink = h >= 295 && h <= 345 && l >= 55;
    assert.strictEqual(isPink, false, `Forbidden pink in themes.js: ${hex} (H: ${h}°, L: ${l}%)`);
  }
});

test('Grep test: no hardcoded forbidden pink hex colors outside themes.css', () => {
  const filesToCheck = [
    path.join(__dirname, '../style.css'),
    path.join(__dirname, '../src/editor/themes.js'),
    path.join(__dirname, '../renderer.js')
  ];

  for (const file of filesToCheck) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const hexes = content.match(/#[0-9a-fA-F]{6}/g) || [];
    for (const hex of hexes) {
      const { r, g, b } = hexToRgb(hex);
      const { h, s, l } = rgbToHsl(r, g, b);
      const isPink = h >= 295 && h <= 345 && l >= 55;
      assert.strictEqual(isPink, false, `Found hardcoded pink ${hex} in ${path.basename(file)}`);
    }
  }
});
test('Contrast test: --purple-text (#be76de) has >= 4.5:1 contrast against dark surfaces and white on --purple-solid (#80007f)', () => {
  const darkSurfaces = ['#1e1e1e', '#1f1f1f', '#252526', '#2a2a2a', '#0d1117', '#161b22'];
  const purpleText = '#be76de';
  const purpleSolid = '#80007f';

  for (const surface of darkSurfaces) {
    const ratio = getContrastRatio(purpleText, surface);
    assert.ok(ratio >= 4.5, `Expected >= 4.5 contrast for ${purpleText} on ${surface}, got ${ratio.toFixed(2)}`);
  }

  const whiteOnSolid = getContrastRatio('#ffffff', purpleSolid);
  assert.ok(whiteOnSolid >= 4.5, `Expected >= 4.5 contrast for #ffffff on ${purpleSolid}, got ${whiteOnSolid.toFixed(2)}`);
});
