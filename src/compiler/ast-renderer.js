/**
 * src/compiler/ast-renderer.js
 * High-fidelity, class-aware LaTeX to HTML renderer using @unified-latex AST.
 * Handles IEEEtran (two-column, author blocks, abstract, keywords), beamer (16:9),
 * article/report/book, KaTeX math, tables, citations, cross-references, and graceful degradation.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('@unified-latex/unified-latex-util-parse');

// Load KaTeX if available
let katex = null;
try {
  katex = require('../../api/katex.min.js');
} catch (_) {
  try {
    katex = require(path.join(__dirname, '..', '..', 'api', 'katex.min.js'));
  } catch (_) {}
}

// Load built-in macro signatures
let macroDefinitions = {};
try {
  const defs = require('../../data/builtin-macros.json');
  macroDefinitions = defs.macros || {};
} catch (_) {
  try {
    const defs = require(path.join(__dirname, '..', '..', 'data', 'builtin-macros.json'));
    macroDefinitions = defs.macros || {};
  } catch (_) {}
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripTags(html) {
  return (html || '').replace(/<[^>]+>/g, '');
}

/**
 * Render an AST node or node array into HTML
 */
class LatexRenderer {
  constructor(options = {}) {
    this.options = options;
    this.warnings = new Set();
    this.labels = new Map(); // labelKey -> displayString
    this.cites = new Map();  // citeKey -> number
    this.citeCount = 0;
    this.sectionCount = 0;
    this.subsectionCount = 0;
    this.figureCount = 0;
    this.tableCount = 0;
    this.equationCount = 0;
    this.mathCount = 0;
    this.docClass = 'article';
    this.classOptions = [];
    this.isTwoColumn = false;
    this.isBeamer = false;
    this.titleHtml = '';
    this.authorsHtml = '';
    this.dateHtml = '';
    this.abstractHtml = '';
    this.keywordsHtml = '';
  }

  addWarning(msg) {
    this.warnings.add(msg);
  }

  renderDoc(latexCode) {
    if (!latexCode || typeof latexCode !== 'string') {
      return { html: '', warnings: [], sectionsCount: 0, mathCount: 0, pagesCount: 1 };
    }

    // Pre-extract documentclass
    const classMatch = latexCode.match(/\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}/);
    if (classMatch) {
      if (classMatch[1]) {
        this.classOptions = classMatch[1].split(',').map(s => s.trim().toLowerCase());
      }
      this.docClass = classMatch[2].trim();
    }

    if (this.docClass.toLowerCase() === 'ieeetran' || this.classOptions.includes('twocolumn')) {
      this.isTwoColumn = true;
    }
    if (this.docClass.toLowerCase() === 'beamer') {
      this.isBeamer = true;
    }

    let ast;
    try {
      ast = parse(latexCode, { macros: macroDefinitions });
    } catch (err) {
      this.addWarning(`Parse error fallback: ${err.message}`);
      return this.renderFallback(latexCode);
    }

    // Pass 1: extract preamble, title, author, date, and labels
    this.scanPreambleAndMetadata(ast);

    // Pass 2: render document body
    const bodyContent = this.extractDocumentBody(ast);
    const pages = this.renderBodyToPages(bodyContent);

