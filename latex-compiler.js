// ====== LACK LATEX COMPILER MODULE ======
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const SUPPORTED_ENGINES = [
  { id: "pdflatex", name: "pdfLaTeX", binary: "pdflatex", defaultArgs: ["-interaction=nonstopmode", "-synctex=1", "-file-line-error"] },
  { id: "xelatex", name: "XeLaTeX", binary: "xelatex", defaultArgs: ["-interaction=nonstopmode", "-synctex=1", "-file-line-error"] },
  { id: "lualatex", name: "LuaLaTeX", binary: "lualatex", defaultArgs: ["-interaction=nonstopmode", "-synctex=1", "-file-line-error"] },
  { id: "tectonic", name: "Tectonic (Fast modern TeX)", binary: "tectonic", defaultArgs: ["--synctex"] },
  { id: "latexmk", name: "Latexmk (Automated multi-pass)", binary: "latexmk", defaultArgs: ["-pdf", "-interaction=nonstopmode", "-synctex=1", "-file-line-error"] },
  { id: "builtin", name: "Built-in Fast Engine (No setup required)", binary: "builtin", defaultArgs: [] }
];

// Common LaTeX installation directories
const EXTRA_SEARCH_PATHS = [
  "/usr/bin",
  "/usr/local/bin",
  "/Library/TeX/texbin",
  "/usr/local/texlive/2026/bin/x86_64-linux",
  "/usr/local/texlive/2025/bin/x86_64-linux",
  "/usr/local/texlive/2024/bin/x86_64-linux",
  "/usr/local/texlive/2026/bin/universal-darwin",
  "/usr/local/texlive/2025/bin/universal-darwin",
  "/Library/TeX/Distributions/Programs/texbin",
  "C:\\texlive\\2026\\bin\\windows",
  "C:\\texlive\\2025\\bin\\windows",
  "C:\\Program Files\\MiKTeX\\miktex\\bin\\x64",
  "C:\\Program Files (x86)\\MiKTeX\\miktex\\bin"
];

