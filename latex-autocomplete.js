// ====== LACK LATEX AUTOCOMPLETE MODULE ======

const LATEX_COMMANDS = [
  // Document Structure
  { name: "\\documentclass", insert: "\\documentclass[11pt,a4paper]{article}\n", offset: -1, desc: "Document class (article, report, book, beamer)", cat: "structure" },
  { name: "\\usepackage", insert: "\\usepackage{}", offset: -1, desc: "Import package", cat: "structure" },
  { name: "\\begin{document}", insert: "\\begin{document}\n\n\\end{document}", offset: -15, desc: "Main document environment", cat: "structure" },
  { name: "\\section", insert: "\\section{}", offset: -1, desc: "Top-level section heading", cat: "structure" },
  { name: "\\subsection", insert: "\\subsection{}", offset: -1, desc: "Subsection heading", cat: "structure" },
  { name: "\\subsubsection", insert: "\\subsubsection{}", offset: -1, desc: "Sub-subsection heading", cat: "structure" },
  { name: "\\paragraph", insert: "\\paragraph{}", offset: -1, desc: "Paragraph heading", cat: "structure" },
  { name: "\\title", insert: "\\title{}", offset: -1, desc: "Document title", cat: "structure" },
  { name: "\\author", insert: "\\author{}", offset: -1, desc: "Document author(s)", cat: "structure" },
  { name: "\\date", insert: "\\date{\\today}", offset: -1, desc: "Document date", cat: "structure" },
  { name: "\\maketitle", insert: "\\maketitle\n", offset: 0, desc: "Generate title banner", cat: "structure" },
  { name: "\\tableofcontents", insert: "\\tableofcontents\n\\newpage\n", offset: 0, desc: "Generate table of contents", cat: "structure" },
  { name: "\\listoffigures", insert: "\\listoffigures\n", offset: 0, desc: "Generate list of figures", cat: "structure" },
  { name: "\\listoftables", insert: "\\listoftables\n", offset: 0, desc: "Generate list of tables", cat: "structure" },
  { name: "\\appendix", insert: "\\appendix\n", offset: 0, desc: "Begin appendix section", cat: "structure" },
  { name: "\\newpage", insert: "\\newpage\n", offset: 0, desc: "Insert page break", cat: "structure" },
  { name: "\\clearpage", insert: "\\clearpage\n", offset: 0, desc: "Flush floats and break page", cat: "structure" },
  { name: "\\input", insert: "\\input{}", offset: -1, desc: "Include another .tex file verbatim", cat: "structure" },
  { name: "\\include", insert: "\\include{}", offset: -1, desc: "Include file with page break", cat: "structure" },

  // Environments
  { name: "\\begin{equation}", insert: "\\begin{equation}\n  \n\\end{equation}", offset: -16, desc: "Numbered display math equation", cat: "env" },
  { name: "\\begin{equation*}", insert: "\\begin{equation*}\n  \n\\end{equation*}", offset: -17, desc: "Unnumbered display math equation", cat: "env" },
  { name: "\\begin{align}", insert: "\\begin{align}\n  \n\\end{align}", offset: -13, desc: "Aligned equations with alignment &", cat: "env" },
  { name: "\\begin{align*}", insert: "\\begin{align*}\n  \n\\end{align*}", offset: -14, desc: "Unnumbered aligned equations", cat: "env" },
  { name: "\\begin{figure}", insert: "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}", offset: -35, desc: "Floating figure with graphic, caption, label", cat: "env" },
  { name: "\\begin{table}", insert: "\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\label{tab:}\n  \\begin{tabular}{ccc}\n    \\hline\n    A & B & C \\\\\n    \\hline\n    1 & 2 & 3 \\\\\n    \\hline\n  \\end{tabular}\n\\end{table}", offset: -80, desc: "Floating table with tabular", cat: "env" },
  { name: "\\begin{tabular}", insert: "\\begin{tabular}{lcr}\n  \\hline\n   &  &  \\\\\n  \\hline\n\\end{tabular}", offset: -26, desc: "Tabular environment", cat: "env" },
  { name: "\\begin{itemize}", insert: "\\begin{itemize}\n  \\item \n\\end{itemize}", offset: -15, desc: "Bullet list", cat: "env" },
  { name: "\\begin{enumerate}", insert: "\\begin{enumerate}\n  \\item \n\\end{enumerate}", offset: -17, desc: "Numbered list", cat: "env" },
  { name: "\\begin{description}", insert: "\\begin{description}\n  \\item[] \n\\end{description}", offset: -19, desc: "Descriptive list with terms", cat: "env" },
  { name: "\\begin{abstract}", insert: "\\begin{abstract}\n  \n\\end{abstract}", offset: -15, desc: "Abstract environment", cat: "env" },
  { name: "\\begin{frame}", insert: "\\begin{frame}{Frame Title}\n  \n\\end{frame}", offset: -13, desc: "Beamer presentation slide", cat: "env" },
  { name: "\\begin{matrix}", insert: "\\begin{matrix}\n   &  \\\\\n   &  \\\\\n\\end{matrix}", offset: -25, desc: "Plain matrix", cat: "env" },
  { name: "\\begin{pmatrix}", insert: "\\begin{pmatrix}\n   &  \\\\\n   &  \\\\\n\\end{pmatrix}", offset: -26, desc: "Parentheses matrix ( )", cat: "env" },
  { name: "\\begin{bmatrix}", insert: "\\begin{bmatrix}\n   &  \\\\\n   &  \\\\\n\\end{bmatrix}", offset: -26, desc: "Bracket matrix [ ]", cat: "env" },
  { name: "\\begin{cases}", insert: "\\begin{cases}\n   & \\text{if }  \\\\\n   & \\text{otherwise}\n\\end{cases}", offset: -45, desc: "Piecewise function cases", cat: "env" },
  { name: "\\begin{proof}", insert: "\\begin{proof}\n  \n\\end{proof}", offset: -13, desc: "Mathematical proof block", cat: "env" },
  { name: "\\begin{theorem}", insert: "\\begin{theorem}\n  \n\\end{theorem}", offset: -15, desc: "Formal theorem block", cat: "env" },
  { name: "\\begin{lemma}", insert: "\\begin{lemma}\n  \n\\end{lemma}", offset: -13, desc: "Formal lemma block", cat: "env" },
  { name: "\\begin{minted}", insert: "\\begin{minted}{python}\n\n\\end{minted}", offset: -14, desc: "Syntax highlighted source code", cat: "env" },
  { name: "\\begin{lstlisting}", insert: "\\begin{lstlisting}[language=C]\n\n\\end{lstlisting}", offset: -17, desc: "Listings code block", cat: "env" },

  // Typography & Text Style
  { name: "\\textbf", insert: "\\textbf{}", offset: -1, desc: "Bold font weight", cat: "style" },
  { name: "\\textit", insert: "\\textit{}", offset: -1, desc: "Italic font shape", cat: "style" },
  { name: "\\underline", insert: "\\underline{}", offset: -1, desc: "Underlined text", cat: "style" },
  { name: "\\texttt", insert: "\\texttt{}", offset: -1, desc: "Monospace / typewriter font", cat: "style" },
  { name: "\\textsc", insert: "\\textsc{}", offset: -1, desc: "Small capitals font", cat: "style" },
  { name: "\\emph", insert: "\\emph{}", offset: -1, desc: "Emphasized text", cat: "style" },
  { name: "\\textcolor", insert: "\\textcolor{red}{}", offset: -1, desc: "Colored text (requires xcolor)", cat: "style" },
  { name: "\\tiny", insert: "{\\tiny }", offset: -1, desc: "Tiny font size", cat: "style" },
  { name: "\\footnotesize", insert: "{\\footnotesize }", offset: -1, desc: "Footnote font size", cat: "style" },
  { name: "\\small", insert: "{\\small }", offset: -1, desc: "Small font size", cat: "style" },
  { name: "\\large", insert: "{\\large }", offset: -1, desc: "Large font size", cat: "style" },
  { name: "\\Large", insert: "{\\Large }", offset: -1, desc: "Larger font size", cat: "style" },
  { name: "\\huge", insert: "{\\huge }", offset: -1, desc: "Huge font size", cat: "style" },
  { name: "\\footnote", insert: "\\footnote{}", offset: -1, desc: "Insert footnote", cat: "style" },

  // Mathematics
  { name: "\\frac", insert: "\\frac{}{}", offset: -3, desc: "Fraction numerator over denominator", cat: "math" },
  { name: "\\sqrt", insert: "\\sqrt{}", offset: -1, desc: "Square root", cat: "math" },
  { name: "\\sum", insert: "\\sum_{i=1}^{n}", offset: 0, desc: "Summation with limits", cat: "math" },
  { name: "\\int", insert: "\\int_{a}^{b}", offset: 0, desc: "Definite integral", cat: "math" },
  { name: "\\iint", insert: "\\iint", offset: 0, desc: "Double integral", cat: "math" },
  { name: "\\iiint", insert: "\\iiint", offset: 0, desc: "Triple integral", cat: "math" },
  { name: "\\oint", insert: "\\oint", offset: 0, desc: "Contour integral", cat: "math" },
  { name: "\\prod", insert: "\\prod_{i=1}^{n}", offset: 0, desc: "Product notation", cat: "math" },
  { name: "\\lim", insert: "\\lim_{x \\to \\infty}", offset: 0, desc: "Limit notation", cat: "math" },
  { name: "\\partial", insert: "\\partial", offset: 0, desc: "Partial derivative symbol (∂)", cat: "math" },
  { name: "\\infty", insert: "\\infty", offset: 0, desc: "Infinity symbol (∞)", cat: "math" },
  { name: "\\vec", insert: "\\vec{}", offset: -1, desc: "Vector accent arrow", cat: "math" },
  { name: "\\hat", insert: "\\hat{}", offset: -1, desc: "Hat accent", cat: "math" },
  { name: "\\dot", insert: "\\dot{}", offset: -1, desc: "Time derivative single dot", cat: "math" },
  { name: "\\ddot", insert: "\\ddot{}", offset: -1, desc: "Time derivative double dot", cat: "math" },
  { name: "\\left(", insert: "\\left(  \\right)", offset: -8, desc: "Auto-sizing parentheses", cat: "math" },
  { name: "\\left[", insert: "\\left[  \\right]", offset: -8, desc: "Auto-sizing square brackets", cat: "math" },
  { name: "\\left\\{", insert: "\\left\\{  \\right\\}", offset: -9, desc: "Auto-sizing curly braces", cat: "math" },
  { name: "\\mathbf", insert: "\\mathbf{}", offset: -1, desc: "Bold math symbols", cat: "math" },
  { name: "\\mathcal", insert: "\\mathcal{}", offset: -1, desc: "Calligraphic math alphabet", cat: "math" },
  { name: "\\mathbb", insert: "\\mathbb{R}", offset: -1, desc: "Blackboard bold (R, C, N, Z)", cat: "math" },
  { name: "\\mathrm", insert: "\\mathrm{}", offset: -1, desc: "Upright Roman math text", cat: "math" },
  { name: "\\text", insert: "\\text{}", offset: -1, desc: "Regular text inside math formula", cat: "math" },
  { name: "\\cdot", insert: "\\cdot", offset: 0, desc: "Center dot multiplication (·)", cat: "math" },
  { name: "\\times", insert: "\\times", offset: 0, desc: "Multiplication cross (×)", cat: "math" },
  { name: "\\pm", insert: "\\pm", offset: 0, desc: "Plus-minus sign (±)", cat: "math" },
  { name: "\\leq", insert: "\\leq", offset: 0, desc: "Less than or equal (≤)", cat: "math" },
  { name: "\\geq", insert: "\\geq", offset: 0, desc: "Greater than or equal (≥)", cat: "math" },
  { name: "\\neq", insert: "\\neq", offset: 0, desc: "Not equal sign (≠)", cat: "math" },
  { name: "\\approx", insert: "\\approx", offset: 0, desc: "Approximately equal (≈)", cat: "math" },
  { name: "\\equiv", insert: "\\equiv", offset: 0, desc: "Equivalent / identical to (≡)", cat: "math" },
  { name: "\\forall", insert: "\\forall", offset: 0, desc: "Universal quantifier (∀)", cat: "math" },
  { name: "\\exists", insert: "\\exists", offset: 0, desc: "Existential quantifier (∃)", cat: "math" },
  { name: "\\in", insert: "\\in", offset: 0, desc: "Element of set (∈)", cat: "math" },
  { name: "\\notin", insert: "\\notin", offset: 0, desc: "Not an element of (∉)", cat: "math" },
  { name: "\\subset", insert: "\\subset", offset: 0, desc: "Subset of (⊂)", cat: "math" },
  { name: "\\subseteq", insert: "\\subseteq", offset: 0, desc: "Subset or equal (⊆)", cat: "math" },
  { name: "\\cup", insert: "\\cup", offset: 0, desc: "Set union (∪)", cat: "math" },
  { name: "\\cap", insert: "\\cap", offset: 0, desc: "Set intersection (∩)", cat: "math" },
  { name: "\\to", insert: "\\to", offset: 0, desc: "Right arrow / maps to (→)", cat: "math" },
  { name: "\\implies", insert: "\\implies", offset: 0, desc: "Logical implication (⟹)", cat: "math" },
  { name: "\\iff", insert: "\\iff", offset: 0, desc: "If and only if (⟺)", cat: "math" },

  // Greek Letters
  { name: "\\alpha", insert: "\\alpha", offset: 0, desc: "Greek letter α", cat: "symbol" },
  { name: "\\beta", insert: "\\beta", offset: 0, desc: "Greek letter β", cat: "symbol" },
  { name: "\\gamma", insert: "\\gamma", offset: 0, desc: "Greek letter γ", cat: "symbol" },
  { name: "\\delta", insert: "\\delta", offset: 0, desc: "Greek letter δ", cat: "symbol" },
  { name: "\\epsilon", insert: "\\epsilon", offset: 0, desc: "Greek letter ϵ", cat: "symbol" },
  { name: "\\varepsilon", insert: "\\varepsilon", offset: 0, desc: "Greek letter ε", cat: "symbol" },
  { name: "\\zeta", insert: "\\zeta", offset: 0, desc: "Greek letter ζ", cat: "symbol" },
  { name: "\\eta", insert: "\\eta", offset: 0, desc: "Greek letter η", cat: "symbol" },
  { name: "\\theta", insert: "\\theta", offset: 0, desc: "Greek letter θ", cat: "symbol" },
  { name: "\\lambda", insert: "\\lambda", offset: 0, desc: "Greek letter λ", cat: "symbol" },
  { name: "\\mu", insert: "\\mu", offset: 0, desc: "Greek letter μ", cat: "symbol" },
  { name: "\\nu", insert: "\\nu", offset: 0, desc: "Greek letter ν", cat: "symbol" },
  { name: "\\pi", insert: "\\pi", offset: 0, desc: "Greek letter π", cat: "symbol" },
  { name: "\\rho", insert: "\\rho", offset: 0, desc: "Greek letter ρ", cat: "symbol" },
  { name: "\\sigma", insert: "\\sigma", offset: 0, desc: "Greek letter σ", cat: "symbol" },
  { name: "\\tau", insert: "\\tau", offset: 0, desc: "Greek letter τ", cat: "symbol" },
  { name: "\\phi", insert: "\\phi", offset: 0, desc: "Greek letter ϕ", cat: "symbol" },
  { name: "\\omega", insert: "\\omega", offset: 0, desc: "Greek letter ω", cat: "symbol" },
  { name: "\\Gamma", insert: "\\Gamma", offset: 0, desc: "Uppercase Greek Γ", cat: "symbol" },
  { name: "\\Delta", insert: "\\Delta", offset: 0, desc: "Uppercase Greek Δ", cat: "symbol" },
  { name: "\\Theta", insert: "\\Theta", offset: 0, desc: "Uppercase Greek Θ", cat: "symbol" },
  { name: "\\Lambda", insert: "\\Lambda", offset: 0, desc: "Uppercase Greek Λ", cat: "symbol" },
  { name: "\\Sigma", insert: "\\Sigma", offset: 0, desc: "Uppercase Greek Σ", cat: "symbol" },
  { name: "\\Phi", insert: "\\Phi", offset: 0, desc: "Uppercase Greek Φ", cat: "symbol" },
  { name: "\\Omega", insert: "\\Omega", offset: 0, desc: "Uppercase Greek Ω", cat: "symbol" },

  // References, Citations, Graphics
  { name: "\\label", insert: "\\label{}", offset: -1, desc: "Assign cross-reference label", cat: "cite" },
  { name: "\\ref", insert: "\\ref{}", offset: -1, desc: "Reference figure/table/section", cat: "cite" },
  { name: "\\eqref", insert: "\\eqref{}", offset: -1, desc: "Reference equation (with parentheses)", cat: "cite" },
  { name: "\\cite", insert: "\\cite{}", offset: -1, desc: "Insert bibliographic citation", cat: "cite" },
  { name: "\\bibliography", insert: "\\bibliography{references}\n", offset: -2, desc: "Include BibTeX .bib database", cat: "cite" },
  { name: "\\bibliographystyle", insert: "\\bibliographystyle{plain}\n", offset: -2, desc: "Set bibliography style", cat: "cite" },
  { name: "\\includegraphics", insert: "\\includegraphics[width=0.8\\linewidth]{}", offset: -1, desc: "Include image file", cat: "structure" },
  { name: "\\caption", insert: "\\caption{}", offset: -1, desc: "Figure or table caption", cat: "structure" },
  { name: "\\href", insert: "\\href{url}{text}", offset: -7, desc: "Hyperlink with text (hyperref)", cat: "structure" },
  { name: "\\url", insert: "\\url{}", offset: -1, desc: "Verbatim clickable URL (hyperref)", cat: "structure" }
];

