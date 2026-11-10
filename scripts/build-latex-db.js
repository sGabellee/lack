/**
 * scripts/build-latex-db.js
 * Generates data/latex-commands.json containing macros and environments
 * from @unified-latex/unified-latex-ctan (MIT) and curated core LaTeX definitions.
 */

const fs = require('fs');
const path = require('path');

let ctanMacros = {};
let ctanEnvs = {};
try {
  const ctan = require('@unified-latex/unified-latex-ctan');
  ctanMacros = ctan.macroInfo || {};
  ctanEnvs = ctan.environmentInfo || {};
} catch (e) {
  console.warn('Could not load @unified-latex/unified-latex-ctan:', e.message);
}

// Curated high-priority definitions with rich snippets, Italian & English documentation
const CURATED_MACROS = [
  // Document Structure
  { name: 'documentclass', package: 'latex2e', args: 'o m', snippet: '\\documentclass[${1:11pt,a4paper}]{${2:article}}', doc_it: 'Dichiara la classe del documento (article, report, book, beamer)', doc_en: 'Declares document class (article, report, book, beamer)' },
  { name: 'usepackage', package: 'latex2e', args: 'o m', snippet: '\\usepackage[${1:options}]{${2:package}}', doc_it: 'Carica un pacchetto LaTeX', doc_en: 'Loads a LaTeX package' },
  { name: 'title', package: 'latex2e', args: 'm', snippet: '\\title{${1:Title}}', doc_it: 'Titolo del documento', doc_en: 'Document title' },
  { name: 'author', package: 'latex2e', args: 'm', snippet: '\\author{${1:Author Name}}', doc_it: 'Autore del documento', doc_en: 'Document author' },
  { name: 'date', package: 'latex2e', args: 'm', snippet: '\\date{${1:\\today}}', doc_it: 'Data del documento', doc_en: 'Document date' },
  { name: 'maketitle', package: 'latex2e', args: '', snippet: '\\maketitle', doc_it: 'Genera il titolo e intestazione', doc_en: 'Generates title banner' },
  { name: 'tableofcontents', package: 'latex2e', args: '', snippet: '\\tableofcontents', doc_it: 'Genera l\'indice generale', doc_en: 'Generates table of contents' },
  { name: 'section', package: 'latex2e', args: 'm', snippet: '\\section{${1:Title}}', doc_it: 'Nuova sezione numerata', doc_en: 'New numbered section' },
  { name: 'subsection', package: 'latex2e', args: 'm', snippet: '\\subsection{${1:Title}}', doc_it: 'Nuova sottosezione numerata', doc_en: 'New numbered subsection' },
  { name: 'subsubsection', package: 'latex2e', args: 'm', snippet: '\\subsubsection{${1:Title}}', doc_it: 'Nuova sotto-sottosezione', doc_en: 'New sub-subsection' },
  { name: 'paragraph', package: 'latex2e', args: 'm', snippet: '\\paragraph{${1:Heading}}', doc_it: 'Paragrafo titolato', doc_en: 'Titled paragraph' },
  { name: 'subparagraph', package: 'latex2e', args: 'm', snippet: '\\subparagraph{${1:Heading}}', doc_it: 'Sottoparagrafo titolato', doc_en: 'Subparagraph heading' },
  { name: 'chapter', package: 'latex2e', args: 'm', snippet: '\\chapter{${1:Chapter Title}}', doc_it: 'Capitolo (per classi report e book)', doc_en: 'Chapter (report/book classes)' },
  { name: 'appendix', package: 'latex2e', args: '', snippet: '\\appendix', doc_it: 'Inizia la sezione delle appendici', doc_en: 'Begins appendices section' },
  { name: 'newpage', package: 'latex2e', args: '', snippet: '\\newpage', doc_it: 'Interrompe la pagina corrente e ne inizia una nuova', doc_en: 'Page break' },
  { name: 'clearpage', package: 'latex2e', args: '', snippet: '\\clearpage', doc_it: 'Scarica tutti gli elementi flottanti e crea nuova pagina', doc_en: 'Clears floats and starts new page' },
  { name: 'pagebreak', package: 'latex2e', args: '', snippet: '\\pagebreak', doc_it: 'Suggerisce o forza interruzione pagina', doc_en: 'Page break hint/force' },

  // Referencing & Citations
  { name: 'label', package: 'latex2e', args: 'm', snippet: '\\label{${1:key}}', doc_it: 'Assegna un\'etichetta per riferimenti incrociati', doc_en: 'Assigns label for cross-referencing' },
  { name: 'ref', package: 'latex2e', args: 'm', snippet: '\\ref{${1:key}}', doc_it: 'Riferimento al numero di sezione o figura', doc_en: 'Reference to section or figure number' },
  { name: 'eqref', package: 'amsmath', args: 'm', snippet: '\\eqref{${1:eq:key}}', doc_it: 'Riferimento numerato tra parentesi per equazioni', doc_en: 'Equation reference enclosed in parentheses' },
  { name: 'pageref', package: 'latex2e', args: 'm', snippet: '\\pageref{${1:key}}', doc_it: 'Riferimento al numero di pagina', doc_en: 'Reference to page number' },
  { name: 'autoref', package: 'hyperref', args: 'm', snippet: '\\autoref{${1:key}}', doc_it: 'Riferimento con prefisso automatico (Sezione, Figura, ecc.)', doc_en: 'Reference with automatic name prefix' },
  { name: 'cref', package: 'cleveref', args: 'm', snippet: '\\cref{${1:key}}', doc_it: 'Riferimento intelligente cleveref in minuscolo', doc_en: 'Clever reference (lowercase)' },
  { name: 'Cref', package: 'cleveref', args: 'm', snippet: '\\Cref{${1:key}}', doc_it: 'Riferimento intelligente cleveref con iniziale maiuscola', doc_en: 'Clever reference (capitalized)' },
  { name: 'cite', package: 'latex2e', args: 'm', snippet: '\\cite{${1:bibkey}}', doc_it: 'Citazione bibliografica', doc_en: 'Bibliographic citation' },
  { name: 'citep', package: 'natbib', args: 'm', snippet: '\\citep{${1:bibkey}}', doc_it: 'Citazione tra parentesi (Autore, Anno)', doc_en: 'Parenthetical citation (Author, Year)' },
  { name: 'citet', package: 'natbib', args: 'm', snippet: '\\citet{${1:bibkey}}', doc_it: 'Citazione testuale Autore (Anno)', doc_en: 'Textual citation Author (Year)' },
  { name: 'footnote', package: 'latex2e', args: 'm', snippet: '\\footnote{${1:Note text}}', doc_it: 'Nota a piè di pagina', doc_en: 'Footnote' },

  // Text Formatting
  { name: 'textbf', package: 'latex2e', args: 'm', snippet: '\\textbf{${1:text}}', doc_it: 'Testo in grassetto', doc_en: 'Bold text' },
  { name: 'textit', package: 'latex2e', args: 'm', snippet: '\\textit{${1:text}}', doc_it: 'Testo in corsivo', doc_en: 'Italic text' },
  { name: 'underline', package: 'latex2e', args: 'm', snippet: '\\underline{${1:text}}', doc_it: 'Testo sottolineato', doc_en: 'Underlined text' },
  { name: 'texttt', package: 'latex2e', args: 'm', snippet: '\\texttt{${1:code}}', doc_it: 'Testo a spaziatura fissa (monospace/codice)', doc_en: 'Monospace font text' },
  { name: 'textsc', package: 'latex2e', args: 'm', snippet: '\\textsc{${1:text}}', doc_it: 'Testo in maiuscoletto (Small Caps)', doc_en: 'Small caps text' },
  { name: 'emph', package: 'latex2e', args: 'm', snippet: '\\emph{${1:text}}', doc_it: 'Testo enfatizzato', doc_en: 'Emphasized text' },

  // Math Commands
  { name: 'frac', package: 'latex2e', args: 'm m', snippet: '\\frac{${1:numerator}}{${2:denominator}}', doc_it: 'Frazione matematica', doc_en: 'Mathematical fraction' },
  { name: 'sqrt', package: 'latex2e', args: 'o m', snippet: '\\sqrt[${1:n}]{${2:x}}', doc_it: 'Radice quadrata o n-esima', doc_en: 'Square or nth root' },
  { name: 'sum', package: 'latex2e', args: '', snippet: '\\sum_{${1:i=1}}^{${2:n}}', doc_it: 'Sommatoria matematica', doc_en: 'Summation symbol' },
  { name: 'prod', package: 'latex2e', args: '', snippet: '\\prod_{${1:i=1}}^{${2:n}}', doc_it: 'Produttoria matematica', doc_en: 'Product symbol' },
  { name: 'int', package: 'latex2e', args: '', snippet: '\\int_{${1:a}}^{${2:b}} ${3:f(x)} \\, d${4:x}', doc_it: 'Integrale', doc_en: 'Integral' },
  { name: 'iint', package: 'amsmath', args: '', snippet: '\\iint_{${1:D}}', doc_it: 'Integrale doppio', doc_en: 'Double integral' },
  { name: 'iiint', package: 'amsmath', args: '', snippet: '\\iiint_{${1:V}}', doc_it: 'Integrale triplo', doc_en: 'Triple integral' },
  { name: 'oint', package: 'latex2e', args: '', snippet: '\\oint_{${1:C}}', doc_it: 'Integrale di linea su curva chiusa', doc_en: 'Contour integral' },
  { name: 'lim', package: 'latex2e', args: '', snippet: '\\lim_{${1:x \\to ${2:x_0}}}', doc_it: 'Limite matematico', doc_en: 'Mathematical limit' },
  { name: 'partial', package: 'latex2e', args: '', snippet: '\\partial', doc_it: 'Simbolo di derivata parziale', doc_en: 'Partial derivative symbol' },
  { name: 'nabla', package: 'latex2e', args: '', snippet: '\\nabla', doc_it: 'Operatore nabla/gradiente', doc_en: 'Nabla/gradient operator' },
  { name: 'mathbb', package: 'amssymb', args: 'm', snippet: '\\mathbb{${1:R}}', doc_it: 'Font blackboard bold (es. R, N, Z, C)', doc_en: 'Blackboard bold font (R, N, Z, C)' },
  { name: 'mathcal', package: 'latex2e', args: 'm', snippet: '\\mathcal{${1:F}}', doc_it: 'Font matematico calligrafico', doc_en: 'Calligraphic math font' },
  { name: 'mathbf', package: 'latex2e', args: 'm', snippet: '\\mathbf{${1:v}}', doc_it: 'Grassetto matematico (vettori/matrici)', doc_en: 'Bold math font' },
  { name: 'mathrm', package: 'latex2e', args: 'm', snippet: '\\mathrm{${1:text}}', doc_it: 'Testo romano dritto in formula', doc_en: 'Roman font inside math' },
  { name: 'operatorname', package: 'amsmath', args: 'm', snippet: '\\operatorname{${1:name}}', doc_it: 'Dichiara un nome di operatore matematico personalizzato', doc_en: 'Custom math operator name' },
  { name: 'DeclareMathOperator', package: 'amsmath', args: 'm m', snippet: '\\DeclareMathOperator{\\${1:op}}{${2:operator}}', doc_it: 'Dichiara permanentemente un operatore matematico nel preambolo', doc_en: 'Declares custom math operator in preamble' },
  { name: 'sin', package: 'latex2e', args: '', snippet: '\\sin', doc_it: 'Seno', doc_en: 'Sine function' },
  { name: 'cos', package: 'latex2e', args: '', snippet: '\\cos', doc_it: 'Coseno', doc_en: 'Cosine function' },
  { name: 'tan', package: 'latex2e', args: '', snippet: '\\tan', doc_it: 'Tangente', doc_en: 'Tangent function' },
  { name: 'log', package: 'latex2e', args: '', snippet: '\\log', doc_it: 'Logaritmo', doc_en: 'Logarithm' },
  { name: 'ln', package: 'latex2e', args: '', snippet: '\\ln', doc_it: 'Logaritmo naturale', doc_en: 'Natural logarithm' },
  { name: 'exp', package: 'latex2e', args: '', snippet: '\\exp', doc_it: 'Esponenziale', doc_en: 'Exponential' },
  { name: 'det', package: 'latex2e', args: '', snippet: '\\det', doc_it: 'Determinante di una matrice', doc_en: 'Determinant' },
  { name: 'dim', package: 'latex2e', args: '', snippet: '\\dim', doc_it: 'Dimensione di uno spazio vettoriale', doc_en: 'Dimension' },
  { name: 'ker', package: 'latex2e', args: '', snippet: '\\ker', doc_it: 'Nucleo (kernel) di una trasformazione lineare', doc_en: 'Kernel' },

  // Greek Letters (Lowercase)
  { name: 'alpha', package: 'latex2e', args: '', snippet: '\\alpha', doc_it: 'Lettera greca alpha (α)', doc_en: 'Greek letter alpha' },
  { name: 'beta', package: 'latex2e', args: '', snippet: '\\beta', doc_it: 'Lettera greca beta (β)', doc_en: 'Greek letter beta' },
  { name: 'gamma', package: 'latex2e', args: '', snippet: '\\gamma', doc_it: 'Lettera greca gamma (γ)', doc_en: 'Greek letter gamma' },
  { name: 'delta', package: 'latex2e', args: '', snippet: '\\delta', doc_it: 'Lettera greca delta (δ)', doc_en: 'Greek letter delta' },
  { name: 'epsilon', package: 'latex2e', args: '', snippet: '\\epsilon', doc_it: 'Lettera greca epsilon (ε)', doc_en: 'Greek letter epsilon' },
  { name: 'varepsilon', package: 'latex2e', args: '', snippet: '\\varepsilon', doc_it: 'Variante grafica epsilon (ε)', doc_en: 'Variant epsilon' },
  { name: 'zeta', package: 'latex2e', args: '', snippet: '\\zeta', doc_it: 'Lettera greca zeta (ζ)', doc_en: 'Greek letter zeta' },
  { name: 'eta', package: 'latex2e', args: '', snippet: '\\eta', doc_it: 'Lettera greca eta (η)', doc_en: 'Greek letter eta' },
  { name: 'theta', package: 'latex2e', args: '', snippet: '\\theta', doc_it: 'Lettera greca theta (θ)', doc_en: 'Greek letter theta' },
  { name: 'vartheta', package: 'latex2e', args: '', snippet: '\\vartheta', doc_it: 'Variante grafica theta (ϑ)', doc_en: 'Variant theta' },
  { name: 'iota', package: 'latex2e', args: '', snippet: '\\iota', doc_it: 'Lettera greca iota (ι)', doc_en: 'Greek letter iota' },
  { name: 'kappa', package: 'latex2e', args: '', snippet: '\\kappa', doc_it: 'Lettera greca kappa (κ)', doc_en: 'Greek letter kappa' },
  { name: 'lambda', package: 'latex2e', args: '', snippet: '\\lambda', doc_it: 'Lettera greca lambda (λ)', doc_en: 'Greek letter lambda' },
  { name: 'mu', package: 'latex2e', args: '', snippet: '\\mu', doc_it: 'Lettera greca mu (μ)', doc_en: 'Greek letter mu' },
  { name: 'nu', package: 'latex2e', args: '', snippet: '\\nu', doc_it: 'Lettera greca nu (ν)', doc_en: 'Greek letter nu' },
  { name: 'xi', package: 'latex2e', args: '', snippet: '\\xi', doc_it: 'Lettera greca xi (ξ)', doc_en: 'Greek letter xi' },
  { name: 'pi', package: 'latex2e', args: '', snippet: '\\pi', doc_it: 'Costante o lettera pi greco (π)', doc_en: 'Greek letter pi' },
  { name: 'varpi', package: 'latex2e', args: '', snippet: '\\varpi', doc_it: 'Variante pi greco (ϖ)', doc_en: 'Variant pi' },
  { name: 'rho', package: 'latex2e', args: '', snippet: '\\rho', doc_it: 'Lettera greca rho (ρ)', doc_en: 'Greek letter rho' },
  { name: 'varrho', package: 'latex2e', args: '', snippet: '\\varrho', doc_it: 'Variante grafica rho (ϱ)', doc_en: 'Variant rho' },
  { name: 'sigma', package: 'latex2e', args: '', snippet: '\\sigma', doc_it: 'Lettera greca sigma (σ)', doc_en: 'Greek letter sigma' },
  { name: 'varsigma', package: 'latex2e', args: '', snippet: '\\varsigma', doc_it: 'Sigma finale (ς)', doc_en: 'Final sigma' },
  { name: 'tau', package: 'latex2e', args: '', snippet: '\\tau', doc_it: 'Lettera greca tau (τ)', doc_en: 'Greek letter tau' },
  { name: 'upsilon', package: 'latex2e', args: '', snippet: '\\upsilon', doc_it: 'Lettera greca upsilon (υ)', doc_en: 'Greek letter upsilon' },
  { name: 'phi', package: 'latex2e', args: '', snippet: '\\phi', doc_it: 'Lettera greca phi (ϕ)', doc_en: 'Greek letter phi' },
  { name: 'varphi', package: 'latex2e', args: '', snippet: '\\varphi', doc_it: 'Variante grafica phi (φ)', doc_en: 'Variant phi' },
  { name: 'chi', package: 'latex2e', args: '', snippet: '\\chi', doc_it: 'Lettera greca chi (χ)', doc_en: 'Greek letter chi' },
  { name: 'psi', package: 'latex2e', args: '', snippet: '\\psi', doc_it: 'Lettera greca psi (ψ)', doc_en: 'Greek letter psi' },
  { name: 'omega', package: 'latex2e', args: '', snippet: '\\omega', doc_it: 'Lettera greca omega (ω)', doc_en: 'Greek letter omega' },

  // Greek Letters (Uppercase)
  { name: 'Gamma', package: 'latex2e', args: '', snippet: '\\Gamma', doc_it: 'Gamma maiuscola (Γ)', doc_en: 'Capital Gamma' },
  { name: 'Delta', package: 'latex2e', args: '', snippet: '\\Delta', doc_it: 'Delta maiuscola / Laplaciano (Δ)', doc_en: 'Capital Delta' },
  { name: 'Theta', package: 'latex2e', args: '', snippet: '\\Theta', doc_it: 'Theta maiuscola (Θ)', doc_en: 'Capital Theta' },
  { name: 'Lambda', package: 'latex2e', args: '', snippet: '\\Lambda', doc_it: 'Lambda maiuscola (Λ)', doc_en: 'Capital Lambda' },
  { name: 'Xi', package: 'latex2e', args: '', snippet: '\\Xi', doc_it: 'Xi maiuscola (Ξ)', doc_en: 'Capital Xi' },
  { name: 'Pi', package: 'latex2e', args: '', snippet: '\\Pi', doc_it: 'Pi greco maiuscolo (Π)', doc_en: 'Capital Pi' },
  { name: 'Sigma', package: 'latex2e', args: '', snippet: '\\Sigma', doc_it: 'Sigma maiuscola (Σ)', doc_en: 'Capital Sigma' },
  { name: 'Upsilon', package: 'latex2e', args: '', snippet: '\\Upsilon', doc_it: 'Upsilon maiuscola (Υ)', doc_en: 'Capital Upsilon' },
  { name: 'Phi', package: 'latex2e', args: '', snippet: '\\Phi', doc_it: 'Phi maiuscola (Φ)', doc_en: 'Capital Phi' },
  { name: 'Psi', package: 'latex2e', args: '', snippet: '\\Psi', doc_it: 'Psi maiuscola (Ψ)', doc_en: 'Capital Psi' },
  { name: 'Omega', package: 'latex2e', args: '', snippet: '\\Omega', doc_it: 'Omega maiuscola (Ω)', doc_en: 'Capital Omega' },

  // Math Operators & Relations
  { name: 'le', package: 'latex2e', args: '', snippet: '\\le', doc_it: 'Minore o uguale (≤)', doc_en: 'Less than or equal' },
  { name: 'leq', package: 'latex2e', args: '', snippet: '\\leq', doc_it: 'Minore o uguale (≤)', doc_en: 'Less than or equal' },
  { name: 'ge', package: 'latex2e', args: '', snippet: '\\ge', doc_it: 'Maggiore o uguale (≥)', doc_en: 'Greater than or equal' },
  { name: 'geq', package: 'latex2e', args: '', snippet: '\\geq', doc_it: 'Maggiore o uguale (≥)', doc_en: 'Greater than or equal' },
  { name: 'neq', package: 'latex2e', args: '', snippet: '\\neq', doc_it: 'Diverso da (≠)', doc_en: 'Not equal' },
  { name: 'approx', package: 'latex2e', args: '', snippet: '\\approx', doc_it: 'Circa uguale / approssimativamente (≈)', doc_en: 'Approximately equal' },
  { name: 'equiv', package: 'latex2e', args: '', snippet: '\\equiv', doc_it: 'Identico o congruo (≡)', doc_en: 'Equivalent/congruent' },
  { name: 'in', package: 'latex2e', args: '', snippet: '\\in', doc_it: 'Appartiene all\'insieme (∈)', doc_en: 'Element of' },
  { name: 'notin', package: 'latex2e', args: '', snippet: '\\notin', doc_it: 'Non appartiene all\'insieme (∉)', doc_en: 'Not element of' },
  { name: 'subset', package: 'latex2e', args: '', snippet: '\\subset', doc_it: 'Sottoinsieme proprio (⊂)', doc_en: 'Subset' },
  { name: 'subseteq', package: 'latex2e', args: '', snippet: '\\subseteq', doc_it: 'Sottoinsieme o uguale (⊆)', doc_en: 'Subset or equal' },
  { name: 'cup', package: 'latex2e', args: '', snippet: '\\cup', doc_it: 'Unione insiemistica (∪)', doc_en: 'Set union' },
  { name: 'cap', package: 'latex2e', args: '', snippet: '\\cap', doc_it: 'Intersezione insiemistica (∩)', doc_en: 'Set intersection' },
  { name: 'forall', package: 'latex2e', args: '', snippet: '\\forall', doc_it: 'Per ogni (∀)', doc_en: 'For all quantifier' },
  { name: 'exists', package: 'latex2e', args: '', snippet: '\\exists', doc_it: 'Esiste (∃)', doc_en: 'Exists quantifier' },
  { name: 'to', package: 'latex2e', args: '', snippet: '\\to', doc_it: 'Freccia verso destra (→)', doc_en: 'Right arrow' },
  { name: 'implies', package: 'amsmath', args: '', snippet: '\\implies', doc_it: 'Implica logico (⟹)', doc_en: 'Logical implication' },
  { name: 'iff', package: 'amsmath', args: '', snippet: '\\iff', doc_it: 'Se e solo se (⟺)', doc_en: 'If and only if' },
  { name: 'cdot', package: 'latex2e', args: '', snippet: '\\cdot', doc_it: 'Punto di moltiplicazione (·)', doc_en: 'Centered dot multiplication' },
  { name: 'times', package: 'latex2e', args: '', snippet: '\\times', doc_it: 'Croce di moltiplicazione o prodotto cartesiano (×)', doc_en: 'Multiplication cross' },
  { name: 'infty', package: 'latex2e', args: '', snippet: '\\infty', doc_it: 'Simbolo di infinito (∞)', doc_en: 'Infinity' },

  // Graphics & Hyperref
  { name: 'includegraphics', package: 'graphicx', args: 'o m', snippet: '\\includegraphics[width=${1:0.8\\linewidth}]{${2:filename}}', doc_it: 'Include un file immagine esterno (PNG, JPG, PDF)', doc_en: 'Includes image file' },
  { name: 'href', package: 'hyperref', args: 'm m', snippet: '\\href{${1:https://example.com}}{${2:text}}', doc_it: 'Collegamento ipertestuale cliccabile su testo', doc_en: 'Hyperlink on text' },
  { name: 'url', package: 'hyperref', args: 'm', snippet: '\\url{${1:https://example.com}}', doc_it: 'Stampa e rende cliccabile un URL', doc_en: 'Clickable URL' },
  { name: 'hypersetup', package: 'hyperref', args: 'm', snippet: '\\hypersetup{colorlinks=true, linkcolor=${1:blue}, urlcolor=${2:magenta}}', doc_it: 'Configura opzioni e colori dei collegamenti', doc_en: 'Configures hyperref settings' },

  // Multi-file inclusion & Definitions
  { name: 'input', package: 'latex2e', args: 'm', snippet: '\\input{${1:filename}}', doc_it: 'Include il sorgente di un altro file .tex direttamente', doc_en: 'Includes .tex file directly' },
  { name: 'include', package: 'latex2e', args: 'm', snippet: '\\include{${1:filename}}', doc_it: 'Include un capitolo o file con salto pagina automatico', doc_en: 'Includes file with page break' },
  { name: 'subfile', package: 'subfiles', args: 'm', snippet: '\\subfile{${1:filename}}', doc_it: 'Include un sotto-file compilabile autonomamente', doc_en: 'Includes standalone subfile' },
  { name: 'newcommand', package: 'latex2e', args: 'm o m', snippet: '\\newcommand{\\${1:name}}[${2:1}]{${3:definition}}', doc_it: 'Definisce un nuovo comando LaTeX', doc_en: 'Defines a new command' },
  { name: 'renewcommand', package: 'latex2e', args: 'm o m', snippet: '\\renewcommand{\\${1:name}}[${2:1}]{${3:definition}}', doc_it: 'Ridefinisce un comando esistente', doc_en: 'Redefines existing command' },
  { name: 'providecommand', package: 'latex2e', args: 'm o m', snippet: '\\providecommand{\\${1:name}}[${2:1}]{${3:definition}}', doc_it: 'Definisce un comando solo se non esiste già', doc_en: 'Defines command if not already defined' },
  { name: 'def', package: 'latex2e', args: 'm m', snippet: '\\def\\${1:name}{${2:definition}}', doc_it: 'Macro TeX primitiva a basso livello', doc_en: 'Low-level TeX macro definition' },
  { name: 'let', package: 'latex2e', args: 'm m', snippet: '\\let\\${1:new}\\${2:old}', doc_it: 'Assegna un token ad un altro comando', doc_en: 'Assigns token to command' },
  { name: 'newenvironment', package: 'latex2e', args: 'm o m m', snippet: '\\newenvironment{${1:name}}\n  {${2:start_code}}\n  {${3:end_code}}', doc_it: 'Crea un nuovo ambiente LaTeX', doc_en: 'Defines new environment' },

  // Tables & Booktabs
  { name: 'toprule', package: 'booktabs', args: '', snippet: '\\toprule', doc_it: 'Linea orizzontale superiore della tabella', doc_en: 'Top horizontal rule' },
  { name: 'midrule', package: 'booktabs', args: '', snippet: '\\midrule', doc_it: 'Linea divisoria intermedia tra intestazione e dati', doc_en: 'Middle horizontal rule' },
  { name: 'bottomrule', package: 'booktabs', args: '', snippet: '\\bottomrule', doc_it: 'Linea orizzontale di chiusura inferiore', doc_en: 'Bottom horizontal rule' },
  { name: 'cmidrule', package: 'booktabs', args: 'm', snippet: '\\cmidrule(lr){${1:2-3}}', doc_it: 'Linea orizzontale parziale su colonne specifiche', doc_en: 'Partial horizontal rule' },
  { name: 'hline', package: 'latex2e', args: '', snippet: '\\hline', doc_it: 'Linea orizzontale standard in tabular', doc_en: 'Standard horizontal line' },
  { name: 'multicolumn', package: 'latex2e', args: 'm m m', snippet: '\\multicolumn{${1:2}}{${2:c}}{${3:text}}', doc_it: 'Unisce più colonne in una singola cella', doc_en: 'Merges multiple columns' },

  // SI Units & Color
  { name: 'SI', package: 'siunitx', args: 'm m', snippet: '\\SI{${1:10}}{${2:\\meter\\per\\second}}', doc_it: 'Formatta un valore numerico con unità di misura SI', doc_en: 'Formats number with SI unit' },
  { name: 'num', package: 'siunitx', args: 'm', snippet: '\\num{${1:12345.67}}', doc_it: 'Formatta un numero secondo le convenzioni tipografiche', doc_en: 'Formats number' },
  { name: 'unit', package: 'siunitx', args: 'm', snippet: '\\unit{${1:\\kilo\\gram}}', doc_it: 'Unità di misura senza numero', doc_en: 'Stand-alone unit' },
  { name: 'textcolor', package: 'xcolor', args: 'm m', snippet: '\\textcolor{${1:red}}{${2:text}}', doc_it: 'Colora il testo specificato', doc_en: 'Colors specified text' },
  { name: 'color', package: 'xcolor', args: 'm', snippet: '\\color{${1:blue}}', doc_it: 'Imposta il colore corrente', doc_en: 'Sets current text color' },
  { name: 'definecolor', package: 'xcolor', args: 'm m m', snippet: '\\definecolor{${1:mycolor}}{${2:HTML}}{${3:80007F}}', doc_it: 'Definisce un nuovo colore personalizzato', doc_en: 'Defines custom color' },

  // Beamer Specific
  { name: 'frametitle', package: 'beamer', args: 'm', snippet: '\\frametitle{${1:Slide Title}}', doc_it: 'Titolo della slide corrente', doc_en: 'Slide title' },
  { name: 'framesubtitle', package: 'beamer', args: 'm', snippet: '\\framesubtitle{${1:Subtitle}}', doc_it: 'Sottotitolo della slide', doc_en: 'Slide subtitle' },
  { name: 'pause', package: 'beamer', args: '', snippet: '\\pause', doc_it: 'Interrompe l\'animazione fino al clic successivo', doc_en: 'Pauses slide presentation' },
  { name: 'alert', package: 'beamer', args: 'm', snippet: '\\alert{${1:important text}}', doc_it: 'Evidenzia testo in colore d\'allerta (rosso)', doc_en: 'Highlights text with alert color' },

  // Bibliography & BibLaTeX
  { name: 'bibliography', package: 'latex2e', args: 'm', snippet: '\\bibliography{${1:references}}', doc_it: 'Specifica il file .bib (BibTeX classico)', doc_en: 'Specifies .bib file' },
  { name: 'bibliographystyle', package: 'latex2e', args: 'm', snippet: '\\bibliographystyle{${1:plain}}', doc_it: 'Stile di formattazione della bibliografia (plain, abbrv, ieeetr)', doc_en: 'Bibliography style' },
  { name: 'addbibresource', package: 'biblatex', args: 'm', snippet: '\\addbibresource{${1:references.bib}}', doc_it: 'Aggiunge un database bibliografico (BibLaTeX)', doc_en: 'Adds bibliography database' },
  { name: 'printbibliography', package: 'biblatex', args: '', snippet: '\\printbibliography', doc_it: 'Stampa la bibliografia completa (BibLaTeX)', doc_en: 'Prints bibliography' }
];

