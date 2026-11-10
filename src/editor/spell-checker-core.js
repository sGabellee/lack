/**
 * src/editor/spell-checker-core.js
 * Pure logic for checking words against dictionary instances.
 * Implements bilingual dictionary check, hyphen/apostrophe handling, and sub-part highlighting.
 */

const HYPHEN_OR_APOSTROPHE_REGEX = /[-\u2010\u2011\u2013'’]/;
const SUBPART_REGEX = /([^\s\-\u2010\u2011\u2013'’]+)/gu;

function checkItemWithDictionaries(item, spInstances) {
  if (!item || !item.word || !spInstances || spInstances.length === 0) return [];

  const rawWord = item.word;
  // Normalize smart apostrophe ’ to '
  const normalizedWord = rawWord.replace(/’/g, "'");

  // 1. Check whole word against all active dictionaries
  const isWholeCorrect = spInstances.some((sp) => sp.correct(rawWord) || sp.correct(normalizedWord));
  if (isWholeCorrect) {
    return [];
  }

  // 2. If rejected by every dictionary and contains hyphen or apostrophe
  if (HYPHEN_OR_APOSTROPHE_REGEX.test(rawWord)) {
    const misspelledParts = [];
    const partRegex = new RegExp(SUBPART_REGEX.source, 'gu');
    let match;

    while ((match = partRegex.exec(rawWord)) !== null) {
      const subWord = match[1];
      const subStart = item.from + match.index;
      const subEnd = subStart + subWord.length;

      // Only check parts of length >= 3
      if (subWord.length >= 3) {
        const subNormalized = subWord.replace(/’/g, "'");
        const subCorrect = spInstances.some((sp) => sp.correct(subWord) || sp.correct(subNormalized));
        if (!subCorrect) {
          misspelledParts.push({
            word: subWord,
            from: subStart,
            to: subEnd
          });
        }
      }
    }
    return misspelledParts;
  }

  // Regular word without hyphens/apostrophes
  return [item];
}

module.exports = {
  checkItemWithDictionaries,
  HYPHEN_OR_APOSTROPHE_REGEX
};