class LatexAutocomplete {
  constructor(editorEl, containerEl, onInsertCallback) {
    this.editor = editorEl;
    this.container = containerEl;
    this.onInsert = onInsertCallback;
    this.selectedIndex = 0;
    this.filteredCommands = [];
    this.isActive = false;
    this.matchStart = 0;
    this.matchEnd = 0;

    this.initUI();
    this.bindEvents();
  }

  initUI() {
    this.popup = document.createElement("div");
    this.popup.className = "latex-autocomplete-popup hidden";
    this.popup.id = "latex-autocomplete-popup";
    document.body.appendChild(this.popup);
  }

  bindEvents() {
    this.editor.addEventListener("keydown", (e) => this.handleKeyDown(e));
    this.editor.addEventListener("input", () => this.handleInput());
    this.editor.addEventListener("blur", () => {
      // Delay closing so click inside autocomplete works
      setTimeout(() => this.hide(), 180);
    });
  }

  handleInput() {
    const pos = this.editor.selectionStart;
    const val = this.editor.value;
    const textBefore = val.slice(0, pos);

    // Look for command trigger starting with backslash \
    const match = textBefore.match(/\\([a-zA-Z*]*)$/);
    if (!match) {
      this.hide();
      return;
    }

    const query = "\\" + match[1];
    this.matchStart = pos - match[0].length;
    this.matchEnd = pos;

    this.filteredCommands = LATEX_COMMANDS.filter(cmd =>
      cmd.name.toLowerCase().startsWith(query.toLowerCase())
    ).slice(0, 10);

    if (this.filteredCommands.length === 0) {
      this.hide();
      return;
    }

    this.selectedIndex = 0;
    this.render();
    this.show();
  }

