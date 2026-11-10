const test = require('node:test');
const assert = require('node:assert/strict');

function hexToRgb(hex) {
  const clean = hex.replace(/^#/, '');
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function getLuminance(rgb) {
  const a = [rgb.r, rgb.g, rgb.b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function blendAlpha(fgHex, alpha, bgHex) {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  return {
    r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
    g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
    b: Math.round(fg.b * alpha + bg.b * (1 - alpha))
  };
}

function getContrast(rgb1, rgb2) {
  const l1 = getLuminance(rgb1);
  const l2 = getLuminance(rgb2);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

test('Virtual Pane: Light theme text (#2e2e2e) on virtual bg (#80007f @ 7% over #ededed) contrast >= 4.5:1', () => {
  const bg = blendAlpha('#80007f', 0.07, '#ededed');
  const fg = hexToRgb('#2e2e2e');
  const ratio = getContrast(fg, bg);
  assert.ok(ratio >= 4.5, `Contrast ratio ${ratio} < 4.5`);
});

test('Virtual Pane: Dark theme text (#e0e0e0) on virtual bg (#d98cd9 @ 8% over #1f1f1f) contrast >= 4.5:1', () => {
  const bg = blendAlpha('#d98cd9', 0.08, '#1f1f1f');
  const fg = hexToRgb('#e0e0e0');
  const ratio = getContrast(fg, bg);
  assert.ok(ratio >= 4.5, `Contrast ratio ${ratio} < 4.5`);
});

test('Virtual Pane: GitHub theme text (#c9d1d9) on virtual bg (#d98cd9 @ 8% over #0d1117) contrast >= 4.5:1', () => {
  const bg = blendAlpha('#d98cd9', 0.08, '#0d1117');
  const fg = hexToRgb('#c9d1d9');
  const ratio = getContrast(fg, bg);
  assert.ok(ratio >= 4.5, `Contrast ratio ${ratio} < 4.5`);
});

test('Virtual Pane: Selected row active text (#ffffff) on solid purple (#80007f) contrast >= 4.5:1', () => {
  const bg = hexToRgb('#80007f');
  const fg = hexToRgb('#ffffff');
  const ratio = getContrast(fg, bg);
  assert.ok(ratio >= 4.5, `Contrast ratio ${ratio} < 4.5`);
});