    return {
      html: pages.html,
      warnings: Array.from(this.warnings),
      sectionsCount: this.sectionCount,
      mathCount: this.mathCount,
      figuresCount: this.figureCount,
      pagesCount: pages.pagesCount,
      isTwoColumn: this.isTwoColumn,
      isBeamer: this.isBeamer
    };
  }

  scanPreambleAndMetadata(ast) {
    const nodes = Array.isArray(ast) ? ast : (ast.content || []);

    const walk = (nodeList) => {
      for (const node of nodeList) {
        if (!node) continue;
        if (node.type === 'macro') {
          if (node.content === 'title') {
            this.titleHtml = this.renderMacroArg(node, 1) || this.renderMacroArg(node, 0);
          } else if (node.content === 'author') {
            this.authorsHtml = this.renderAuthorsNode(node);
          } else if (node.content === 'date') {
            const rawDate = this.renderMacroArg(node, 0);
            this.dateHtml = rawDate || new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
          } else if (node.content === 'twocolumn') {
            this.isTwoColumn = true;
          } else if (node.content === 'onecolumn') {
            this.isTwoColumn = false;
          } else if (node.content === 'label') {
            const key = stripTags(this.renderMacroArg(node, 0)).trim();
            if (key) this.labels.set(key, '1');
          }
        } else if (node.type === 'environment') {
          const envName = this.getEnvName(node);
          if (envName === 'abstract') {
            this.abstractHtml = this.renderNodes(node.content || []);
          } else if (envName === 'IEEEkeywords' || envName === 'keywords') {
            this.keywordsHtml = this.renderNodes(node.content || []);
          }
        }
        if (node.content && Array.isArray(node.content)) {
          walk(node.content);
        }
      }
    };

    walk(nodes);
  }

  getEnvName(node) {
    if (!node) return '';
    if (typeof node.env === 'string') return node.env;
    if (node.env && node.env.content) {
      if (typeof node.env.content === 'string') return node.env.content;
      if (Array.isArray(node.env.content)) return node.env.content.map(n => n.content || '').join('');
    }
    return '';
  }

  extractDocumentBody(ast) {
    const nodes = Array.isArray(ast) ? ast : (ast.content || []);
    for (const node of nodes) {
      if (node.type === 'environment' && this.getEnvName(node) === 'document') {
        return node.content || [];
      }
    }
    return nodes.filter(n => {
      if (n.type === 'macro' && ['documentclass', 'usepackage', 'hypersetup', 'pagestyle'].includes(n.content)) {
        return false;
      }
      return true;
    });
  }

  renderAuthorsNode(authorMacroNode) {
    let innerNodes = [];
    if (authorMacroNode.args && authorMacroNode.args.length > 0) {
      const lastArg = authorMacroNode.args[authorMacroNode.args.length - 1];
      innerNodes = lastArg.content || [];
    } else if (Array.isArray(authorMacroNode.content)) {
      innerNodes = authorMacroNode.content;
    }

    const authorBlocks = [];
    let currentBlock = [];

    for (const node of innerNodes) {
      if (node.type === 'macro' && node.content === 'and') {
        if (currentBlock.length > 0) authorBlocks.push(currentBlock);
        currentBlock = [];
      } else {
        currentBlock.push(node);
      }
    }
    if (currentBlock.length > 0) authorBlocks.push(currentBlock);

    if (authorBlocks.length === 0) return '';

    const renderedBlocks = authorBlocks.map(block => {
      return `<div class="latex-author-block">${this.renderNodes(block)}</div>`;
    });

    return `<div class="latex-authors-row">${renderedBlocks.join('')}</div>`;
  }

  renderMacroArg(macroNode, argIndex = 0) {
    if (!macroNode.args || macroNode.args.length <= argIndex) return '';
    const arg = macroNode.args[argIndex];
    return this.renderNodes(arg.content || []);
  }

  renderBodyToPages(nodes) {
    const pageNodeLists = [[]];

    for (const node of nodes) {
      if (node.type === 'macro' && (node.content === 'newpage' || node.content === 'clearpage' || node.content === 'cleardoublepage')) {
        pageNodeLists.push([]);
      } else {
        pageNodeLists[pageNodeLists.length - 1].push(node);
      }
    }

    const pagesCount = Math.max(1, pageNodeLists.length);
    let fullHtml = '<div class="latex-pages-stack">';

    for (let pIdx = 0; pIdx < pagesCount; pIdx++) {
      const pageNodes = pageNodeLists[pIdx];
      let pageBodyHtml = '';

      if (pIdx === 0 && (this.titleHtml || this.authorsHtml)) {
        pageBodyHtml += this.buildTitleBanner();
      }

      const renderedContent = this.renderNodes(pageNodes);
      pageBodyHtml += renderedContent;

      const pageClass = this.isBeamer
        ? 'page-sheet-beamer'
        : (this.isTwoColumn ? 'page-sheet-a4 page-twocolumn' : 'page-sheet-a4');

      fullHtml += `
        <div class="page-sheet-container">
          <div class="${pageClass}">
            <div class="page-sheet-content">
              ${pageBodyHtml}
            </div>
            <div class="page-sheet-footer">
              <span class="page-sheet-title-foot">${escapeHtml(this.options.title || '')}</span>
              <span class="page-sheet-num">${this.isBeamer ? `Slide ${pIdx + 1} / ${pagesCount}` : `Pagina ${pIdx + 1} di ${pagesCount}`}</span>
            </div>
          </div>
        </div>
      `;
    }

    fullHtml += '</div>';
    return { html: fullHtml, pagesCount };
  }

  buildTitleBanner() {
    let banner = '<div class="latex-title-banner">';

    if (this.titleHtml) {
      const parts = this.titleHtml.split(/<br\s*\/?>|\\\\/);
      if (parts.length > 1) {
        banner += `<h1 class="latex-doc-title">${parts[0].trim()}</h1>`;
        banner += `<div class="latex-doc-subtitle">${parts.slice(1).join(' ').trim()}</div>`;
      } else {
        banner += `<h1 class="latex-doc-title">${this.titleHtml}</h1>`;
      }
    }

    if (this.authorsHtml) {
      banner += this.authorsHtml;
    }

    if (this.dateHtml && !this.isTwoColumn) {
      banner += `<div class="latex-doc-date">${this.dateHtml}</div>`;
    }

    if (this.isTwoColumn) {
      if (this.abstractHtml) {
        banner += `<div class="latex-abstract-block"><strong>Abstract—</strong>${this.abstractHtml}</div>`;
      }
      if (this.keywordsHtml) {
        banner += `<div class="latex-keywords-block"><strong>Index Terms—</strong>${this.keywordsHtml}</div>`;
      }
    }

    banner += '</div>';
    if (!this.isTwoColumn) {
      banner += '<hr class="latex-title-divider" />';
    }
    return banner;
  }

  renderNodes(nodes) {
    if (!nodes) return '';
    if (!Array.isArray(nodes)) nodes = [nodes];

    let out = '';
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      out += this.renderSingleNode(node);
    }
    return out;
  }

  renderSingleNode(node) {
    if (!node) return '';

    switch (node.type) {
      case 'string':
        return this.formatTypography(escapeHtml(node.content));

      case 'whitespace':
        return ' ';

      case 'parbreak':
        return '<br/><br/>';

      case 'comment':
        return '';

      case 'group': {
        return this.renderNodes(node.content || []);
      }

      case 'macro':
        return this.renderMacro(node);

      case 'environment':
        return this.renderEnvironment(node);

      case 'inlinemath':
      case 'mathenv':
      case 'displaymath':
        return this.renderMath(node);

      case 'argument':
        return this.renderNodes(node.content || []);

      default:
        if (node.content) {
          if (typeof node.content === 'string') return escapeHtml(node.content);
          if (Array.isArray(node.content)) return this.renderNodes(node.content);
        }
        return '';
    }
  }

  formatTypography(str) {
    if (!str) return '';
    return str
      .replace(/---/g, '—')
      .replace(/--/g, '–')
      .replace(/``/g, '“')
      .replace(/''/g, '”')
      .replace(/`/g, '‘')
      .replace(/'/g, '’')
      .replace(/~/g, '&nbsp;');
  }

  renderMacro(node) {
    const name = node.content;

    switch (name) {
      // Escaped symbols
      case '%':
        return '%';
      case '$':
        return '$';
      case '&':
        return '&amp;';
      case '#':
        return '#';
      case '_':
        return '_';
      case '{':
        return '{';
      case '}':
        return '}';
      case '\\':
      case 'newline':
        return '<br/>';

      // Title/Author/Date in body: already extracted in banner
      case 'title':
      case 'author':
      case 'date':
      case 'maketitle':
      case 'and':
        return '';

      // Text styling
      case 'textbf':
      case 'bfseries':
      case 'bf':
        return `<strong>${this.renderMacroArg(node, 0)}</strong>`;

      case 'textit':
      case 'itshape':
      case 'it':
      case 'emph':
        return `<em>${this.renderMacroArg(node, 0)}</em>`;

      case 'texttt':
      case 'ttfamily':
      case 'tt':
        return `<code>${this.renderMacroArg(node, 0)}</code>`;

      case 'underline':
        return `<u>${this.renderMacroArg(node, 0)}</u>`;

      case 'textsuperscript':
        return `<sup>${this.renderMacroArg(node, 0)}</sup>`;

      case 'textsubscript':
        return `<sub>${this.renderMacroArg(node, 0)}</sub>`;

      case 'textsc':
      case 'scshape':
        return `<span style="font-variant: small-caps;">${this.renderMacroArg(node, 0)}</span>`;

      // Font size switches
      case 'footnotesize':
        return `<span class="latex-size-footnotesize">${this.renderMacroArg(node, 0)}</span>`;
      case 'small':
        return `<span class="latex-size-small">${this.renderMacroArg(node, 0)}</span>`;
      case 'normalsize':
        return `<span class="latex-size-normalsize">${this.renderMacroArg(node, 0)}</span>`;
      case 'large':
        return `<span class="latex-size-large">${this.renderMacroArg(node, 0)}</span>`;
      case 'Large':
        return `<span class="latex-size-Large">${this.renderMacroArg(node, 0)}</span>`;
      case 'LARGE':
        return `<span class="latex-size-LARGE">${this.renderMacroArg(node, 0)}</span>`;
      case 'huge':
      case 'Huge':
        return `<span class="latex-size-Huge">${this.renderMacroArg(node, 0)}</span>`;

      // Headings
      case 'section': {
        this.sectionCount++;
        this.subsectionCount = 0;
        const sTitle = this.renderMacroArg(node, node.args && node.args.length > 1 ? 1 : 0);
        return `<h2 class="latex-section"><span class="section-num">${this.sectionCount}. </span>${sTitle}</h2>`;
      }
      case 'subsection': {
        this.subsectionCount++;
        const ssTitle = this.renderMacroArg(node, node.args && node.args.length > 1 ? 1 : 0);
        return `<h3 class="latex-subsection"><span class="section-num">${this.sectionCount}.${this.subsectionCount} </span>${ssTitle}</h3>`;
      }
      case 'subsubsection': {
        const sssTitle = this.renderMacroArg(node, node.args && node.args.length > 1 ? 1 : 0);
        return `<h4 class="latex-subsubsection">${sssTitle}</h4>`;
      }
      case 'paragraph': {
        const pTitle = this.renderMacroArg(node, 0);
        return `<h5 class="latex-paragraph">${pTitle}</h5>`;
      }

      // IEEE macros
      case 'IEEEauthorblockN':
        return `<div class="ieee-author-name">${this.renderMacroArg(node, 0)}</div>`;

      case 'IEEEauthorblockA':
        return `<div class="ieee-author-affil">${this.renderMacroArg(node, 0)}</div>`;

      case 'IEEEPARstart': {
        const first = this.renderMacroArg(node, 0);
        const second = this.renderMacroArg(node, 1);
        return `<span class="ieee-dropcap">${first}</span>${second}`;
      }

      case 'IEEEoverridecommandlockouts':
      case 'IEEEpubid':
        return '';

      // Math & Logos
      case 'LaTeX':
      case 'LaTeXe':
        return '<span class="latex-logo">LaTeX</span>';

      case 'TeX':
        return '<span class="tex-logo">TeX</span>';

      case 'today':
        return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

      case 'ldots':
      case 'dots':
        return '…';

      // Citations and Cross-references
      case 'cite': {
        const key = stripTags(this.renderMacroArg(node, 0)).trim();
        if (!this.cites.has(key)) {
          this.citeCount++;
          this.cites.set(key, this.citeCount);
        }
        const num = this.cites.get(key);
        return `<span class="latex-cite">[${num}]</span>`;
      }

      case 'ref': {
        const refKey = stripTags(this.renderMacroArg(node, 0)).trim();
        const refVal = this.labels.get(refKey) || '1';
        return `<span class="latex-ref">${refVal}</span>`;
      }

      case 'label': {
        const labelKey = stripTags(this.renderMacroArg(node, 0)).trim();
        if (labelKey.startsWith('fig:')) {
          this.labels.set(labelKey, `${this.figureCount || 1}`);
        } else if (labelKey.startsWith('tab:')) {
          this.labels.set(labelKey, `${this.tableCount || 1}`);
        } else if (labelKey.startsWith('eq:')) {
          this.labels.set(labelKey, `${this.equationCount || 1}`);
        } else {
          this.labels.set(labelKey, `${this.sectionCount || 1}`);
        }
        return '';
      }

      case 'bibitem': {
        const key = stripTags(this.renderMacroArg(node, 0)).trim();
        if (!this.cites.has(key)) {
          this.citeCount++;
          this.cites.set(key, this.citeCount);
        }
        const num = this.cites.get(key);
        return `<li class="latex-bibitem" value="${num}">`;
      }

      case 'item': {
        const opt = node.args && node.args.length > 0 && node.args[0].openMark === '[' ? this.renderMacroArg(node, 0) : null;
        if (opt) {
          return `<dt class="latex-item-term">${opt}</dt><dd class="latex-item-desc">`;
        }
        return '<li class="latex-item">';
      }

      case 'footnote':
        return `<sup class="latex-footnote" title="${escapeHtml(stripTags(this.renderMacroArg(node, 0)))}">[*]</sup>`;

      case 'caption': {
        const captionText = this.renderMacroArg(node, 0);
        return `<figcaption class="latex-caption">${captionText}</figcaption>`;
      }

      case 'framebox':
      case 'makebox':
        return `<div class="latex-framebox">${this.renderMacroArg(node, node.args ? node.args.length - 1 : 0)}</div>`;

      case 'rule':
        return '<hr class="latex-rule" />';

      case 'includegraphics': {
        const imgPath = stripTags(this.renderMacroArg(node, node.args ? node.args.length - 1 : 0)).trim();
        return `<div class="latex-image-placeholder">[Immagine: ${escapeHtml(imgPath)}]</div>`;
      }

      case 'tableofcontents':
        return '<div class="latex-toc"><strong>Indice</strong></div>';

      case 'centering':
      case 'raggedright':
      case 'raggedleft':
      case 'clearpage':
      case 'newpage':
      case 'vspace':
      case 'hspace':
      case 'pagestyle':
      case 'thispagestyle':
      case 'bibliographystyle':
      case 'bibliography':
      case 'hypersetup':
      case 'usepackage':
      case 'documentclass':
        return '';

      default: {
        const line = node.position ? node.position.start.line : 1;
        this.addWarning(`Unsupported: \\${name} (l.${line})`);
        if (node.args && node.args.length > 0) {
          return node.args.map(a => this.renderNodes(a.content || [])).join('');
        }
        return '';
      }
    }
  }

  renderEnvironment(node) {
    const envName = this.getEnvName(node);
    const contentNodes = node.content || [];

    switch (envName) {
      case 'document':
        return this.renderNodes(contentNodes);

      case 'abstract':
        if (this.isTwoColumn) return '';
        return `<div class="latex-abstract"><strong>Abstract</strong><p>${this.renderNodes(contentNodes)}</p></div>`;

      case 'IEEEkeywords':
      case 'keywords':
        if (this.isTwoColumn) return '';
        return `<div class="latex-keywords"><strong>Index Terms—</strong>${this.renderNodes(contentNodes)}</div>`;

      case 'itemize':
        return `<ul class="latex-list-unordered">${this.renderNodes(contentNodes)}</ul>`;

      case 'enumerate':
        return `<ol class="latex-list-ordered">${this.renderNodes(contentNodes)}</ol>`;

      case 'description':
        return `<dl class="latex-list-description">${this.renderNodes(contentNodes)}</dl>`;

      case 'figure':
      case 'figure*':
        this.figureCount++;
        return `<figure class="latex-figure">${this.renderNodes(contentNodes)}</figure>`;

      case 'table':
      case 'table*':
        this.tableCount++;
        return `<div class="latex-table-container">${this.renderNodes(contentNodes)}</div>`;

      case 'tabular':
      case 'tabularx':
        return this.renderTabular(node);

      case 'center':
        return `<div class="latex-center">${this.renderNodes(contentNodes)}</div>`;

      case 'verbatim':
      case 'lstlisting':
      case 'minted': {
        const rawCode = this.extractRawText(contentNodes);
        return `<pre class="latex-verbatim"><code>${escapeHtml(rawCode)}</code></pre>`;
      }

      case 'thebibliography':
        return `<div class="latex-bibliography"><h3>Riferimenti bibliografici</h3><ol class="latex-bib-list">${this.renderNodes(contentNodes)}</ol></div>`;

      case 'frame':
        return `<div class="beamer-frame">${this.renderNodes(contentNodes)}</div>`;

      case 'block':
      case 'exampleblock':
      case 'alertblock':
        return `<div class="beamer-block"><div class="beamer-block-content">${this.renderNodes(contentNodes)}</div></div>`;

      case 'equation':
      case 'equation*':
      case 'align':
      case 'align*':
      case 'gather':
      case 'gather*':
        this.equationCount++;
        return this.renderMathEnvironment(node, envName);

      default: {
        this.addWarning(`Unsupported environment: ${envName}`);
        return this.renderNodes(contentNodes);
      }
    }
  }

  renderTabular(node) {
    const rawNodes = node.content || [];
    const rows = [];
    let currentRow = [];

    for (const item of rawNodes) {
      if (item.type === 'macro' && item.content === '\\') {
        rows.push(currentRow);
        currentRow = [];
      } else if (item.type === 'macro' && item.content === 'hline') {
        // Skip hline
      } else {
        currentRow.push(item);
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);

    let tableHtml = '<table class="latex-table"><tbody>';
    for (const row of rows) {
      const cells = [];
      let currentCell = [];
      for (const token of row) {
        if (token.type === 'string' && token.content === '&') {
          cells.push(currentCell);
          currentCell = [];
        } else {
          currentCell.push(token);
        }
      }
      if (currentCell.length > 0) cells.push(currentCell);

      tableHtml += '<tr>';
      for (const cell of cells) {
        tableHtml += `<td>${this.renderNodes(cell)}</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';
    return tableHtml;
  }

  renderMath(node) {
    this.mathCount++;
    const rawMath = this.cleanMathContent(this.extractRawText(node.content || []));
    const isDisplay = node.type === 'displaymath' || node.type === 'mathenv';

    if (katex) {
      try {
        const rendered = katex.renderToString(rawMath, {
          displayMode: isDisplay,
          output: 'html',
          throwOnError: false
        });
        return `<span class="latex-math ${isDisplay ? 'display-math' : 'inline-math'}">${rendered}</span>`;
      } catch (err) {
        this.addWarning(`KaTeX warning: ${err.message}`);
      }
    }

    return `<span class="latex-math-fallback ${isDisplay ? 'display-math' : 'inline-math'}">${escapeHtml(rawMath)}</span>`;
  }

  cleanMathContent(rawMath) {
    // Extract and record \label inside math if present, and remove it so KaTeX doesn't choke
    return rawMath.replace(/\\label\{([^}]+)\}/g, (_m, key) => {
      this.labels.set(key.trim(), `${this.equationCount || 1}`);
      return '';
    });
  }

  renderMathEnvironment(node, envName) {
    this.mathCount++;
    const rawMath = this.cleanMathContent(this.extractRawText(node.content || []));
    const isNumbered = !envName.endsWith('*');

    let renderedMath = rawMath;
    if (katex) {
      try {
        renderedMath = katex.renderToString(rawMath, {
          displayMode: true,
          output: 'html',
          throwOnError: false
        });
      } catch (_) {
        renderedMath = escapeHtml(rawMath);
      }
    }

    return `
      <div class="latex-equation-row">
        <div class="latex-equation-body">${renderedMath}</div>
        ${isNumbered ? `<div class="latex-equation-num">(${this.equationCount})</div>` : ''}
      </div>
    `;
  }

  extractRawText(nodes) {
    if (!nodes) return '';
    if (typeof nodes === 'string') return nodes;
    if (!Array.isArray(nodes)) nodes = [nodes];

    let str = '';
    for (const node of nodes) {
      if (node.type === 'string') {
        str += node.content;
      } else if (node.type === 'whitespace') {
        str += ' ';
      } else if (node.type === 'macro') {
        if (node.content === 'label') {
          // Extract label key and skip emitting \label into math string
          const key = this.extractRawText(node.args ? node.args[node.args.length - 1].content || [] : []).trim();
          if (key) this.labels.set(key, `${this.equationCount || 1}`);
          continue;
        }
        str += `\\${node.content}`;
        if (node.args) {
          for (const arg of node.args) {
            str += `{${this.extractRawText(arg.content || [])}}`;
          }
        }
      } else if (node.type === 'group' || node.type === 'argument') {
        str += `{${this.extractRawText(node.content || [])}}`;
      } else if (node.content) {
        str += this.extractRawText(node.content);
      }
    }
    return str;
  }

  renderFallback(rawText) {
    const clean = rawText
      .replace(/%.*$/gm, '')
      .replace(/\\begin\{document\}/, '')
      .replace(/\\end\{document\}/, '');

    const safe = escapeHtml(clean)
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/[{}\\]/g, '');

    return {
      html: `<div class="latex-pages-stack"><div class="page-sheet-container"><div class="page-sheet-a4"><div class="page-sheet-content"><p>${safe}</p></div></div></div></div>`,
      warnings: ['Used emergency fallback parser'],
      sectionsCount: 0,
      mathCount: 0,
      pagesCount: 1
    };
  }
}

function convertLatexAstToHtml(latexText, options = {}) {
  const renderer = new LatexRenderer(options);
  return renderer.renderDoc(latexText);
}

module.exports = {
  LatexRenderer,
  convertLatexAstToHtml
};