  handleKeyDown(e) {
    if (!this.isActive) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.filteredCommands.length;
      this.updateSelection();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
      this.updateSelection();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.insertSelected();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.hide();
    }
  }

  render() {
    this.popup.innerHTML = "";
    this.filteredCommands.forEach((cmd, idx) => {
      const item = document.createElement("div");
      item.className = "latex-autocomplete-item" + (idx === this.selectedIndex ? " selected" : "");
      item.innerHTML = `
        <span class="latex-auto-name">${cmd.name}</span>
        <span class="latex-auto-cat">${cmd.cat}</span>
        <span class="latex-auto-desc">${cmd.desc}</span>
      `;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.selectedIndex = idx;
        this.insertSelected();
      });
      this.popup.appendChild(item);
    });

    this.positionPopup();
  }

  positionPopup() {
    // Position popup near cursor or editor toolbar
    const editorRect = this.editor.getBoundingClientRect();
    const lineHeight = 22;
    const textBefore = this.editor.value.substring(0, this.editor.selectionStart);
    const lines = textBefore.split("\n");
    const currentLine = lines.length - 1;
    const currentCol = lines[lines.length - 1].length;

    const charWidth = 8.5; // average monospace char width
    let top = editorRect.top + (currentLine * lineHeight) - this.editor.scrollTop + 26;
    let left = editorRect.left + (currentCol * charWidth) - this.editor.scrollLeft + 15;

    // Boundary checks
    if (top + 220 > window.innerHeight) {
      top = Math.max(10, top - 230);
    }
    if (left + 350 > window.innerWidth) {
      left = Math.max(10, window.innerWidth - 370);
    }

    this.popup.style.top = `${Math.max(50, top)}px`;
    this.popup.style.left = `${Math.max(20, left)}px`;
  }

  updateSelection() {
    const items = this.popup.querySelectorAll(".latex-autocomplete-item");
    items.forEach((item, idx) => {
      if (idx === this.selectedIndex) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }

  insertSelected() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.filteredCommands.length) return;
    const selected = this.filteredCommands[this.selectedIndex];
    const val = this.editor.value;

    const before = val.substring(0, this.matchStart);
    const after = val.substring(this.matchEnd);

    this.editor.value = before + selected.insert + after;
    const newPos = this.matchStart + selected.insert.length + (selected.offset || 0);
    this.editor.selectionStart = newPos;
    this.editor.selectionEnd = newPos;

    this.hide();
    if (typeof this.onInsert === "function") {
      this.onInsert(selected);
    }
    this.editor.focus();
  }

  show() {
    this.popup.classList.remove("hidden");
    this.isActive = true;
  }

  hide() {
    this.popup.classList.add("hidden");
    this.isActive = false;
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    LATEX_COMMANDS,
    LatexAutocomplete
  };
}
