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

test('Palette: light commands (#80007f) contrast on #ededed >= 4.5:1', () => {
  const ratio = getContrastRatio('#80007f', '#ededed');
  assert.ok(ratio >= 4.5, `Expected >= 4.5, got ${ratio}`);
});

test('Palette: light arguments (#0000CD) contrast on #ededed >= 4.5:1', () => {
  const ratio = getContrastRatio('#0000CD', '#ededed');
  assert.ok(ratio >= 4.5, `Expected >= 4.5, got ${ratio}`);
});

test('Palette: dark commands (#be76de) contrast on #1f1f1f >= 4.5:1', () => {
  const ratio = getContrastRatio('#be76de', '#1f1f1f');
  assert.ok(ratio >= 4.5, `Expected >= 4.5, got ${ratio}`);
});

test('Palette: dark arguments (#7aa2e8) contrast on #1f1f1f >= 4.5:1', () => {
  const ratio = getContrastRatio('#7aa2e8', '#1f1f1f');
  assert.ok(ratio >= 4.5, `Expected >= 4.5, got ${ratio}`);
});
