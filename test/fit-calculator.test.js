const test = require('node:test');
const assert = require('assert');
const { computeFitScale } = require('../src/viewer/fit-calculator');

test('computeFitScale: A4 Portrait fit-width and fit-page', () => {
  const a4Width = 595.28;
  const a4Height = 841.89;
  const containerW = 800;
  const containerH = 1000;

  // Fit Width
  const resWidth = computeFitScale({
    containerWidth: containerW,
    containerHeight: containerH,
    pageWidth: a4Width,
    pageHeight: a4Height,
    fitMode: 'fit-width',
    paddingX: 20,
    scrollbarGutter: 15
  });
  const expectedAvailW = 800 - 20 - 15; // 765
  const expectedScaleW = expectedAvailW / a4Width;
  assert.ok(Math.abs(resWidth.scale - expectedScaleW) < 0.001);
  assert.strictEqual(Number.isInteger(resWidth.canvasWidth), true);
  assert.strictEqual(Number.isInteger(resWidth.canvasHeight), true);

  // Fit Page
  const resPage = computeFitScale({
    containerWidth: containerW,
    containerHeight: containerH,
    pageWidth: a4Width,
    pageHeight: a4Height,
    fitMode: 'fit-page',
    paddingX: 20,
    paddingY: 20,
    scrollbarGutter: 15
  });
  const availH = 1000 - 20; // 980
  const expectedScalePage = Math.min(expectedAvailW / a4Width, availH / a4Height);
  assert.ok(Math.abs(resPage.scale - expectedScalePage) < 0.001);
});

test('computeFitScale: US Letter Portrait and Landscape', () => {
  const letterW = 612;
  const letterH = 792;

  // US Letter Portrait
  const resPortrait = computeFitScale({
    containerWidth: 700,
    containerHeight: 900,
    pageWidth: letterW,
    pageHeight: letterH,
    fitMode: 'fit-width'
  });
  assert.ok(resPortrait.scale > 0.5 && resPortrait.scale < 2.0);

  // Landscape
  const resLandscape = computeFitScale({
    containerWidth: 900,
    containerHeight: 600,
    pageWidth: letterH, // landscape width
    pageHeight: letterW, // landscape height
    fitMode: 'fit-page'
  });
  assert.ok(resLandscape.scale > 0);
  assert.strictEqual(Number.isInteger(resLandscape.canvasWidth), true);
});

test('computeFitScale: High DPI pixel ratio integer canvas bounds', () => {
  const resHiDpi = computeFitScale({
    containerWidth: 600,
    containerHeight: 800,
    pageWidth: 500,
    pageHeight: 700,
    fitMode: 'fit-width',
    pixelRatio: 2.25
  });
  assert.strictEqual(Number.isInteger(resHiDpi.canvasWidth), true);
  assert.strictEqual(Number.isInteger(resHiDpi.canvasHeight), true);
});

test('computeFitScale: 16:9 Beamer slides edge-to-edge fit-width and framed fit-page', () => {
  const beamerWidth = 453.54;
  const beamerHeight = 255.12;

  // Split view: 500px wide, 700px high
  const splitFitWidth = computeFitScale({
    containerWidth: 500,
    containerHeight: 700,
    pageWidth: beamerWidth,
    pageHeight: beamerHeight,
    fitMode: 'fit-width',
    paddingX: 0,
    scrollbarGutter: 0
  });
  assert.strictEqual(splitFitWidth.scale, 500 / beamerWidth);

  // Full view: 1200px wide, 600px high (height constrained)
  const fullFitPage = computeFitScale({
    containerWidth: 1200,
    containerHeight: 600,
    pageWidth: beamerWidth,
    pageHeight: beamerHeight,
    fitMode: 'fit-page',
    paddingX: 0,
    paddingY: 0
  });
  const expectedPageScale = Math.min(1200 / beamerWidth, 600 / beamerHeight);
  assert.strictEqual(fullFitPage.scale, expectedPageScale);
});
