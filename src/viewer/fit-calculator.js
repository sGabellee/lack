/**
 * src/viewer/fit-calculator.js
 * Precise fit-scale calculation for PDF pages (A4, Letter, landscape, rotated).
 * Accounts for scrollbar gutters, padding, and device pixel ratio rounding.
 */

function computeFitScale({
  containerWidth,
  containerHeight,
  pageWidth,
  pageHeight,
  fitMode = 'fit-width', // 'fit-width' | 'fit-page' | 'custom'
  currentScale = 1.0,
  pixelRatio = 1,
  paddingX = 0,
  paddingY = 0,
  scrollbarGutter = 0
}) {
  if (!pageWidth || !pageHeight || pageWidth <= 0 || pageHeight <= 0) {
    return { scale: 1.0, canvasWidth: 100, canvasHeight: 100 };
  }

  const availWidth = Math.max(20, containerWidth - paddingX - scrollbarGutter);
  const availHeight = Math.max(20, containerHeight - paddingY);

  let scale = currentScale;

  if (fitMode === 'fit-width') {
    scale = availWidth / pageWidth;
  } else if (fitMode === 'fit-page') {
    scale = Math.min(availWidth / pageWidth, availHeight / pageHeight);
  }

  // Constrain scale to safe zoom bounds
  scale = Math.max(0.2, Math.min(5.0, scale));

  // Compute integer pixel canvas dimensions to avoid blurry subpixel rendering
  const canvasWidth = Math.round(pageWidth * scale * pixelRatio);
  const canvasHeight = Math.round(pageHeight * scale * pixelRatio);

  return {
    scale,
    canvasWidth,
    canvasHeight,
    fitMode
  };
}

module.exports = {
  computeFitScale
};
