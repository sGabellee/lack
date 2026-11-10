/**
 * src/editor/spell-tokenizer.js
 * Tokenizes LaTeX prose for spellchecking, excluding commands, math, comments, and arguments.
 */

// Environments whose entire content is excluded from spellcheck
const EXCLUDED_ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'eqnarray', 'eqnarray*', 'multline', 'multline*', 'split', 'cases',
  'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix',
  'verbatim', 'lstlisting', 'minted', 'tikzpicture', 'circuitikz'
]);

// Commands whose first (or all) mandatory arguments are excluded
const EXCLUDED_ARG_COMMANDS = new Set([
  'cite', 'citep', 'citet', 'citeauthor', 'citeyear',
  'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref',
  'label', 'usepackage', 'documentclass',
  'input', 'include', 'includegraphics', 'bibliography', 'addbibresource',
  'url', 'begin', 'end'
]);

// Common Italian elision prefixes (when followed by apostrophe)
const ELISION_PREFIX_REGEX = /^(?:l|d|un|all|dell|dall|nell|sull|coll|quest|quell)'/i;

/**
 * Tokenize a LaTeX document and return an array of prose word tokens to check.
 * Each token: { word, from, to }
 */
function tokenizeLatexProse(text) {
  if (!text || typeof text !== 'string') return [];

  const len = text.length;
  const isExcluded = new Uint8Array(len);

  // 1. Mask comments: % until end of line (unless escaped with \%)
  for (let i = 0; i < len; i++) {
    if (text[i] === '%') {
      // Check if escaped
      let backslashes = 0;
      let j = i - 1;
      while (j >= 0 && text[j] === '\\') {
        backslashes++;
        j--;
      }
      if (backslashes % 2 === 0) {
        // Real comment: mask to newline
        while (i < len && text[i] !== '\n') {
          isExcluded[i] = 1;
          i++;
        }
      }
    }
  }

  // 2. Mask display math: $$ ... $$
  let pos = 0;
  while ((pos = text.indexOf('$$', pos)) !== -1) {
    if (isExcluded[pos]) { pos += 2; continue; }
    const end = text.indexOf('$$', pos + 2);
    if (end !== -1) {
      for (let k = pos; k < end + 2; k++) isExcluded[k] = 1;
      pos = end + 2;
    } else {
      for (let k = pos; k < len; k++) isExcluded[k] = 1;
      break;
    }
  }

  // 3. Mask display math: \[ ... \]
  pos = 0;
  while ((pos = text.indexOf('\\[', pos)) !== -1) {
    if (isExcluded[pos]) { pos += 2; continue; }
    const end = text.indexOf('\\]', pos + 2);
    if (end !== -1) {
      for (let k = pos; k < end + 2; k++) isExcluded[k] = 1;
      pos = end + 2;
    } else {
      for (let k = pos; k < len; k++) isExcluded[k] = 1;
      break;
    }
  }

  // 4. Mask inline math: \( ... \)
  pos = 0;
  while ((pos = text.indexOf('\\(', pos)) !== -1) {
    if (isExcluded[pos]) { pos += 2; continue; }
    const end = text.indexOf('\\)', pos + 2);
    if (end !== -1) {
      for (let k = pos; k < end + 2; k++) isExcluded[k] = 1;
      pos = end + 2;
    } else {
      for (let k = pos; k < len; k++) isExcluded[k] = 1;
      break;
    }
  }

  // 5. Mask inline math: $ ... $ (handling escaped \$)
  for (let i = 0; i < len; i++) {
    if (text[i] === '$' && !isExcluded[i]) {
      let backslashes = 0;
      let j = i - 1;
      while (j >= 0 && text[j] === '\\') { backslashes++; j--; }
      if (backslashes % 2 === 0) {
        // Start of $
        let end = -1;
        for (let k = i + 1; k < len; k++) {
          if (text[k] === '$') {
            let bs = 0;
            let m = k - 1;
            while (m >= i + 1 && text[m] === '\\') { bs++; m--; }
            if (bs % 2 === 0) {
              end = k;
              break;
            }
          }
        }
        if (end !== -1) {
          for (let k = i; k <= end; k++) isExcluded[k] = 1;
          i = end;
        }
      }
    }
  }

  // 6. Mask excluded environments: \begin{env} ... \end{env}
  const envRegex = /\\begin\{([a-zA-Z0-9*_-]+)\}/g;
  let match;
  while ((match = envRegex.exec(text)) !== null) {
    const envName = match[1];
    if (EXCLUDED_ENVIRONMENTS.has(envName)) {
      const startIndex = match.index;
      const closeTag = `\\end{${envName}}`;
      const endIndex = text.indexOf(closeTag, startIndex + match[0].length);
      if (endIndex !== -1) {
        const fullEnd = endIndex + closeTag.length;
        for (let k = startIndex; k < fullEnd; k++) isExcluded[k] = 1;
      }
    }
  }

  // 7. Mask inline \verb|...|
  const verbRegex = /\\verb([^\sa-zA-Z0-9])[\s\S]*?\1/g;
  while ((match = verbRegex.exec(text)) !== null) {
    for (let k = match.index; k < match.index + match[0].length; k++) isExcluded[k] = 1;
  }

  // 8. Mask command names and excluded arguments
  const cmdRegex = /\\([a-zA-Z@]+)\*?/g;
  while ((match = cmdRegex.exec(text)) !== null) {
    const cmdIndex = match.index;
    const cmdName = match[1];
    const cmdEnd = cmdIndex + match[0].length;

    // Mask command name itself
    for (let k = cmdIndex; k < cmdEnd; k++) isExcluded[k] = 1;

    // Special case for \href{URL}{text}: mask only 1st argument (URL), keep 2nd (text)
    if (cmdName === 'href') {
      let idx = cmdEnd;
      while (idx < len && /\s/.test(text[idx])) idx++;
      if (idx < len && text[idx] === '{') {
        const arg1Start = idx;
        let depth = 0;
        let arg1End = -1;
        for (let k = idx; k < len; k++) {
          if (text[k] === '{') depth++;
          else if (text[k] === '}') {
            depth--;
            if (depth === 0) { arg1End = k; break; }
          }
        }
        if (arg1End !== -1) {
          for (let k = arg1Start; k <= arg1End; k++) isExcluded[k] = 1;
        }
      }
      continue;
    }

    // Commands whose mandatory arguments should be masked
    if (EXCLUDED_ARG_COMMANDS.has(cmdName)) {
      let idx = cmdEnd;
      // Skip optional arguments [ ... ]
      while (idx < len && /\s/.test(text[idx])) idx++;
      if (idx < len && text[idx] === '[') {
        let bDepth = 0;
        for (let k = idx; k < len; k++) {
          if (text[k] === '[') bDepth++;
          else if (text[k] === ']') {
            bDepth--;
            if (bDepth === 0) { idx = k + 1; break; }
          }
        }
      }
      while (idx < len && /\s/.test(text[idx])) idx++;
      // Mask mandatory argument { ... }
      if (idx < len && text[idx] === '{') {
        let depth = 0;
        let argEnd = -1;
        for (let k = idx; k < len; k++) {
          if (text[k] === '{') depth++;
          else if (text[k] === '}') {
            depth--;
            if (depth === 0) { argEnd = k; break; }
          }
        }
        if (argEnd !== -1) {
          for (let k = idx; k <= argEnd; k++) isExcluded[k] = 1;
        }
      }
    }
  }

  // 9. Extract remaining valid prose words
  // Unicode letter matching: \p{L}
  const wordRegex = /[\p{L}]+/gu;
  const tokens = [];

  while ((match = wordRegex.exec(text)) !== null) {
    let rawWord = match[0];
    let start = match.index;
    let end = start + rawWord.length;

    // Check if within excluded region
    if (isExcluded[start] || isExcluded[end - 1]) continue;

    // Handle Italian elisions: check if previous chars were an elision prefix, e.g. "dell'albero"
    // If the word has an apostrophe attached before it
    if (start > 1 && text[start - 1] === "'") {
      // The word already starts after the apostrophe, which is correct
    }

    // Filter: shorter than 3 characters
    if (rawWord.length < 3) continue;

    // Filter: ALL-CAPS words (e.g. HTML, PDF, IEEE)
    if (rawWord === rawWord.toUpperCase() && rawWord.length > 1) continue;

    // Filter: words with digits (already guaranteed by [\p{L}]+ regex)

    tokens.push({
      word: rawWord,
      from: start,
      to: end
    });
  }

  return tokens;
}

module.exports = {
  tokenizeLatexProse,
  EXCLUDED_ENVIRONMENTS,
  EXCLUDED_ARG_COMMANDS
};
