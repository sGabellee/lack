/**
 * src/editor/spell-tokenizer.js
 * Tokenizes LaTeX prose for spellchecking.
 *
 * Rules:
 * - Uses tokenizeLatexStream() from latex-syntax.js: only tokens of type 'text' are candidates.
 * - Entirely excludes commands, delimiters, arguments, math, and comments.
 * - Words containing digits (e.g. 'a4paper', 'utf8', '11pt', 'v2.0', 'node12') or underscores are NEVER checked and NEVER split.
 * - Words shorter than 3 characters are skipped.
 * - ALL-CAPS words (e.g. 'IEEE', 'PDF', 'HTML', 'NASA') are skipped.
 * - Handles Italian elisions (l', d', dell', un', quest') and contractions (don't, it's).
 */

const { tokenizeLatexStream } = require('./latex-syntax');

// Common Italian elision prefixes (when followed by apostrophe)
const ELISION_PREFIX_REGEX = /^(?:l|d|un|all|dell|dall|nell|sull|coll|quest|quell)'/i;

/**
 * Tokenize a LaTeX document and return an array of prose word tokens to check.
 * Each token: { word, from, to }
 */
function tokenizeLatexProse(text) {
  if (!text || typeof text !== 'string') return [];

  const streamTokens = tokenizeLatexStream(text);
  const resultWords = [];

  for (let i = 0; i < streamTokens.length; i++) {
    const token = streamTokens[i];

    // Only process pure 'text' tokens: ignore command, argument, math, comment, delimiter
    if (token.type !== 'text') {
      continue;
    }

    const chunk = token.text;
    const baseOffset = token.from;

    // Split chunk into candidate word segments by whitespace/punctuation
    // Match sequences of letters and optional inner apostrophes/hyphens
    const segmentRegex = /([^\s.,;:!?"'()\[\]{}<>/\\#*+=~`$|&^%_]+(?:[''-][^\s.,;:!?"'()\[\]{}<>/\\#*+=~`$|&^%_]+)*)/gu;
    let match;

    while ((match = segmentRegex.exec(chunk)) !== null) {
      let rawSegment = match[1];
      let segStart = baseOffset + match.index;
      let segEnd = segStart + rawSegment.length;

      // Rule: If segment contains digits or underscores, it is a technical identifier (a4paper, utf8, 11pt, var_name)
      // Completely skip it; NEVER split at digits!
      if (/[\d_]/.test(rawSegment)) {
        continue;
      }

      // Handle Italian elisions like "dell'albero" or "l'ombra"
      const elisionMatch = rawSegment.match(ELISION_PREFIX_REGEX);
      if (elisionMatch) {
        const prefixLen = elisionMatch[0].length;
        rawSegment = rawSegment.slice(prefixLen);
        segStart += prefixLen;
      }

      // Strip any trailing punctuation or apostrophe
      rawSegment = rawSegment.replace(/[''-]+$/, '');
      segEnd = segStart + rawSegment.length;

      // Filter: shorter than 3 characters
      if (rawSegment.length < 3) continue;

      // Filter: must consist of letters (Unicode \p{L})
      if (!/^[\p{L}'-]+$/u.test(rawSegment)) continue;

      // Filter: ALL-CAPS words (e.g. PDF, HTML, IEEE)
      if (rawSegment === rawSegment.toUpperCase() && rawSegment.length > 1) continue;

      resultWords.push({
        word: rawSegment,
        from: segStart,
        to: segEnd
      });
    }
  }

  return resultWords;
}

module.exports = {
  tokenizeLatexProse
};
