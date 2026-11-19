const { snippet } = require('@codemirror/autocomplete');
const latexDb = require('../../data/latex-commands.json');

const SYMBOL_PREVIEWS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  infty: '∞', partial: '∂', nabla: '∇', pm: '±', mp: '∓', times: '×', div: '÷',
  ast: '∗', star: '⋆', circ: '∘', bullet: '∙', cdot: '·', cap: '∩', cup: '∪',
  uplus: '⊎', sqcap: '⊓', sqcup: '⊔', vee: '∨', wedge: '∧', setminus: '∖',
  wr: '≀', diamond: '◇', bigtriangleup: '△', bigtriangledown: '▽',
  leq: '≤', geq: '≥', equiv: '≡', sim: '∼', simeq: '≃', asymp: '≍',
  approx: '≈', neq: '≠', propto: '∝', perp: '⊥', mid: '∣', parallel: '∥',
  subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', in: '∈', ni: '∋',
  notin: '∉', forall: '∀', exists: '∃', nexists: '∄', emptyset: '∅',
  leftarrow: '←', rightarrow: '→', Leftarrow: '⇐', Rightarrow: '⇒',
  leftrightarrow: '↔', Leftrightarrow: '⇔', to: '→', mapsto: '↦',
  uparrow: '↑', downarrow: '↓', Uparrow: '⇑', Downarrow: '⇓',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱'
};

const STANDARD_SIGNATURES = {
  section: '{}', subsection: '{}', subsubsection: '{}', chapter: '{}', paragraph: '{}', subparagraph: '{}',
  textbf: '{}', textit: '{}', texttt: '{}', textsc: '{}', textmd: '{}', textnormal: '{}',
  emph: '{}', underline: '{}',
  label: '{}', ref: '{}', pageref: '{}', eqref: '{}', cite: '{}', autoref: '{}', cref: '{}', Cref: '{}',
  frac: '{}{}', dfrac: '{}{}', tfrac: '{}{}', cfrac: '{}{}',
  sqrt: '{}',
  includegraphics: '[]{}',
  input: '{}', include: '{}', subfile: '{}',
  url: '{}', href: '{}{}',
  footnote: '{}',
  caption: '{}',
  textcolor: '{}{}', color: '{}',
  item: '[]'
};

const HIGH_PRIORITY_COMMANDS = new Set([
  'section', 'subsection', 'subsubsection', 'chapter', 'paragraph',
  'textbf', 'textit', 'emph', 'texttt', 'underline',
  'label', 'ref', 'cite', 'eqref', 'pageref', 'autoref',
  'item', 'begin', 'end', 'frac', 'sqrt', 'includegraphics',
  'input', 'include', 'usepackage', 'documentclass', 'tableofcontents'
]);

// Find unclosed environments before pos
function getUnclosedEnvironments(docText, pos) {
  const textBefore = docText.slice(0, pos);
  const stack = [];
  const regex = /\\(begin|end)\{([a-zA-Z0-9*_-]+)\}/g;
  let match;
  while ((match = regex.exec(textBefore)) !== null) {
    const kind = match[1];
    const name = match[2];
    if (kind === 'begin') {
      stack.push(name);
    } else if (kind === 'end') {
      if (stack.length > 0 && stack[stack.length - 1] === name) {
        stack.pop();
      }
    }
  }
  return stack.reverse(); // Most recent first
}

// Extract labels from doc
function extractLabels(docText) {
  const labels = new Set();
  const labelRegex = /\\label\{([^}]+)\}/g;
  let match;
  while ((match = labelRegex.exec(docText)) !== null) {
    labels.add(match[1]);
  }
  return Array.from(labels);
}

// Levenshtein distance for Tier 4 typo recovery
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function getCommandSignature(macro) {
  if (STANDARD_SIGNATURES[macro.name]) {
    return STANDARD_SIGNATURES[macro.name];
  }
  if (macro.args) {
    const rawArgs = macro.args.trim().split(/\s+/);
    let sig = '';
    for (const a of rawArgs) {
      if (a === 'm' || a === 'r') sig += '{}';
      else if (a === 'o' || a === 'd') sig += '[]';
    }
    if (sig) return sig;
  }
  if (macro.snippet) {
    let sig = '';
    const matches = macro.snippet.match(/(\{[^}]*\}|\[[^\]]*\])/g);
    if (matches) {
      for (const m of matches) {
        if (m.startsWith('{')) sig += '{}';
        else if (m.startsWith('[')) sig += '[]';
      }
      if (sig) return sig;
    }
  }
  return '';
}

function getSourceBadge(macro) {
  if (macro.package === 'latex2e' || !macro.package) {
    return 'cmd';
  }
  return `${macro.package}-cmd`;
}

