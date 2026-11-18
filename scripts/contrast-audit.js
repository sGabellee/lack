#!/usr/bin/env node
/**
 * scripts/contrast-audit.js
 * Automated WCAG 2.1 AA Contrast Auditor for Lack LaTeX Editor.
 * Checks contrast across Light, Dark, and GitHub themes and all key UI component states.
 */

function parseColor(colorStr) {
  if (!colorStr) return { r: 0, g: 0, b: 0, a: 1 };
  const str = colorStr.trim().toLowerCase();

  // Hex (#rgb, #rrggbb)
  if (str.startsWith('#')) {
    let hex = str.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    const num = parseInt(hex, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      a: 1
    };
  }

  // rgba(r, g, b, a) or rgb(r, g, b)
  const rgbaMatch = str.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
    };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
}

function compositeColor(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(a * fg.r + (1 - a) * bg.r),
    g: Math.round(a * fg.g + (1 - a) * bg.g),
    b: Math.round(a * fg.b + (1 - a) * bg.b),
    a: 1
  };
}

function getLuminance(rgb) {
  const norm = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(c => {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * norm[0] + 0.7152 * norm[1] + 0.0722 * norm[2];
}

function calculateContrastRatio(fgStr, bgStr) {
  const rawFg = parseColor(fgStr);
  const rawBg = parseColor(bgStr);
  const effectiveBg = rawBg.a < 1 ? compositeColor(rawBg, { r: 255, g: 255, b: 255, a: 1 }) : rawBg;
  const effectiveFg = rawFg.a < 1 ? compositeColor(rawFg, effectiveBg) : rawFg;

  const l1 = getLuminance(effectiveFg);
  const l2 = getLuminance(effectiveBg);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

const auditPairs = [
  // Purple brand surfaces
  { context: 'Collab Beta Badge (GRATIS ILLIMITATO)', fg: '#ffffff', bg: '#80007f', min: 4.5 },
  { context: 'Project Virtual Pane Badge', fg: '#ffffff', bg: '#80007f', min: 4.5 },
  { context: 'Project Item Selected (Light)', fg: '#ffffff', bg: '#80007f', min: 4.5 },
  { context: 'PDF Compile Error Log Button', fg: '#ffffff', bg: '#80007f', min: 4.5 },

  // Light Theme UI states
  { context: 'Light Editor: Body text', fg: '#1e1e1e', bg: '#ededed', min: 4.5 },
  { context: 'Light Explorer: File item', fg: '#333333', bg: '#f5f5f5', min: 4.5 },
  { context: 'Light Explorer: Selected item', fg: '#80007f', bg: '#e0e0e0', min: 4.5 },
  { context: 'Light Status Bar text', fg: '#2e2e2e', bg: '#ededed', min: 4.5 },
  { context: 'Light Start Screen: Action item', fg: '#1e1e1e', bg: '#f5f5f5', min: 4.5 },
  { context: 'Light Virtual Pane text', fg: '#2e2e2e', bg: '#ededed', min: 4.5 },

  // Dark Theme UI states
  { context: 'Dark Editor: Body text', fg: '#e0e0e0', bg: '#1f1f1f', min: 4.5 },
  { context: 'Dark Explorer: File item', fg: '#cccccc', bg: '#181818', min: 4.5 },
  { context: 'Dark Explorer: Selected item', fg: '#be76de', bg: '#2a2a2a', min: 4.5 },
  { context: 'Dark Virtual Pane text', fg: '#e0e0e0', bg: '#1f1f1f', min: 4.5 },
  { context: 'Dark Start Screen: Action item', fg: '#e0e0e0', bg: '#181818', min: 4.5 },

  // GitHub Theme UI states
  { context: 'GitHub Editor: Body text', fg: '#c9d1d9', bg: '#0d1117', min: 4.5 },
  { context: 'GitHub Explorer: File item', fg: '#c9d1d9', bg: '#161b22', min: 4.5 },
  { context: 'GitHub Explorer: Selected item', fg: '#58a6ff', bg: '#21262d', min: 4.5 },
  { context: 'GitHub Virtual Pane text', fg: '#c9d1d9', bg: '#0d1117', min: 4.5 },

  // Dialogs & Modals
  { context: 'Modal Content: Header title (Light)', fg: '#1e1e1e', bg: '#ffffff', min: 4.5 },
  { context: 'Modal Content: Header title (Dark)', fg: '#e0e0e0', bg: '#252526', min: 4.5 },
  { context: 'Confirm Modal: Danger button', fg: '#ffffff', bg: '#dc2626', min: 4.5 },
  { context: 'Confirm Modal: Primary button', fg: '#ffffff', bg: '#80007f', min: 4.5 }
];

console.log('\n========================================================================================');
console.log('                          LACK WCAG 2.1 AA CONTRAST AUDIT                                ');
console.log('========================================================================================');
console.log(
  '| Context'.padEnd(46) +
  '| FG'.padEnd(10) +
  '| BG'.padEnd(10) +
  '| Ratio'.padEnd(10) +
  '| Required | Status |'
);
console.log('|' + '-'.repeat(45) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(10) + '|' + '-'.repeat(8) + '|');

let failures = 0;

for (const pair of auditPairs) {
  const ratio = calculateContrastRatio(pair.fg, pair.bg);
  const pass = ratio >= pair.min;
  if (!pass) failures++;

  const status = pass ? ' PASS ' : ' FAIL ';
  console.log(
    `| ${pair.context.padEnd(43)} | ${pair.fg.padEnd(7)} | ${pair.bg.padEnd(7)} | ${ratio.toFixed(2).padStart(6)}:1 | ${pair.min.toFixed(1)}:1     | ${status} |`
  );
}

console.log('========================================================================================\n');

if (failures > 0) {
  console.error(`❌ Contrast Audit FAILED with ${failures} violations.`);
  process.exit(1);
} else {
  console.log(`✅ Contrast Audit PASSED: all ${auditPairs.length} checks satisfy WCAG 2.1 AA.\n`);
  process.exit(0);
}