const CURATED_ENVIRONMENTS = [
  { name: 'document', package: 'latex2e', args: '', snippet: '\\begin{document}\n\t${1:content}\n\\end{document}', doc_it: 'Corpo principale del documento LaTeX', doc_en: 'Main document body' },
  { name: 'figure', package: 'latex2e', args: 'o', snippet: '\\begin{figure}[${1:htbp}]\n\t\\centering\n\t\\includegraphics[width=${2:0.8\\linewidth}]{${3:filename}}\n\t\\caption{${4:Caption}}\n\t\\label{fig:${5:key}}\n\\end{figure}', doc_it: 'Elemento flottante per immagini e figure', doc_en: 'Floating figure environment' },
  { name: 'table', package: 'latex2e', args: 'o', snippet: '\\begin{table}[${1:htbp}]\n\t\\centering\n\t\\caption{${2:Caption}}\n\t\\label{tab:${3:key}}\n\t\\begin{tabular}{${4:|c|c|}}\n\t\t\\hline\n\t\t${5:Col 1} & ${6:Col 2} \\\\\n\t\t\\hline\n\t\\end{tabular}\n\\end{table}', doc_it: 'Elemento flottante per tabelle', doc_en: 'Floating table environment' },
  { name: 'tabular', package: 'latex2e', args: 'm', snippet: '\\begin{tabular}{${1:lcr}}\n\t${2:A} & ${3:B} & ${4:C} \\\\\n\t\\hline\n\\end{tabular}', doc_it: 'Griglia tabellare standard', doc_en: 'Tabular array grid' },
  { name: 'tabularx', package: 'tabularx', args: 'm m', snippet: '\\begin{tabularx}{${1:\\linewidth}}{${2:X r}}\n\t${3:Content} & ${4:Value} \\\\\n\\end{tabularx}', doc_it: 'Tabella a larghezza fissa con colonne auto-ridimensionabili X', doc_en: 'Fixed-width table with auto-expanding X columns' },
  { name: 'longtable', package: 'longtable', args: 'm', snippet: '\\begin{longtable}{${1:lcr}}\n\t${2:Header} \\\\\n\t\\endfirsthead\n\t${3:Data} \\\\\n\\end{longtable}', doc_it: 'Tabella multi-pagina che supera i salti pagina', doc_en: 'Multi-page table spanning page breaks' },
  { name: 'itemize', package: 'latex2e', args: '', snippet: '\\begin{itemize}\n\t\\item ${1:First item}\n\\end{itemize}', doc_it: 'Elenco puntato', doc_en: 'Bullet list' },
  { name: 'enumerate', package: 'latex2e', args: '', snippet: '\\begin{enumerate}\n\t\\item ${1:First item}\n\\end{enumerate}', doc_it: 'Elenco numerato', doc_en: 'Numbered list' },
  { name: 'description', package: 'latex2e', args: '', snippet: '\\begin{description}\n\t\\item[${1:Term}] ${2:Definition}\n\\end{description}', doc_it: 'Elenco descrittivo con etichette in grassetto', doc_en: 'Description list' },
  { name: 'equation', package: 'amsmath', args: '', snippet: '\\begin{equation}\n\t\\label{eq:${1:key}}\n\t${2:formula}\n\\end{equation}', doc_it: 'Equazione matematica numerata', doc_en: 'Numbered mathematical equation' },
  { name: 'equation*', package: 'amsmath', args: '', snippet: '\\begin{equation*}\n\t${1:formula}\n\\end{equation*}', doc_it: 'Equazione matematica senza numero', doc_en: 'Unnumbered mathematical equation' },
  { name: 'align', package: 'amsmath', args: '', snippet: '\\begin{align}\n\t${1:f(x)} &= ${2:ax + b} \\\\\n\t&= ${3:c}\n\\end{align}', doc_it: 'Equazioni multiple allineate al simbolo & con numerazione', doc_en: 'Multi-line aligned equations with numbers' },
  { name: 'align*', package: 'amsmath', args: '', snippet: '\\begin{align*}\n\t${1:f(x)} &= ${2:ax + b} \\\\\n\t&= ${3:c}\n\\end{align*}', doc_it: 'Equazioni multiple allineate senza numerazione', doc_en: 'Multi-line aligned equations without numbers' },
  { name: 'gather', package: 'amsmath', args: '', snippet: '\\begin{gather}\n\t${1:formula_1} \\\\\n\t${2:formula_2}\n\\end{gather}', doc_it: 'Gruppo di formule centrate ciascuna con proprio numero', doc_en: 'Centered multi-line formulas' },
  { name: 'gather*', package: 'amsmath', args: '', snippet: '\\begin{gather*}\n\t${1:formula_1} \\\\\n\t${2:formula_2}\n\\end{gather*}', doc_it: 'Gruppo di formule centrate non numerate', doc_en: 'Centered multi-line formulas unnumbered' },
  { name: 'cases', package: 'amsmath', args: '', snippet: '\\begin{cases}\n\t${1:val_1} & \\text{se } ${2:cond_1} \\\\\n\t${3:val_2} & \\text{altrimenti}\n\\end{cases}', doc_it: 'Definizione a casi con parentesi graffa sinistra', doc_en: 'Case-by-case definition with left brace' },
  { name: 'matrix', package: 'amsmath', args: '', snippet: '\\begin{matrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${4:d}\n\\end{matrix}', doc_it: 'Matrice senza delimitatori', doc_en: 'Matrix without delimiters' },
  { name: 'pmatrix', package: 'amsmath', args: '', snippet: '\\begin{pmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${4:d}\n\\end{pmatrix}', doc_it: 'Matrice racchiusa tra parentesi tonde (...)', doc_en: 'Matrix with parentheses' },
  { name: 'bmatrix', package: 'amsmath', args: '', snippet: '\\begin{bmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${4:d}\n\\end{bmatrix}', doc_it: 'Matrice racchiusa tra parentesi quadre [...]', doc_en: 'Matrix with square brackets' },
  { name: 'vmatrix', package: 'amsmath', args: '', snippet: '\\begin{vmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${4:d}\n\\end{vmatrix}', doc_it: 'Determinante tra barre verticali |...|', doc_en: 'Determinant matrix with vertical bars' },
  { name: 'Vmatrix', package: 'amsmath', args: '', snippet: '\\begin{Vmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${4:d}\n\\end{Vmatrix}', doc_it: 'Norma o matrice tra doppie barre verticali ||...||', doc_en: 'Norm matrix with double vertical bars' },
  { name: 'abstract', package: 'latex2e', args: '', snippet: '\\begin{abstract}\n\t${1:Abstract summary text}\n\\end{abstract}', doc_it: 'Sommario/abstract del documento o articolo', doc_en: 'Document abstract' },
  { name: 'quote', package: 'latex2e', args: '', snippet: '\\begin{quote}\n\t${1:Quotation text}\n\\end{quote}', doc_it: 'Citazione testuale breve indentata', doc_en: 'Short quotation' },
  { name: 'quotation', package: 'latex2e', args: '', snippet: '\\begin{quotation}\n\t${1:Long quotation text}\n\\end{quotation}', doc_it: 'Citazione testuale estesa con rientro paragrafi', doc_en: 'Long quotation' },
  { name: 'verbatim', package: 'latex2e', args: '', snippet: '\\begin{verbatim}\n${1:raw_code}\n\\end{verbatim}', doc_it: 'Testo non formattato stampato esattamente come digitato', doc_en: 'Verbatim raw text' },
  { name: 'center', package: 'latex2e', args: '', snippet: '\\begin{center}\n\t${1:Centered content}\n\\end{center}', doc_it: 'Contenuto allineato al centro', doc_en: 'Centered content' },
  { name: 'minipage', package: 'latex2e', args: 'm', snippet: '\\begin{minipage}{${1:0.48\\linewidth}}\n\t${2:content}\n\\end{minipage}', doc_it: 'Scatola indipendente per affiancare figure o testi', doc_en: 'Minipage box container' },
  { name: 'frame', package: 'beamer', args: 'o', snippet: '\\begin{frame}{${1:Slide Title}}\n\t${2:content}\n\\end{frame}', doc_it: 'Slide di presentazione Beamer', doc_en: 'Beamer presentation slide' },
  { name: 'block', package: 'beamer', args: 'm', snippet: '\\begin{block}{${1:Block Title}}\n\t${2:content}\n\\end{block}', doc_it: 'Riquadro tematico colorato in Beamer', doc_en: 'Themed box in Beamer' },
  { name: 'tikzpicture', package: 'tikz', args: 'o', snippet: '\\begin{tikzpicture}\n\t${1:\\draw (0,0) -- (1,1);}\n\\end{tikzpicture}', doc_it: 'Disegno vettoriale grafico TikZ', doc_en: 'TikZ vector graphics drawing' },
  { name: 'lstlisting', package: 'listings', args: 'o', snippet: '\\begin{lstlisting}[language=${1:Python}]\n${2:# code here}\n\\end{lstlisting}', doc_it: 'Blocco di codice sorgente formattato con syntax highlighting', doc_en: 'Source code block with syntax highlighting' },
  { name: 'proof', package: 'amsthm', args: 'o', snippet: '\\begin{proof}\n\t${1:Proof steps}\n\\end{proof}', doc_it: 'Dimostrazione matematica con simbolo Q.E.D. finale', doc_en: 'Mathematical proof with QED symbol' },
  { name: 'theorem', package: 'amsthm', args: 'o', snippet: '\\begin{theorem}[${1:Name}]\n\t${2:Statement}\n\\end{theorem}', doc_it: 'Teorema matematico formattato', doc_en: 'Mathematical theorem' }
];