// Custom Overleaf-Style completion source
function createLatexCompletionSource(projectContext = {}) {
  return function latexCompletionSource(context) {
    const { state, pos } = context;
    const doc = state.doc;
    const line = doc.lineAt(pos);
    const textBeforeCursorOnLine = line.text.slice(0, pos - line.from);
    const fullDocText = (typeof doc.toString === 'function') ? doc.toString() : String(doc || '');

    // Check if beamer class is active in document
    const isBeamerDoc = /\\documentclass(?:\[[^\]]*\])?\{beamer\}/.test(fullDocText);

    // 1. Contextual: \end{...}
    const endMatch = /\\end\{([a-zA-Z0-9*_-]*)$/.exec(textBeforeCursorOnLine);
    if (endMatch) {
      const typed = endMatch[1];
      const from = pos - typed.length;
      const unclosed = getUnclosedEnvironments(fullDocText, pos);
      const seen = new Set();
      const options = [];

      unclosed.forEach((envName, idx) => {
        if (!seen.has(envName)) {
          seen.add(envName);
          options.push({
            label: envName + '}',
            detail: 'unclosed env',
            boost: 100 - idx,
            apply: envName + '}'
          });
        }
      });

      latexDb.environments.forEach((env) => {
        if (!seen.has(env.name)) {
          seen.add(env.name);
          options.push({
            label: env.name + '}',
            detail: env.package ? `${env.package}-env` : 'env',
            apply: env.name + '}'
          });
        }
      });

      return {
        from,
        options,
        filter: true
      };
    }

    // 2. Contextual: \begin{...}
    const beginMatch = /\\begin\{([a-zA-Z0-9*_-]*)$/.exec(textBeforeCursorOnLine);
    if (beginMatch) {
      const typed = beginMatch[1];
      const from = pos - typed.length;
      const options = latexDb.environments.map((env) => ({
        label: env.name + '}',
        detail: env.package ? `${env.package}-env` : 'env',
        info: env.doc_it || env.doc_en,
        apply: snippet(`${env.name}}\n\t\${}\n\\end{${env.name}}`)
      }));

      return {
        from,
        options,
        filter: true
      };
    }

    // 3. Contextual: \usepackage[...]{...} or \usepackage{...}
    const usepackageMatch = /\\usepackage(?:\[[^\]]*\])?\{([a-zA-Z0-9*_-]*)$/.exec(textBeforeCursorOnLine);
    if (usepackageMatch) {
      const typed = usepackageMatch[1];
      const from = pos - typed.length;
      const options = (latexDb.packages || []).map((pkg) => ({
        label: pkg + '}',
        detail: 'pkg',
        apply: pkg + '}'
      }));

      return {
        from,
        options,
        filter: true
      };
    }

    // 4. Contextual: \cite{...}, \citep{...}, etc.
    const citeMatch = /\\(?:cite|citep|citet|parencite|textcite|nocite)\{([a-zA-Z0-9:_-]*)$/.exec(textBeforeCursorOnLine);
    if (citeMatch) {
      const typed = citeMatch[1];
      const from = pos - typed.length;
      const bibKeys = typeof projectContext.getBibKeys === 'function' ? projectContext.getBibKeys() : [];
      const options = bibKeys.map((item) => {
        const key = typeof item === 'string' ? item : item.key;
        const detail = typeof item === 'object' && item.title ? item.title : 'bib';
        return {
          label: key + '}',
          detail,
          apply: key + '}'
        };
      });

      return {
        from,
        options,
        filter: true
      };
    }

    // 5. Contextual: \ref{...}, \pageref{...}, \eqref{...}, etc.
    const refMatch = /\\(?:ref|pageref|eqref|autoref|cref|Cref)\{([a-zA-Z0-9:_-]*)$/.exec(textBeforeCursorOnLine);
    if (refMatch) {
      const typed = refMatch[1];
      const from = pos - typed.length;
      const labels = extractLabels(fullDocText);
      const options = labels.map((lbl) => ({
        label: lbl + '}',
        detail: 'label',
        apply: lbl + '}'
      }));

      return {
        from,
        options,
        filter: true
      };
    }

    // 6. Contextual: \includegraphics[...]{...}
    const imgMatch = /\\includegraphics(?:\[[^\]]*\])?\{([^}]*)$/.exec(textBeforeCursorOnLine);
    if (imgMatch) {
      const typed = imgMatch[1];
      const from = pos - typed.length;
      const images = typeof projectContext.getImageFiles === 'function' ? projectContext.getImageFiles() : [];
      const options = images.map((imgPath) => ({
        label: imgPath + '}',
        detail: 'image',
        apply: imgPath + '}'
      }));

      return {
        from,
        options,
        filter: true
      };
    }

    // 7. Contextual: \input{...}, \include{...}, \subfile{...}
    const inputMatch = /\\(?:input|include|subfile)\{([^}]*)$/.exec(textBeforeCursorOnLine);
    if (inputMatch) {
      const typed = inputMatch[1];
      const from = pos - typed.length;
      const texFiles = typeof projectContext.getTexFiles === 'function' ? projectContext.getTexFiles() : [];
      const options = texFiles.map((texPath) => ({
        label: texPath + '}',
        detail: 'tex',
        apply: texPath + '}'
      }));

      return {
        from,
        options,
        filter: true
      };
    }

    // 8. General LaTeX Command Completion: \command
    const cmdMatch = /\\([a-zA-Z@*]*)$/.exec(textBeforeCursorOnLine);
    if (!cmdMatch) {
      return null;
    }

    const typedCmd = cmdMatch[1];
    const query = typedCmd.toLowerCase();
    const from = pos - typedCmd.length;

    // Filter macros according to 4-tier ranking rules
    const allowsStar = typedCmd.endsWith('*');
    const seenNames = new Set();
    const candidateMacros = [];

    for (const macro of latexDb.macros) {
      const name = macro.name;
      // Rule: collapse * variants unless user query explicitly ends with *
      if (!allowsStar && name.endsWith('*')) {
        continue;
      }
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      candidateMacros.push(macro);
    }

    // Categorize into the 4 strict tiers:
    const tier1 = []; // Exact matches
    const tier2 = []; // Prefix matches
    const tier3 = []; // Contiguous substring matches
    const tier4 = []; // Typo candidates (Levenshtein <= 1)

    for (const macro of candidateMacros) {
      const nameLower = macro.name.toLowerCase();
      if (!query) {
        tier2.push(macro);
      } else if (nameLower === query) {
        tier1.push(macro);
      } else if (nameLower.startsWith(query)) {
        tier2.push(macro);
      } else if (nameLower.includes(query)) {
        tier3.push(macro);
      }
    }

    // Tier 4: Only if Tiers 1-3 are empty and query length >= 3
    if (tier1.length === 0 && tier2.length === 0 && tier3.length === 0 && query.length >= 3) {
      for (const macro of candidateMacros) {
        const dist = levenshtein(query, macro.name.toLowerCase());
        if (dist <= 1) {
          tier4.push({ macro, dist });
        }
      }
      tier4.sort((a, b) => a.dist - b.dist || a.macro.name.length - b.macro.name.length);
    }

    // Sort Tier 2 (Prefix matches):
    tier2.sort((a, b) => {
      // 1. High-priority standard commands first
      const aHigh = HIGH_PRIORITY_COMMANDS.has(a.name) ? 1 : 0;
      const bHigh = HIGH_PRIORITY_COMMANDS.has(b.name) ? 1 : 0;
      if (aHigh !== bHigh) return bHigh - aHigh;

      // 2. Beamer penalty if not a beamer document
      if (!isBeamerDoc) {
        const aBeamer = a.package === 'beamer' ? 1 : 0;
        const bBeamer = b.package === 'beamer' ? 1 : 0;
        if (aBeamer !== bBeamer) return aBeamer - bBeamer;
      }

      // 3. Shorter commands first
      if (a.name.length !== b.name.length) {
        return a.name.length - b.name.length;
      }

      // 4. Alphabetical
      return a.name.localeCompare(b.name);
    });

    // Sort Tier 3 (Substring matches):
    tier3.sort((a, b) => {
      const aIdx = a.name.toLowerCase().indexOf(query);
      const bIdx = b.name.toLowerCase().indexOf(query);
      if (aIdx !== bIdx) return aIdx - bIdx;

      if (!isBeamerDoc) {
        const aBeamer = a.package === 'beamer' ? 1 : 0;
        const bBeamer = b.package === 'beamer' ? 1 : 0;
        if (aBeamer !== bBeamer) return aBeamer - bBeamer;
      }

      if (a.name.length !== b.name.length) {
        return a.name.length - b.name.length;
      }
      return a.name.localeCompare(b.name);
    });

    // Combine ranked list
    const combinedMacros = [
      ...tier1,
      ...tier2,
      ...tier3,
      ...tier4.map(t => t.macro)
    ];

    if (process.env.LACK_DEBUG) {
      console.log(`[LACK_DEBUG] Autocomplete query "${query}" -> T1:${tier1.length} T2:${tier2.length} T3:${tier3.length} T4:${tier4.length}`);
    }

    const options = combinedMacros.map((macro, rankIdx) => {
      const name = macro.name;
      const sig = getCommandSignature(macro);
      const label = '\\' + name + sig;
      const sourceBadge = getSourceBadge(macro);
      const symbolPreview = SYMBOL_PREVIEWS[name];

      let snippetStr = '\\' + name;
      if (sig === '{}') {
        snippetStr = `\\${name}{\${}}`;
      } else if (sig === '{}{}') {
        snippetStr = `\\${name}{\${1}}{\${2}}`;
      } else if (sig === '[]{}') {
        snippetStr = `\\${name}[\${1}]{\${2}}`;
      } else if (macro.snippet && macro.snippet.includes('${')) {
        snippetStr = macro.snippet;
      }

      const item = {
        label,
        detail: symbolPreview ? `${symbolPreview}  ${sourceBadge}` : sourceBadge,
        info: macro.doc_it || macro.doc_en,
        boost: 2000 - rankIdx,
        apply: snippet(snippetStr)
      };

      return item;
    });

    // Include the leading backslash in the replacement range
    return {
      from: from - 1,
      options,
      filter: false // Our custom 4-tier ranking handles filtering! No CM6 scattered underlines!
    };
  };
}

module.exports = {
  createLatexCompletionSource,
  SYMBOL_PREVIEWS,
  STANDARD_SIGNATURES,
  getUnclosedEnvironments,
  extractLabels,
  levenshtein,
  getCommandSignature,
  getSourceBadge
};
