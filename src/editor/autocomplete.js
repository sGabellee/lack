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

// Custom completion source
function createLatexCompletionSource(projectContext = {}) {
  // projectContext: { getBibKeys: () => string[], getImageFiles: () => string[], getTexFiles: () => string[] }

  return function latexCompletionSource(context) {
    const { state, pos } = context;
    const doc = state.doc;
    const line = doc.lineAt(pos);
    const textBeforeCursorOnLine = line.text.slice(0, pos - line.from);
    const fullDocText = doc.toString();

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
            label: envName,
            type: 'type',
            detail: 'unclosed environment',
            boost: 100 - idx,
            apply: envName + '}'
          });
        }
      });

      // Add remaining environments from db
      latexDb.environments.forEach((env) => {
        if (!seen.has(env.name)) {
          seen.add(env.name);
          options.push({
            label: env.name,
            type: 'type',
            detail: env.package || 'environment',
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
      const options = latexDb.environments.map((env) => {
        let snippetText = `${env.name}}\n\t\${}\n\\end{${env.name}}`;
        return {
          label: env.name,
          type: 'class',
          detail: env.package ? `(${env.package})` : 'environment',
          info: env.doc_it || env.doc_en,
          apply: snippet(snippetText)
        };
      });

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
        label: pkg,
        type: 'namespace',
        detail: 'package',
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
        const detail = typeof item === 'object' && item.title ? item.title : 'bib entry';
        return {
          label: key,
          type: 'variable',
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
        label: lbl,
        type: 'constant',
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
        label: imgPath,
        type: 'text',
        detail: 'image file',
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
        label: texPath,
        type: 'text',
        detail: 'LaTeX source file',
        apply: texPath + '}'
      }));

      return {
        from,
        options,
        filter: true
      };
    }

    // 8. General LaTeX command completion: \command
    const cmdMatch = /\\([a-zA-Z@*]*)$/.exec(textBeforeCursorOnLine);
    if (!cmdMatch) {
      return null;
    }

    const typedCmd = cmdMatch[1];
    const from = pos - typedCmd.length;

    const options = [];

    // Add macros
    latexDb.macros.forEach((macro) => {
      const name = macro.name;
      const symbolPreview = SYMBOL_PREVIEWS[name];
      const detail = symbolPreview ? `${symbolPreview} (${macro.package || 'LaTeX'})` : (macro.package || 'LaTeX');

      let snippetStr = '\\' + name;
      if (macro.snippet && macro.snippet.includes('${')) {
        // convert e.g. \section{${1:title}} to CM6 snippet format
        snippetStr = macro.snippet;
      } else if (macro.args) {
        if (macro.args === 'm') {
          snippetStr = `\\${name}{\${}}`;
        } else if (macro.args === 'mm') {
          snippetStr = `\\${name}{\${}}{\${}}`;
        } else if (macro.args === 'om') {
          snippetStr = `\\${name}[\${}]{\${}}`;
        }
      }

      options.push({
        label: '\\' + name,
        type: symbolPreview ? 'constant' : 'function',
        detail,
        info: macro.doc_it || macro.doc_en,
        apply: snippet(snippetStr)
      });
    });

    // Add environment shortcuts: e.g. \begin{equation} ...
    latexDb.environments.forEach((env) => {
      const name = env.name;
      options.push({
        label: '\\begin{' + name + '}',
        type: 'class',
        detail: env.package || 'environment',
        info: env.doc_it || env.doc_en,
        apply: snippet(`\\begin{${name}}\n\t\${}\n\\end{${name}}`)
      });
    });

    return {
      from: from - 1, // Include the leading backslash in replacement
      options,
      filter: true
    };
  };
}

module.exports = {
  createLatexCompletionSource,
  SYMBOL_PREVIEWS,
  getUnclosedEnvironments,
  extractLabels
};