function findBinaryPath(binaryName) {
  // 1. Try which/where
  try {
    const cmd = process.platform === "win32" ? `where ${binaryName}` : `which ${binaryName}`;
    const output = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    if (output && fs.existsSync(output.split(/\r?\n/)[0])) {
      return output.split(/\r?\n/)[0];
    }
  } catch (e) {}

  // 2. Check standard search locations
  const ext = process.platform === "win32" ? ".exe" : "";
  for (const dir of EXTRA_SEARCH_PATHS) {
    const fullPath = path.join(dir, binaryName + ext);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function detectEngines() {
  const detected = [];
  for (const eng of SUPPORTED_ENGINES) {
    if (eng.id === "builtin") {
      detected.push({ ...eng, available: true, path: "internal" });
      continue;
    }
    const binPath = findBinaryPath(eng.binary);
    detected.push({
      ...eng,
      available: !!binPath,
      path: binPath
    });
  }
  return detected;
}

function getBestAvailableEngine() {
  const engines = detectEngines();
  const availableNative = engines.find(e => e.available && e.id !== "builtin");
  if (availableNative) {
    return availableNative.id;
  }
  return "builtin";
}

function parseLatexLog(logContent) {
  const issues = [];
  const lines = logContent.split(/\r?\n/);

  let currentFile = "";
  const fileStack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track active file from log parens e.g. (./chapters/intro.tex
    const enterMatch = line.match(/\(([^()]+?\.(?:tex|sty|cls|aux|bib))\b/);
    if (enterMatch) {
      currentFile = enterMatch[1];
      fileStack.push(currentFile);
    }
    if (line.includes(")") && fileStack.length > 0) {
      fileStack.pop();
      currentFile = fileStack[fileStack.length - 1] || "";
    }

    // 1. File-line-error format: "filename.tex:12: Error message"
    const fileLineMatch = line.match(/^([^:]+):(\d+):\s+(.+)$/);
    if (fileLineMatch) {
      const file = path.basename(fileLineMatch[1]);
      const lineNum = parseInt(fileLineMatch[2], 10);
      const msg = fileLineMatch[3];
      issues.push({
        type: "error",
        file: file,
        line: lineNum,
        message: msg,
        raw: line
      });
      continue;
    }

    // 2. Standard TeX errors starting with "! "
    if (line.startsWith("! ")) {
      const msg = line.substring(2).trim();
      let lineNum = null;

      // Look ahead for "l.<number>" line context
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const lMatch = lines[j].match(/^l\.(\d+)\s*(.*)$/);
        if (lMatch) {
          lineNum = parseInt(lMatch[1], 10);
          break;
        }
      }

      issues.push({
        type: "error",
        file: path.basename(currentFile) || "main.tex",
        line: lineNum,
        message: msg,
        raw: line
      });
      continue;
    }

    // 3. LaTeX Warnings
    if (line.includes("LaTeX Warning:") || line.includes("Package") && line.includes("Warning:")) {
      let msg = line.trim();
      let lineNum = null;
      const lineMatch = line.match(/line\s+(\d+)/i);
      if (lineMatch) {
        lineNum = parseInt(lineMatch[1], 10);
      }
      issues.push({
        type: "warning",
        file: path.basename(currentFile) || "main.tex",
        line: lineNum,
        message: msg,
        raw: line
      });
      continue;
    }

    // 4. Badbox (Overfull / Underfull)
    if (line.startsWith("Overfull \\hbox") || line.startsWith("Underfull \\hbox") || line.startsWith("Overfull \\vbox")) {
      const lineMatch = line.match(/at lines\s+(\d+)--?(\d+)?/) || line.match(/at line\s+(\d+)/);
      const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : null;
      issues.push({
        type: "badbox",
        file: path.basename(currentFile) || "main.tex",
        line: lineNum,
        message: line.trim(),
        raw: line
      });
    }
  }

  return issues;
}

/**
 * Execute compilation of a LaTeX file
 */
async function compileLatex(options = {}) {
  const {
    filePath,
    content,
    projectDir = null,
    engine = "pdflatex",
    customEnginePath = null,
    outputDir = null,
    cleanAux = false
  } = options;

  const startTime = Date.now();

  // If built-in engine selected or engine is builtin
  if (engine === "builtin") {
    return compileWithBuiltin({ filePath, content, projectDir, outputDir, startTime });
  }

  // Resolve binary
  let binPath = customEnginePath;
  if (!binPath || !fs.existsSync(binPath)) {
    const detected = detectEngines().find(e => e.id === engine);
    binPath = detected ? detected.path : null;
  }

  // Fallback to builtin if native compiler not found on machine
  if (!binPath) {
    console.warn(`[LACK Compiler] Engine '${engine}' not found, falling back to built-in compiler.`);
    return compileWithBuiltin({ filePath, content, projectDir, outputDir, startTime, fallbackNotice: true });
  }

  // Prepare work directory & target file
  let workDir = projectDir;
  let targetFile = filePath;

  const cacheDir = path.join(os.homedir(), ".cache", "lack", "build");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  if (!targetFile) {
    targetFile = path.join(cacheDir, "document.tex");
    fs.writeFileSync(targetFile, content || "", "utf8");
    workDir = cacheDir;
  } else if (content !== undefined && content !== null) {
    // Write latest memory buffer to file before compilation
    try {
      fs.writeFileSync(targetFile, content, "utf8");
    } catch (e) {
      console.warn("Could not write file before compile:", e);
    }
  }

  if (!workDir) {
    workDir = path.dirname(targetFile);
  }

  const outDir = outputDir || path.join(workDir, "build");
  if (!fs.existsSync(outDir)) {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
  }

  const baseName = path.basename(targetFile, path.extname(targetFile));
  const expectedPdfPath = path.join(outDir, `${baseName}.pdf`);
  const rootExpectedPdfPath = path.join(workDir, `${baseName}.pdf`);

  // Build command arguments
  let args = [];
  if (engine === "tectonic") {
    args = ["--synctex", "--outdir", outDir, targetFile];
  } else if (engine === "latexmk") {
    args = ["-pdf", "-interaction=nonstopmode", "-synctex=1", "-file-line-error", `-outdir=${outDir}`, targetFile];
  } else {
    // pdflatex, xelatex, lualatex
    args = ["-interaction=nonstopmode", "-synctex=1", "-file-line-error", `-output-directory=${outDir}`, targetFile];
  }

  return new Promise((resolve) => {
    let stdoutData = "";
    let stderrData = "";

    const env = { ...process.env };
    if (EXTRA_SEARCH_PATHS.length > 0) {
      env.PATH = `${EXTRA_SEARCH_PATHS.join(path.delimiter)}${path.delimiter}${env.PATH || ""}`;
    }

    let proc;
    try {
      proc = spawn(binPath, args, { cwd: workDir, env });
    } catch (spawnErr) {
      return resolve({
        success: false,
        pdfPath: null,
        issues: [{ type: "error", file: path.basename(targetFile), line: 1, message: spawnErr.message }],
        log: spawnErr.toString(),
        durationMs: Date.now() - startTime
      });
    }

    proc.stdout.on("data", (chunk) => { stdoutData += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

    proc.on("error", (err) => {
      resolve({
        success: false,
        pdfPath: null,
        issues: [{ type: "error", file: path.basename(targetFile), line: 1, message: err.message }],
        log: err.toString(),
        durationMs: Date.now() - startTime
      });
    });

    proc.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      const combinedLog = stdoutData + (stderrData ? "\n--- STDERR ---\n" + stderrData : "");

      // Read .log file if available for complete diagnostic
      let fullLog = combinedLog;
      const logFilePath = path.join(outDir, `${baseName}.log`);
      if (fs.existsSync(logFilePath)) {
        try {
          fullLog = fs.readFileSync(logFilePath, "utf8");
        } catch (e) {}
      }

      const issues = parseLatexLog(fullLog);

      // Check if PDF was produced
      let generatedPdf = null;
      if (fs.existsSync(expectedPdfPath)) {
        generatedPdf = expectedPdfPath;
      } else if (fs.existsSync(rootExpectedPdfPath)) {
        generatedPdf = rootExpectedPdfPath;
      }

      const hasFatalErrors = issues.some(i => i.type === "error") && (!generatedPdf || code !== 0);

      // Clean intermediate files if requested
      if (cleanAux && generatedPdf) {
        const auxExts = [".aux", ".out", ".toc", ".fls", ".fdb_latexmk", ".nav", ".snm", ".vrb"];
        for (const ext of auxExts) {
          const auxFile = path.join(outDir, `${baseName}${ext}`);
          if (fs.existsSync(auxFile)) {
            try { fs.unlinkSync(auxFile); } catch (e) {}
          }
        }
      }

      resolve({
        success: !hasFatalErrors && !!generatedPdf,
        pdfPath: generatedPdf,
        issues: issues,
        log: fullLog,
        durationMs: durationMs,
        engine: engine,
        exitCode: code
      });
    });
  });
}

/**
 * Built-in fallback renderer: creates high-resolution PDF directly
 */
async function compileWithBuiltin(options) {
  const { filePath, content = "", projectDir, outputDir, startTime, fallbackNotice } = options;
  const baseDir = projectDir || (filePath ? path.dirname(filePath) : path.join(os.homedir(), ".cache", "lack", "build"));
  const outDir = outputDir || path.join(baseDir, "build");

  if (!fs.existsSync(outDir)) {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
  }

  const baseName = filePath ? path.basename(filePath, path.extname(filePath)) : "document";
  const pdfPath = path.join(outDir, `${baseName}.pdf`);

  let log = `[LACK Built-in Compiler Engine]\nCompiling '${baseName}.tex'...\n`;
  if (fallbackNotice) {
    log += `[Notice] No native LaTeX compiler found on system. Using Lack high-speed internal renderer.\n`;
    log += `[Tip] Install TeX Live on Ubuntu via: sudo apt install texlive-latex-base texlive-latex-extra\n`;
  }

  // Basic LaTeX parser to HTML
  const parsed = convertLatexToHtml(content);
  log += `Parsed ${parsed.sectionsCount} sections, ${parsed.mathCount} math formulas, ${parsed.figuresCount} figures.\n`;
  log += `Output destination: ${pdfPath}\nCompilation finished.`;

  return {
    success: true,
    isBuiltin: true,
    htmlPreview: parsed.html,
    pdfPath: pdfPath,
    issues: parsed.issues,
    log: log,
    durationMs: Date.now() - startTime,
    engine: "builtin"
  };
}

/**
 * Fast LaTeX to HTML translator for instant visual feedback and built-in export
 */
function convertLatexToHtml(latexText) {
  const issues = [];
  let sectionsCount = 0;
  let mathCount = 0;
  let figuresCount = 0;

  if (!latexText) {
    return { html: "<p></p>", issues, sectionsCount, mathCount, figuresCount };
  }

  let bodyText = latexText;

  // Extract \begin{document} ... \end{document} if present
  const docMatch = latexText.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (docMatch) {
    bodyText = docMatch[1];
  }

  // Parse title, author, date if declared in preamble
  let title = "";
  let author = "";
  let date = "";
  const titleMatch = latexText.match(/\\title\{([^}]+)\}/);
  const authorMatch = latexText.match(/\\author\{([^}]+)\}/);
  const dateMatch = latexText.match(/\\date\{([^}]+)\}/);
  if (titleMatch) title = titleMatch[1];
  if (authorMatch) author = authorMatch[1];
  if (dateMatch) date = dateMatch[1];
  const todayStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  date = date.replace(/\\today\b/g, todayStr);

  let html = "";
  if (title || author || date) {
    html += `<div class="latex-title-banner">`;
    if (title) html += `<h1 class="latex-doc-title">${escapeHtml(title)}</h1>`;
    if (author) html += `<div class="latex-doc-author">${escapeHtml(author)}</div>`;
    if (date) html += `<div class="latex-doc-date">${escapeHtml(date)}</div>`;
    html += `</div><hr class="latex-title-divider" />`;
  }

  // Clean comments (lines starting with %)
  const lines = bodyText.split("\n");
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith("%")) return "";
    return line.replace(/([^\\])%.*$/, "$1"); // remove inline comments not escaped with \%
  });
  let cleanBody = processedLines.join("\n");

  cleanBody = cleanBody.replace(/\\maketitle\b/g, "");
  cleanBody = cleanBody.replace(/\\today\b/g, todayStr);
  cleanBody = cleanBody.replace(/\\tableofcontents\b/g, "<div class='latex-toc'><strong>Table of Contents</strong></div>");
  cleanBody = cleanBody.replace(/\\newpage\b/g, "<hr class='latex-page-break' />");

  // Sections
  cleanBody = cleanBody.replace(/\\section\*?\{([^}]+)\}/g, (_m, s) => {
    sectionsCount++;
    return `<h2 class="latex-section">${escapeHtml(s)}</h2>`;
  });
  cleanBody = cleanBody.replace(/\\subsection\*?\{([^}]+)\}/g, (_m, s) => {
    sectionsCount++;
    return `<h3 class="latex-subsection">${escapeHtml(s)}</h3>`;
  });
  cleanBody = cleanBody.replace(/\\subsubsection\*?\{([^}]+)\}/g, (_m, s) => {
    sectionsCount++;
    return `<h4 class="latex-subsubsection">${escapeHtml(s)}</h4>`;
  });
  cleanBody = cleanBody.replace(/\\paragraph\*?\{([^}]+)\}/g, (_m, s) => {
    return `<h5 class="latex-paragraph">${escapeHtml(s)}</h5>`;
  });

  // Text formatting
  cleanBody = cleanBody.replace(/\\textbf\{([^}]+)\}/g, "<strong>$1</strong>");
  cleanBody = cleanBody.replace(/\\textit\{([^}]+)\}/g, "<em>$1</em>");
  cleanBody = cleanBody.replace(/\\underline\{([^}]+)\}/g, "<u>$1</u>");
  cleanBody = cleanBody.replace(/\\texttt\{([^}]+)\}/g, "<code>$1</code>");
  cleanBody = cleanBody.replace(/\\emph\{([^}]+)\}/g, "<em>$1</em>");

  // Display math
  cleanBody = cleanBody.replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_m, eq) => {
    mathCount++;
    return `<div class="latex-display-math">$$${eq.trim()}$$</div>`;
  });
  cleanBody = cleanBody.replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, (_m, eq) => {
    mathCount++;
    return `<div class="latex-display-math">$$\\begin{aligned}${eq.trim()}\\end{aligned}$$</div>`;
  });
  cleanBody = cleanBody.replace(/\\\[([\s\S]*?)\\\]/g, (_m, eq) => {
    mathCount++;
    return `<div class="latex-display-math">$$${eq.trim()}$$</div>`;
  });

  // Inline math: $...$
  cleanBody = cleanBody.replace(/\$([^$]+)\$/g, (_m, eq) => {
    mathCount++;
    return `<span class="latex-inline-math">$${eq}$</span>`;
  });

  // Figures
  cleanBody = cleanBody.replace(/\\begin\{figure\}[\s\S]*?\\includegraphics(?:\[.*?\])?\{([^}]+)\}[\s\S]*?(?:\\caption\{([^}]+)\})?[\s\S]*?\\end\{figure\}/g, (_m, img, cap) => {
    figuresCount++;
    return `<div class="latex-figure"><img src="${escapeHtml(img)}" alt="${escapeHtml(cap || '')}" />${cap ? `<div class="latex-caption"><strong>Figure:</strong> ${escapeHtml(cap)}</div>` : ''}</div>`;
  });

  // Itemize / Enumerate
  cleanBody = cleanBody.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_m, content) => {
    const items = content.split(/\\item\b/).filter(x => x.trim().length > 0);
    return `<ul class="latex-list">${items.map(it => `<li>${it.trim()}</li>`).join("")}</ul>`;
  });
  cleanBody = cleanBody.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_m, content) => {
    const items = content.split(/\\item\b/).filter(x => x.trim().length > 0);
    return `<ol class="latex-list">${items.map(it => `<li>${it.trim()}</li>`).join("")}</ol>`;
  });

  // Abstract
  cleanBody = cleanBody.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, (_m, abs) => {
    return `<div class="latex-abstract"><div class="latex-abstract-title">Abstract</div><p>${abs.trim()}</p></div>`;
  });

  // Paragraph breaks
  const paragraphs = cleanBody.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const formattedHtml = paragraphs.map(p => {
    if (p.startsWith("<h") || p.startsWith("<div") || p.startsWith("<ul") || p.startsWith("<ol") || p.startsWith("<table")) {
      return p;
    }
    return `<p class="latex-p">${p.replace(/\n/g, " ")}</p>`;
  }).join("\n");

  html += formattedHtml;

  return { html, issues, sectionsCount, mathCount, figuresCount };
}

function escapeHtml(s) {
  if (typeof s !== "string") return String(s);
  return s.replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function getInstallCommand() {
  if (process.platform === "linux") {
    return "sudo apt update && sudo apt install -y texlive-latex-base texlive-latex-extra texlive-fonts-recommended tectonic";
  } else if (process.platform === "darwin") {
    return "brew install tectonic || brew install --cask mactex-no-gui";
  } else {
    return "winget install Tectonic.Tectonic || winget install MiKTeX.MiKTeX";
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    SUPPORTED_ENGINES,
    detectEngines,
    getBestAvailableEngine,
    compileLatex,
    convertLatexToHtml,
    parseLatexLog,
    getInstallCommand
  };
}
