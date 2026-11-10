/**
 * scripts/build-latex-db.js
 * Generates data/latex-commands.json containing macros and environments
 * from @unified-latex/unified-latex-ctan and comprehensive curated LaTeX definitions.
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

const macroMap = new Map();
const envMap = new Map();
const packageSet = new Set(['latex2e', 'article', 'report', 'book', 'beamer', 'letter']);

// Load from CTAN
for (const [pkg, macros] of Object.entries(ctanMacros)) {
  packageSet.add(pkg);
  for (const [mName, info] of Object.entries(macros)) {
    const cleanName = mName.replace(/^\\/, '');
    if (!cleanName) continue;
    macroMap.set(cleanName, {
      name: cleanName,
      package: pkg,
      args: info.signature || '',
      snippet: `\\${cleanName}`,
      doc_it: `Macro ${cleanName} dal pacchetto ${pkg}`,
      doc_en: `Macro ${cleanName} from ${pkg} package`
    });
  }
}

for (const [pkg, envs] of Object.entries(ctanEnvs)) {
  packageSet.add(pkg);
  for (const [eName, info] of Object.entries(envs)) {
    envMap.set(eName, {
      name: eName,
      package: pkg,
      snippet: `\\begin{${eName}}\n\t\${1}\n\\end{${eName}}`,
      doc_it: `Ambiente ${eName} dal pacchetto ${pkg}`,
      doc_en: `Environment ${eName} from ${pkg} package`
    });
  }
}

// Curated macros list for LaTeX kernel and required packages
const CURATED_MACROS = [
  // Document Structure & Titling
  { name: 'documentclass', package: 'latex2e', args: 'o m', snippet: '\\documentclass[${1:11pt,a4paper}]{${2:article}}', doc_it: 'Dichiara la classe del documento', doc_en: 'Declares document class' },
  { name: 'usepackage', package: 'latex2e', args: 'o m', snippet: '\\usepackage[${1:options}]{${2:package}}', doc_it: 'Carica un pacchetto LaTeX', doc_en: 'Loads a LaTeX package' },
  { name: 'RequirePackage', package: 'latex2e', args: 'o m', snippet: '\\RequirePackage[${1:options}]{${2:package}}', doc_it: 'Richiede un pacchetto', doc_en: 'Requires a package' },
  { name: 'title', package: 'latex2e', args: 'm', snippet: '\\title{${1:Title}}', doc_it: 'Titolo del documento', doc_en: 'Document title' },
  { name: 'author', package: 'latex2e', args: 'm', snippet: '\\author{${1:Author Name}}', doc_it: 'Autore del documento', doc_en: 'Document author' },
  { name: 'date', package: 'latex2e', args: 'm', snippet: '\\date{${1:\\today}}', doc_it: 'Data del documento', doc_en: 'Document date' },
  { name: 'thanks', package: 'latex2e', args: 'm', snippet: '\\thanks{${1:acknowledgement}}', doc_it: 'Nota di ringraziamento', doc_en: 'Acknowledgement note' },
  { name: 'and', package: 'latex2e', args: '', snippet: '\\and', doc_it: 'Separa co-autori', doc_en: 'Separates co-authors' },
  { name: 'maketitle', package: 'latex2e', args: '', snippet: '\\maketitle', doc_it: 'Genera il titolo e intestazione', doc_en: 'Generates title banner' },
  { name: 'tableofcontents', package: 'latex2e', args: '', snippet: '\\tableofcontents', doc_it: 'Genera l\'indice generale', doc_en: 'Generates table of contents' },
  { name: 'listoffigures', package: 'latex2e', args: '', snippet: '\\listoffigures', doc_it: 'Elenco delle figure', doc_en: 'List of figures' },
  { name: 'listoftables', package: 'latex2e', args: '', snippet: '\\listoftables', doc_it: 'Elenco delle tabelle', doc_en: 'List of tables' },
  { name: 'appendix', package: 'latex2e', args: '', snippet: '\\appendix', doc_it: 'Inizia la sezione delle appendici', doc_en: 'Begins appendices section' },
  { name: 'newpage', package: 'latex2e', args: '', snippet: '\\newpage', doc_it: 'Interrompe la pagina corrente', doc_en: 'Page break' },
  { name: 'clearpage', package: 'latex2e', args: '', snippet: '\\clearpage', doc_it: 'Scarica tutti gli elementi flottanti e crea nuova pagina', doc_en: 'Clears floats and starts new page' },
  { name: 'pagebreak', package: 'latex2e', args: 'o', snippet: '\\pagebreak', doc_it: 'Forza interruzione pagina', doc_en: 'Page break' },
  { name: 'today', package: 'latex2e', args: '', snippet: '\\today', doc_it: 'Data corrente', doc_en: 'Current date' },
  { name: 'thepage', package: 'latex2e', args: '', snippet: '\\thepage', doc_it: 'Numero di pagina corrente', doc_en: 'Current page number' },
  { name: 'footnote', package: 'latex2e', args: 'm', snippet: '\\footnote{${1:text}}', doc_it: 'Nota a piè di pagina', doc_en: 'Footnote' },

  // Sections
  { name: 'part', package: 'latex2e', args: 'm', snippet: '\\part{${1:Part Title}}', doc_it: 'Parte', doc_en: 'Part' },
  { name: 'part*', package: 'latex2e', args: 'm', snippet: '\\part*{${1:Part Title}}', doc_it: 'Parte non numerata', doc_en: 'Unnumbered part' },
  { name: 'chapter', package: 'latex2e', args: 'm', snippet: '\\chapter{${1:Chapter Title}}', doc_it: 'Capitolo', doc_en: 'Chapter' },
  { name: 'chapter*', package: 'latex2e', args: 'm', snippet: '\\chapter*{${1:Chapter Title}}', doc_it: 'Capitolo non numerato', doc_en: 'Unnumbered chapter' },
  { name: 'section', package: 'latex2e', args: 'm', snippet: '\\section{${1:Title}}', doc_it: 'Sezione numerata', doc_en: 'Numbered section' },
  { name: 'section*', package: 'latex2e', args: 'm', snippet: '\\section*{${1:Title}}', doc_it: 'Sezione non numerata', doc_en: 'Unnumbered section' },
  { name: 'subsection', package: 'latex2e', args: 'm', snippet: '\\subsection{${1:Title}}', doc_it: 'Sottosezione numerata', doc_en: 'Numbered subsection' },
  { name: 'subsection*', package: 'latex2e', args: 'm', snippet: '\\subsection*{${1:Title}}', doc_it: 'Sottosezione non numerata', doc_en: 'Unnumbered subsection' },
  { name: 'subsubsection', package: 'latex2e', args: 'm', snippet: '\\subsubsection{${1:Title}}', doc_it: 'Sotto-sottosezione', doc_en: 'Sub-subsection' },
  { name: 'subsubsection*', package: 'latex2e', args: 'm', snippet: '\\subsubsection*{${1:Title}}', doc_it: 'Sotto-sottosezione non numerata', doc_en: 'Unnumbered sub-subsection' },
  { name: 'paragraph', package: 'latex2e', args: 'm', snippet: '\\paragraph{${1:Heading}}', doc_it: 'Paragrafo titolato', doc_en: 'Titled paragraph' },
  { name: 'paragraph*', package: 'latex2e', args: 'm', snippet: '\\paragraph*{${1:Heading}}', doc_it: 'Paragrafo titolato non numerato', doc_en: 'Unnumbered paragraph' },
  { name: 'subparagraph', package: 'latex2e', args: 'm', snippet: '\\subparagraph{${1:Heading}}', doc_it: 'Sottoparagrafo titolato', doc_en: 'Subparagraph heading' },
  { name: 'subparagraph*', package: 'latex2e', args: 'm', snippet: '\\subparagraph*{${1:Heading}}', doc_it: 'Sottoparagrafo non numerato', doc_en: 'Unnumbered subparagraph' },

  // Fonts & Sizes
  { name: 'tiny', package: 'latex2e', args: '', snippet: '{\\tiny ${1}}', doc_it: 'Dimensione minuscola', doc_en: 'Tiny size' },
  { name: 'scriptsize', package: 'latex2e', args: '', snippet: '{\\scriptsize ${1}}', doc_it: 'Dimensione indice', doc_en: 'Script size' },
  { name: 'footnotesize', package: 'latex2e', args: '', snippet: '{\\footnotesize ${1}}', doc_it: 'Dimensione nota', doc_en: 'Footnote size' },
  { name: 'small', package: 'latex2e', args: '', snippet: '{\\small ${1}}', doc_it: 'Dimensione piccola', doc_en: 'Small size' },
  { name: 'normalsize', package: 'latex2e', args: '', snippet: '{\\normalsize ${1}}', doc_it: 'Dimensione standard', doc_en: 'Normal size' },
  { name: 'large', package: 'latex2e', args: '', snippet: '{\\large ${1}}', doc_it: 'Dimensione grande', doc_en: 'Large size' },
  { name: 'Large', package: 'latex2e', args: '', snippet: '{\\Large ${1}}', doc_it: 'Dimensione molto grande', doc_en: 'Larger size' },
  { name: 'LARGE', package: 'latex2e', args: '', snippet: '{\\LARGE ${1}}', doc_it: 'Dimensione grandissima', doc_en: 'Extra large size' },
  { name: 'huge', package: 'latex2e', args: '', snippet: '{\\huge ${1}}', doc_it: 'Dimensione enorme', doc_en: 'Huge size' },
  { name: 'Huge', package: 'latex2e', args: '', snippet: '{\\Huge ${1}}', doc_it: 'Dimensione massima', doc_en: 'Maximum size' },

  // Font Shapes & Families
  { name: 'bfseries', package: 'latex2e', args: '', snippet: '{\\bfseries ${1}}', doc_it: 'Grassetto (dichiarazione)', doc_en: 'Bold series declaration' },
  { name: 'mdseries', package: 'latex2e', args: '', snippet: '{\\mdseries ${1}}', doc_it: 'Spessore medio', doc_en: 'Medium series' },
  { name: 'itshape', package: 'latex2e', args: '', snippet: '{\\itshape ${1}}', doc_it: 'Corsivo (dichiarazione)', doc_en: 'Italic shape' },
  { name: 'slshape', package: 'latex2e', args: '', snippet: '{\\slshape ${1}}', doc_it: 'Inclinato', doc_en: 'Slanted shape' },
  { name: 'scshape', package: 'latex2e', args: '', snippet: '{\\scshape ${1}}', doc_it: 'Maiuscoletto', doc_en: 'Small caps shape' },
  { name: 'upshape', package: 'latex2e', args: '', snippet: '{\\upshape ${1}}', doc_it: 'Diritto (normale)', doc_en: 'Upright shape' },
  { name: 'rmfamily', package: 'latex2e', args: '', snippet: '{\\rmfamily ${1}}', doc_it: 'Famiglia Serif (Roman)', doc_en: 'Roman family' },
  { name: 'sffamily', package: 'latex2e', args: '', snippet: '{\\sffamily ${1}}', doc_it: 'Famiglia Sans-Serif', doc_en: 'Sans-serif family' },
  { name: 'ttfamily', package: 'latex2e', args: '', snippet: '{\\ttfamily ${1}}', doc_it: 'Famiglia Monospace (Teletype)', doc_en: 'Monospace family' },

  { name: 'textbf', package: 'latex2e', args: 'm', snippet: '\\textbf{${1:text}}', doc_it: 'Testo in grassetto', doc_en: 'Bold text' },
  { name: 'textit', package: 'latex2e', args: 'm', snippet: '\\textit{${1:text}}', doc_it: 'Testo in corsivo', doc_en: 'Italic text' },
  { name: 'underline', package: 'latex2e', args: 'm', snippet: '\\underline{${1:text}}', doc_it: 'Testo sottolineato', doc_en: 'Underlined text' },
  { name: 'texttt', package: 'latex2e', args: 'm', snippet: '\\texttt{${1:code}}', doc_it: 'Testo a spaziatura fissa', doc_en: 'Monospace code text' },
  { name: 'textsf', package: 'latex2e', args: 'm', snippet: '\\textsf{${1:text}}', doc_it: 'Testo senza grazie', doc_en: 'Sans-serif text' },
  { name: 'textrm', package: 'latex2e', args: 'm', snippet: '\\textrm{${1:text}}', doc_it: 'Testo con grazie', doc_en: 'Roman text' },
  { name: 'textsc', package: 'latex2e', args: 'm', snippet: '\\textsc{${1:text}}', doc_it: 'Testo in maiuscoletto', doc_en: 'Small caps text' },
  { name: 'textsl', package: 'latex2e', args: 'm', snippet: '\\textsl{${1:text}}', doc_it: 'Testo inclinato', doc_en: 'Slanted text' },
  { name: 'emph', package: 'latex2e', args: 'm', snippet: '\\emph{${1:text}}', doc_it: 'Enfasi (corsivo contestuale)', doc_en: 'Emphasis text' },

  // Alignment & Spacing
  { name: 'centering', package: 'latex2e', args: '', snippet: '\\centering', doc_it: 'Allineamento centrato', doc_en: 'Center alignment' },
  { name: 'raggedright', package: 'latex2e', args: '', snippet: '\\raggedright', doc_it: 'Allineamento a sinistra', doc_en: 'Left alignment' },
  { name: 'raggedleft', package: 'latex2e', args: '', snippet: '\\raggedleft', doc_it: 'Allineamento a destra', doc_en: 'Right alignment' },
  { name: 'vspace', package: 'latex2e', args: 'm', snippet: '\\vspace{${1:1cm}}', doc_it: 'Spazio verticale', doc_en: 'Vertical space' },
  { name: 'vspace*', package: 'latex2e', args: 'm', snippet: '\\vspace*{${1:1cm}}', doc_it: 'Spazio verticale forzato', doc_en: 'Forced vertical space' },
  { name: 'hspace', package: 'latex2e', args: 'm', snippet: '\\hspace{${1:1cm}}', doc_it: 'Spazio orizzontale', doc_en: 'Horizontal space' },
  { name: 'hspace*', package: 'latex2e', args: 'm', snippet: '\\hspace*{${1:1cm}}', doc_it: 'Spazio orizzontale forzato', doc_en: 'Forced horizontal space' },
  { name: 'vfill', package: 'latex2e', args: '', snippet: '\\vfill', doc_it: 'Spazio verticale elastico', doc_en: 'Flexible vertical space' },
  { name: 'hfill', package: 'latex2e', args: '', snippet: '\\hfill', doc_it: 'Spazio orizzontale elastico', doc_en: 'Flexible horizontal space' },
  { name: 'par', package: 'latex2e', args: '', snippet: '\\par', doc_it: 'Fine paragrafo', doc_en: 'Paragraph break' },
  { name: 'newline', package: 'latex2e', args: '', snippet: '\\newline', doc_it: 'A capo', doc_en: 'New line' },
  { name: 'linebreak', package: 'latex2e', args: 'o', snippet: '\\linebreak', doc_it: 'Interruzione di riga', doc_en: 'Line break' },
  { name: 'bigskip', package: 'latex2e', args: '', snippet: '\\bigskip', doc_it: 'Spazio verticale grande', doc_en: 'Big vertical skip' },
  { name: 'medskip', package: 'latex2e', args: '', snippet: '\\medskip', doc_it: 'Spazio verticale medio', doc_en: 'Medium vertical skip' },
  { name: 'smallskip', package: 'latex2e', args: '', snippet: '\\smallskip', doc_it: 'Spazio verticale piccolo', doc_en: 'Small vertical skip' },

  // Page Style
  { name: 'pagestyle', package: 'latex2e', args: 'm', snippet: '\\pagestyle{${1:plain}}', doc_it: 'Imposta stile di pagina (plain, empty, headings, fancy)', doc_en: 'Sets page style' },
  { name: 'thispagestyle', package: 'latex2e', args: 'm', snippet: '\\thispagestyle{${1:empty}}', doc_it: 'Imposta stile solo per pagina corrente', doc_en: 'Sets page style for current page' },
  { name: 'pagenumbering', package: 'latex2e', args: 'm', snippet: '\\pagenumbering{${1:arabic}}', doc_it: 'Formato numerazione pagina', doc_en: 'Page numbering format' },

  // Cross Referencing & Citations
  { name: 'label', package: 'latex2e', args: 'm', snippet: '\\label{${1:key}}', doc_it: 'Assegna un\'etichetta per riferimenti', doc_en: 'Assigns cross-reference label' },
  { name: 'ref', package: 'latex2e', args: 'm', snippet: '\\ref{${1:key}}', doc_it: 'Riferimento incrociato', doc_en: 'Cross reference' },
  { name: 'pageref', package: 'latex2e', args: 'm', snippet: '\\pageref{${1:key}}', doc_it: 'Riferimento al numero di pagina', doc_en: 'Page reference' },
  { name: 'cite', package: 'latex2e', args: 'm', snippet: '\\cite{${1:bibkey}}', doc_it: 'Citazione bibliografica', doc_en: 'Citation' },
  { name: 'nocite', package: 'latex2e', args: 'm', snippet: '\\nocite{${1:bibkey}}', doc_it: 'Inclusione in bibliografia senza citare', doc_en: 'Includes in bibliography without citing' },
  { name: 'bibliography', package: 'latex2e', args: 'm', snippet: '\\bibliography{${1:references}}', doc_it: 'File di bibliografia (.bib)', doc_en: 'Bibliography file' },
  { name: 'bibliographystyle', package: 'latex2e', args: 'm', snippet: '\\bibliographystyle{${1:plain}}', doc_it: 'Stile di formattazione bibliografia', doc_en: 'Bibliography style' },

  // Fancyhdr Package
  { name: 'fancyhf', package: 'fancyhdr', args: 'o', snippet: '\\fancyhf{}', doc_it: 'Azzera testate e piè di pagina fancyhdr', doc_en: 'Clears header and footer' },
  { name: 'fancyhead', package: 'fancyhdr', args: 'o m', snippet: '\\fancyhead[${1:LE,RO}]{${2:Text}}', doc_it: 'Configura testata fancyhdr', doc_en: 'Configures fancyhdr header' },
  { name: 'fancyfoot', package: 'fancyhdr', args: 'o m', snippet: '\\fancyfoot[${1:C}]{${2:\\thepage}}', doc_it: 'Configura piè di pagina fancyhdr', doc_en: 'Configures fancyhdr footer' },
  { name: 'lhead', package: 'fancyhdr', args: 'o m', snippet: '\\lhead{${1:Left Header}}', doc_it: 'Testata sinistra', doc_en: 'Left header' },
  { name: 'chead', package: 'fancyhdr', args: 'o m', snippet: '\\chead{${1:Center Header}}', doc_it: 'Testata centrale', doc_en: 'Center header' },
  { name: 'rhead', package: 'fancyhdr', args: 'o m', snippet: '\\rhead{${1:Right Header}}', doc_it: 'Testata destra', doc_en: 'Right header' },
  { name: 'lfoot', package: 'fancyhdr', args: 'o m', snippet: '\\lfoot{${1:Left Footer}}', doc_it: 'Piè di pagina sinistro', doc_en: 'Left footer' },
  { name: 'cfoot', package: 'fancyhdr', args: 'o m', snippet: '\\cfoot{${1:\\thepage}}', doc_it: 'Piè di pagina centrale', doc_en: 'Center footer' },
  { name: 'rfoot', package: 'fancyhdr', args: 'o m', snippet: '\\rfoot{${1:Right Footer}}', doc_it: 'Piè di pagina destro', doc_en: 'Right footer' },
  { name: 'headrulewidth', package: 'fancyhdr', args: '', snippet: '\\renewcommand{\\headrulewidth}{${1:0.4pt}}', doc_it: 'Spessore linea testata', doc_en: 'Header rule thickness' },
  { name: 'footrulewidth', package: 'fancyhdr', args: '', snippet: '\\renewcommand{\\footrulewidth}{${1:0pt}}', doc_it: 'Spessore linea piè pagina', doc_en: 'Footer rule thickness' },

  // Hyperref Package
  { name: 'hypersetup', package: 'hyperref', args: 'm', snippet: '\\hypersetup{\n    colorlinks=true,\n    linkcolor=${1:blue},\n    urlcolor=${2:cyan},\n    citecolor=${3:blue}\n}', doc_it: 'Configura opzioni e colori collegamenti hyperref', doc_en: 'Configures hyperref link options' },
  { name: 'href', package: 'hyperref', args: 'm m', snippet: '\\href{${1:url}}{${2:text}}', doc_it: 'Crea un collegamento ipertestuale', doc_en: 'Hyperlink to URL' },
  { name: 'url', package: 'hyperref', args: 'm', snippet: '\\url{${1:url}}', doc_it: 'Stampa e collega un URL', doc_en: 'Prints and links a URL' },
  { name: 'nolinkurl', package: 'hyperref', args: 'm', snippet: '\\nolinkurl{${1:url}}', doc_it: 'Stampa URL formattato senza collegamento', doc_en: 'Prints URL without link' },
  { name: 'autoref', package: 'hyperref', args: 'm', snippet: '\\autoref{${1:key}}', doc_it: 'Riferimento con prefisso automatico', doc_en: 'Automatic name reference' },
  { name: 'phantomsection', package: 'hyperref', args: '', snippet: '\\phantomsection', doc_it: 'Crea destinazione ancora per collegamenti', doc_en: 'Anchor for hyperlinks' },

  // Geometry Package
  { name: 'geometry', package: 'geometry', args: 'm', snippet: '\\geometry{${1:margin=2.5cm}}', doc_it: 'Configura margini e geometria pagina', doc_en: 'Page geometry and margins' },
  { name: 'newgeometry', package: 'geometry', args: 'm', snippet: '\\newgeometry{${1:margin=1cm}}', doc_it: 'Modifica margini da questo punto', doc_en: 'Changes margins dynamically' },
  { name: 'restoregeometry', package: 'geometry', args: '', snippet: '\\restoregeometry', doc_it: 'Ripristina geometria originale', doc_en: 'Restores original geometry' },

  // Booktabs Package
  { name: 'toprule', package: 'booktabs', args: 'o', snippet: '\\toprule', doc_it: 'Linea orizzontale superiore tabella', doc_en: 'Top horizontal rule' },
  { name: 'midrule', package: 'booktabs', args: 'o', snippet: '\\midrule', doc_it: 'Linea orizzontale intermedia tabella', doc_en: 'Middle horizontal rule' },
  { name: 'bottomrule', package: 'booktabs', args: 'o', snippet: '\\bottomrule', doc_it: 'Linea orizzontale inferiore tabella', doc_en: 'Bottom horizontal rule' },
  { name: 'cmidrule', package: 'booktabs', args: 'o m', snippet: '\\cmidrule(r){${1:2-3}}', doc_it: 'Linea orizzontale per colonna specifica', doc_en: 'Column-specific horizontal rule' },
  { name: 'addlinespace', package: 'booktabs', args: 'o', snippet: '\\addlinespace', doc_it: 'Spazio extra tra righe tabella', doc_en: 'Extra vertical spacing in tables' },

  // Graphicx Package
  { name: 'includegraphics', package: 'graphicx', args: 'o m', snippet: '\\includegraphics[width=${1:0.8\\textwidth}]{${2:image}}', doc_it: 'Include un\'immagine esterna', doc_en: 'Includes image file' },
  { name: 'graphicspath', package: 'graphicx', args: 'm', snippet: '\\graphicspath{{${1:figures/}}}', doc_it: 'Cartelle di ricerca immagini', doc_en: 'Graphics search paths' },
  { name: 'rotatebox', package: 'graphicx', args: 'm m', snippet: '\\rotatebox{${1:angle}}{${2:content}}', doc_it: 'Ruota contenuto', doc_en: 'Rotates content' },
  { name: 'scalebox', package: 'graphicx', args: 'm m', snippet: '\\scalebox{${1:factor}}{${2:content}}', doc_it: 'Scala contenuto', doc_en: 'Scales content' },
  { name: 'resizebox', package: 'graphicx', args: 'm m m', snippet: '\\resizebox{${1:width}}{${2:height}}{${3:content}}', doc_it: 'Ridimensiona contenuto', doc_en: 'Resizes content' },

  // AMSMath & AMSSymb
  { name: 'eqref', package: 'amsmath', args: 'm', snippet: '\\eqref{${1:eq:key}}', doc_it: 'Riferimento equazione tra parentesi', doc_en: 'Parenthesized equation reference' },
  { name: 'DeclareMathOperator', package: 'amsmath', args: 'm m', snippet: '\\DeclareMathOperator{\\${1:name}}{${2:operator}}', doc_it: 'Definisce un nuovo operatore matematico', doc_en: 'Declares new math operator' },
  { name: 'text', package: 'amsmath', args: 'm', snippet: '\\text{${1:text}}', doc_it: 'Inserisce testo normale in formule', doc_en: 'Normal text inside math' },
  { name: 'intertext', package: 'amsmath', args: 'm', snippet: '\\intertext{${1:text}}', doc_it: 'Testo esplicativo tra righe di equazione allineata', doc_en: 'Interrupted text in align' },
  { name: 'tag', package: 'amsmath', args: 'm', snippet: '\\tag{${1:tag}}', doc_it: 'Etichetta personalizzata per equazione', doc_en: 'Custom equation tag' },
  { name: 'notag', package: 'amsmath', args: '', snippet: '\\notag', doc_it: 'Sopprime numero equazione', doc_en: 'Suppresses equation number' },

  // Listings Package
  { name: 'lstset', package: 'listings', args: 'm', snippet: '\\lstset{${1:basicstyle=\\ttfamily}}', doc_it: 'Configura opzioni listings', doc_en: 'Configures listings options' },
  { name: 'lstinline', package: 'listings', args: 'o m', snippet: '\\lstinline|${1:code}|', doc_it: 'Codice inline con listings', doc_en: 'Inline listings code' },
  { name: 'lstinputlisting', package: 'listings', args: 'o m', snippet: '\\lstinputlisting[language=${1:Python}]{${2:file.py}}', doc_it: 'Include file sorgente esterno', doc_en: 'Includes external source file' },
  { name: 'lstdefinestyle', package: 'listings', args: 'm m', snippet: '\\lstdefinestyle{${1:name}}{${2:options}}', doc_it: 'Definisce stile codice', doc_en: 'Defines listings style' },

  // XColor Package
  { name: 'definecolor', package: 'xcolor', args: 'm m m', snippet: '\\definecolor{${1:mycolor}}{${2:rgb}}{${3:0.2,0.4,0.6}}', doc_it: 'Definisce un nuovo colore', doc_en: 'Defines a new color' },
  { name: 'color', package: 'xcolor', args: 'o m', snippet: '\\color{${1:blue}}', doc_it: 'Imposta colore corrente del testo', doc_en: 'Sets current text color' },
  { name: 'textcolor', package: 'xcolor', args: 'o m m', snippet: '\\textcolor{${1:blue}}{${2:text}}', doc_it: 'Colora il testo selezionato', doc_en: 'Colors specific text' },
  { name: 'colorbox', package: 'xcolor', args: 'o m m', snippet: '\\colorbox{${1:yellow}}{${2:text}}', doc_it: 'Riquadro colorato attorno al testo', doc_en: 'Colored background box' },
  { name: 'fcolorbox', package: 'xcolor', args: 'o m m m', snippet: '\\fcolorbox{${1:red}}{${2:yellow}}{${3:text}}', doc_it: 'Riquadro con bordo colorato', doc_en: 'Bordered colored box' },

  // SIUnitx
  { name: 'qty', package: 'siunitx', args: 'o m m', snippet: '\\qty{${1:10}}{${2:\\meter}}', doc_it: 'Quantità e unità di misura', doc_en: 'Quantity and unit' },
  { name: 'num', package: 'siunitx', args: 'o m', snippet: '\\num{${1:12345.67}}', doc_it: 'Numero formattato', doc_en: 'Formatted number' },
  { name: 'unit', package: 'siunitx', args: 'o m', snippet: '\\unit{${1:\\kilo\\gram}}', doc_it: 'Unità di misura', doc_en: 'Unit of measurement' },

  // Cleveref
  { name: 'cref', package: 'cleveref', args: 'm', snippet: '\\cref{${1:key}}', doc_it: 'Riferimento intelligente minuscolo', doc_en: 'Clever reference' },
  { name: 'Cref', package: 'cleveref', args: 'm', snippet: '\\Cref{${1:key}}', doc_it: 'Riferimento intelligente maiuscolo', doc_en: 'Capitalized clever reference' }
];

// Environments
const CURATED_ENVS = [
  { name: 'document', package: 'latex2e', snippet: '\\begin{document}\n\t${1}\n\\end{document}', doc_it: 'Ambiente principale del documento', doc_en: 'Main document body' },
  { name: 'titlepage', package: 'latex2e', snippet: '\\begin{titlepage}\n\t${1}\n\\end{titlepage}', doc_it: 'Frontespizio personalizzato', doc_en: 'Custom title page' },
  { name: 'abstract', package: 'latex2e', snippet: '\\begin{abstract}\n\t${1}\n\\end{abstract}', doc_it: 'Sommario del documento', doc_en: 'Document abstract' },
  { name: 'center', package: 'latex2e', snippet: '\\begin{center}\n\t${1}\n\\end{center}', doc_it: 'Blocco centrato', doc_en: 'Centered block' },
  { name: 'flushleft', package: 'latex2e', snippet: '\\begin{flushleft}\n\t${1}\n\\end{flushleft}', doc_it: 'Blocco a sinistra', doc_en: 'Flush left block' },
  { name: 'flushright', package: 'latex2e', snippet: '\\begin{flushright}\n\t${1}\n\\end{flushright}', doc_it: 'Blocco a destra', doc_en: 'Flush right block' },
  { name: 'itemize', package: 'latex2e', snippet: '\\begin{itemize}\n\t\\item ${1}\n\\end{itemize}', doc_it: 'Elenco puntato', doc_en: 'Bullet list' },
  { name: 'enumerate', package: 'latex2e', snippet: '\\begin{enumerate}\n\t\\item ${1}\n\\end{enumerate}', doc_it: 'Elenco numerato', doc_en: 'Numbered list' },
  { name: 'description', package: 'latex2e', snippet: '\\begin{description}\n\t\\item[${1:label}] ${2:desc}\n\\end{description}', doc_it: 'Elenco descrittivo', doc_en: 'Description list' },
  { name: 'figure', package: 'latex2e', snippet: '\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\textwidth]{${1:image}}\n\t\\caption{${2:Caption}}\n\t\\label{fig:${3:label}}\n\\end{figure}', doc_it: 'Figura flottante', doc_en: 'Floating figure' },
  { name: 'table', package: 'latex2e', snippet: '\\begin{table}[htbp]\n\t\\centering\n\t\\caption{${1:Caption}}\n\t\\label{tab:${2:label}}\n\t\\begin{tabular}{${3:llr}}\n\t\t\\toprule\n\t\t${4:Header 1} & ${5:Header 2} \\\\\n\t\t\\midrule\n\t\t${6:Row 1} & ${7:Row 2} \\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n\\end{table}', doc_it: 'Tabella flottante', doc_en: 'Floating table' },
  { name: 'tabular', package: 'latex2e', snippet: '\\begin{tabular}{${1:c c}}\n\t${2} & ${3} \\\\\n\\end{tabular}', doc_it: 'Tabella standard', doc_en: 'Standard tabular' },
  { name: 'tabularx', package: 'tabularx', snippet: '\\begin{tabularx}{\\textwidth}{${1:X X}}\n\t${2} & ${3} \\\\\n\\end{tabularx}', doc_it: 'Tabella con larghezza fissa e colonne flessibili X', doc_en: 'Width-fixed table with flexible columns' },
  { name: 'equation', package: 'amsmath', snippet: '\\begin{equation}\n\t${1:formula}\n\t\\label{eq:${2:label}}\n\\end{equation}', doc_it: 'Equazione numerata', doc_en: 'Numbered equation' },
  { name: 'equation*', package: 'amsmath', snippet: '\\begin{equation*}\n\t${1:formula}\n\\end{equation*}', doc_it: 'Equazione non numerata', doc_en: 'Unnumbered equation' },
  { name: 'align', package: 'amsmath', snippet: '\\begin{align}\n\t${1:lhs} &= ${2:rhs} \\\\\n\\end{align}', doc_it: 'Equazioni allineate numerate', doc_en: 'Numbered aligned equations' },
  { name: 'align*', package: 'amsmath', snippet: '\\begin{align*}\n\t${1:lhs} &= ${2:rhs} \\\\\n\\end{align*}', doc_it: 'Equazioni allineate non numerate', doc_en: 'Unnumbered aligned equations' },
  { name: 'lstlisting', package: 'listings', snippet: '\\begin{lstlisting}[language=${1:Python}]\n${2:code}\n\\end{lstlisting}', doc_it: 'Blocco di codice sorgente evidenziato', doc_en: 'Syntax-highlighted code block' },
  { name: 'verbatim', package: 'latex2e', snippet: '\\begin{verbatim}\n${1:code}\n\\end{verbatim}', doc_it: 'Blocco di testo preformattato', doc_en: 'Preformatted verbatim block' }
];

const { MATH_AND_CORE } = require('./math-and-core-defs');

// Add curated macros
for (const item of CURATED_MACROS) {
  packageSet.add(item.package);
  macroMap.set(item.name, item);
}

// Add all math and core symbols
for (const name of MATH_AND_CORE) {
  let pkg = 'latex2e';
  if (name === 'mathbb' || name === 'mathfrak' || name === 'checkmark') {
    pkg = 'amssymb';
  } else if (name === 'eqref' || name === 'DeclareMathOperator' || name === 'intertext' || name === 'substack') {
    pkg = 'amsmath';
  }
  macroMap.set(name, {
    name,
    package: pkg,
    args: '',
    snippet: `\\${name}`,
    doc_it: `Comando standard ${name}`,
    doc_en: `Standard command ${name}`
  });
}

// Add curated envs
for (const item of CURATED_ENVS) {
  packageSet.add(item.package);
  envMap.set(item.name, item);
}

const outData = {
  macros: Array.from(macroMap.values()),
  environments: Array.from(envMap.values()),
  packages: Array.from(packageSet).sort()
};

const outPath = path.resolve(__dirname, '../data/latex-commands.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(outData, null, 2), 'utf8');

console.log(`Successfully built data/latex-commands.json with ${outData.macros.length} macros and ${outData.environments.length} environments across ${outData.packages.length} packages.`);