// Combine CTAN and Curated into map
const commands = new Map();
const environments = new Map();

// 1. Add CTAN macros
for (const [pkgName, pkgMacros] of Object.entries(ctanMacros)) {
  for (const [macroName, macroData] of Object.entries(pkgMacros)) {
    if (!macroName || macroName === '\\' || macroName === '_' || macroName === '^') continue;
    const cleanName = macroName.startsWith('\\') ? macroName.slice(1) : macroName;
    if (!cleanName || !/^[a-zA-Z@]+$/.test(cleanName)) continue;
    const sig = macroData?.signature || '';
    commands.set(cleanName, {
      name: cleanName,
      package: pkgName,
      type: 'macro',
      args: sig,
      snippet: `\\${cleanName}`,
      doc_it: `Comando LaTeX fornito dal pacchetto ${pkgName}`,
      doc_en: `LaTeX command provided by package ${pkgName}`
    });
  }
}

// 2. Add CTAN environments
for (const [pkgName, pkgEnvs] of Object.entries(ctanEnvs)) {
  for (const [envName, envData] of Object.entries(pkgEnvs)) {
    if (!envName) continue;
    const sig = envData?.signature || '';
    environments.set(envName, {
      name: envName,
      package: pkgName,
      type: 'environment',
      args: sig,
      snippet: `\\begin{${envName}}\n\t\${1}\n\\end{${envName}}`,
      doc_it: `Ambiente LaTeX fornito dal pacchetto ${pkgName}`,
      doc_en: `LaTeX environment provided by package ${pkgName}`
    });
  }
}

// 3. Overlay Curated definitions (they have higher-quality snippets and documentation)
for (const m of CURATED_MACROS) {
  commands.set(m.name, { ...m, type: 'macro' });
}
for (const e of CURATED_ENVIRONMENTS) {
  environments.set(e.name, { ...e, type: 'environment' });
}

const db = {
  version: '1.0.0',
  generatedAt: new Date().toISOString(),
  totalMacros: commands.size,
  totalEnvironments: environments.size,
  packages: Array.from(new Set([...Array.from(commands.values()).map(c => c.package), ...Array.from(environments.values()).map(e => e.package)])).sort(),
  macros: Array.from(commands.values()).sort((a, b) => a.name.localeCompare(b.name)),
  environments: Array.from(environments.values()).sort((a, b) => a.name.localeCompare(b.name))
};

const outPath = path.join(__dirname, '..', 'data', 'latex-commands.json');
fs.writeFileSync(outPath, JSON.stringify(db, null, 2), 'utf8');

console.log(`Successfully generated ${outPath}`);
console.log(`Total macros: ${db.totalMacros}`);
console.log(`Total environments: ${db.totalEnvironments}`);
console.log(`Total packages: ${db.packages.length}`);
