// ====== LACK LATEX COMPILER MODULE ======
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { convertLatexAstToHtml } = require("./src/compiler/ast-renderer.js");

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

let activeChildProcess = null;

function stopCompilation() {
  if (activeChildProcess && !activeChildProcess.killed) {
    try {
      activeChildProcess.kill("SIGTERM");
      activeChildProcess = null;
      return true;
    } catch (e) {
      console.warn("Failed to kill child process:", e);
    }
  }
  return false;
}

function getUserDataEnginesPath(binaryName) {
  let userDataPath = null;
  try {
    const electron = require("electron");
    if (electron.app && electron.app.getPath) {
      userDataPath = electron.app.getPath("userData");
    } else if (electron.remote && electron.remote.app && electron.remote.app.getPath) {
      userDataPath = electron.remote.app.getPath("userData");
    }
  } catch (_) {}
  if (!userDataPath) {
    userDataPath = path.join(os.homedir(), ".config", "Lack");
  }
  const ext = process.platform === "win32" ? ".exe" : "";
  const candidate = path.join(userDataPath, "engines", binaryName + ext);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function getClassicBuildDir(targetFile, projectDir) {
  const root = projectDir || (targetFile ? path.dirname(targetFile) : "default");
  const hash = crypto.createHash("sha1").update(path.resolve(root)).digest("hex");
  let cacheBase = null;
  try {
    const electron = require("electron");
    if (electron.app && electron.app.getPath) {
      cacheBase = path.join(electron.app.getPath("cache"), "lack", "builds", hash);
    } else if (electron.remote && electron.remote.app && electron.remote.app.getPath) {
      cacheBase = path.join(electron.remote.app.getPath("cache"), "lack", "builds", hash);
    }
  } catch (_) {}
  if (!cacheBase) {
    cacheBase = path.join(os.homedir(), ".cache", "lack", "builds", hash);
  }
  return cacheBase;
}

function findBinaryPath(binaryName) {
  // 0. Support LACK_ENGINE_CMD override hook
  if (process.env.LACK_ENGINE_CMD) {
    return process.env.LACK_ENGINE_CMD;
  }

  // 1. Check userData/engines/ (e.g. pinned Tectonic)
  const userEngine = getUserDataEnginesPath(binaryName);
  if (userEngine) return userEngine;

  // 2. Try which/where
  try {
    const cmd = process.platform === "win32" ? `where ${binaryName}` : `which ${binaryName}`;
    const output = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    if (output && fs.existsSync(output.split(/\r?\n/)[0])) {
      return output.split(/\r?\n/)[0];
    }
  } catch (e) {}

  // 3. Check standard search locations
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

function getBestAvailableEngine(preferredEngine = null) {
  if (preferredEngine && preferredEngine !== "builtin") {
    const bin = findBinaryPath(preferredEngine);
    if (bin) return preferredEngine;
  }
  // Detection order: Settings override -> userData/engines/tectonic -> latexmk -> pdflatex|xelatex|lualatex -> builtin
  if (findBinaryPath("tectonic")) return "tectonic";
  if (findBinaryPath("latexmk")) return "latexmk";
  if (findBinaryPath("pdflatex")) return "pdflatex";
  if (findBinaryPath("xelatex")) return "xelatex";
  if (findBinaryPath("lualatex")) return "lualatex";
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

    // 1. Standard file-line-error format: "filename.tex:14: Error message"
    const fileLineErrorMatch = line.match(/^(.+?\.tex):(\d+):\s*(.*)$/);
    if (fileLineErrorMatch) {
      let errorCmd = null;
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const lineMatch = lines[j].match(/^l\.(\d+)(?:\s+(.*))?/);
        if (lineMatch) {
          if (lineMatch[2]) {
            const cmdMatch = lineMatch[2].match(/\\([a-zA-Z@]+)/);
            if (cmdMatch) errorCmd = cmdMatch[0];
          }
          break;
        }
      }

      issues.push({
        type: "error",
        file: path.basename(fileLineErrorMatch[1]),
        line: parseInt(fileLineErrorMatch[2], 10),
        message: fileLineErrorMatch[3].trim(),
        command: errorCmd,
        raw: line
      });
      continue;
    }

    // 2. Traditional TeX error starting with '!'
    if (line.startsWith("!")) {
      const errorMsg = line.slice(1).trim();
      let errorLine = null;
      let errorCmd = null;

      // Check next lines for "l.NN" context indicator
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const lineMatch = lines[j].match(/^l\.(\d+)(?:\s+(.*))?/);
        if (lineMatch) {
          errorLine = parseInt(lineMatch[1], 10);
          if (lineMatch[2]) {
            const cmdMatch = lineMatch[2].match(/\\([a-zA-Z@]+)/);
            if (cmdMatch) errorCmd = cmdMatch[0];
          }
          break;
        }
      }

      // Check for missing package error: "! LaTeX Error: File `xxx.sty' not found."
      const pkgMatch = errorMsg.match(/File ['`"]([a-zA-Z0-9_-]+)\.sty['`"] not found/i);
      let missingPackage = null;
      if (pkgMatch) {
        missingPackage = pkgMatch[1];
      }

      issues.push({
        type: "error",
        file: currentFile ? path.basename(currentFile) : "",
        line: errorLine || 1,
        message: errorMsg,
        command: errorCmd,
        missingPackage,
        raw: line
      });
      continue;
    }

    // 3. LaTeX Warnings
    const warnMatch = line.match(/LaTeX (?:Font )?Warning:\s*(.*)/);
    if (warnMatch) {
      let warnLine = null;
      const lineMatch = line.match(/line (\d+)/i);
      if (lineMatch) warnLine = parseInt(lineMatch[1], 10);

      issues.push({
        type: "warning",
        file: currentFile ? path.basename(currentFile) : "",
        line: warnLine || 1,
        message: warnMatch[1].trim(),
        raw: line
      });
      continue;
    }

    // 4. Overfull / Underfull hbox warnings
    const boxMatch = line.match(/(Overfull|Underfull) \\[hv]box \([^)]+\) in paragraph at lines (\d+)--(\d+)/);
    if (boxMatch) {
      issues.push({
        type: "box",
        file: currentFile ? path.basename(currentFile) : "",
        line: parseInt(boxMatch[2], 10),
        message: `${boxMatch[1]} hbox: lines ${boxMatch[2]}--${boxMatch[3]}`,
        raw: line
      });
    }
  }

  return issues;
}

function cleanAuxiliaryFiles(projectDir, outputDir) {
  const dirsToClean = [outputDir, projectDir].filter(Boolean);
  const auxExtensions = [".aux", ".log", ".out", ".toc", ".nav", ".snm", ".vrb", ".bbl", ".blg", ".synctex.gz", ".fls", ".fdb_latexmk"];
  let removedCount = 0;

  for (const dir of dirsToClean) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (auxExtensions.includes(ext)) {
          try {
            fs.unlinkSync(path.join(dir, file));
            removedCount++;
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  return removedCount;
}

async function compileLatex(options = {}) {
  const {
    filePath,
    content,
    projectDir = null,
    engine = "pdflatex",
    outputDir = null,
    cleanAux = false,
    isMemoryBuffer = true // In-memory compilation: never overwrite user's disk file
  } = options;

  const startTime = Date.now();

  // If a child process is already running, kill it before starting a new compile
  stopCompilation();

  if (cleanAux) {
    cleanAuxiliaryFiles(projectDir, outputDir);
  }

  // Built-in compiler route
  if (engine === "builtin") {
    return compileWithBuiltin({ filePath, content, projectDir, outputDir, startTime, fallbackNotice: false });
  }

  // Native compiler execution
  let binPath = findBinaryPath(engine);
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

  if (!workDir) {
    workDir = targetFile ? path.dirname(targetFile) : cacheDir;
  }

  const outDir = outputDir || getClassicBuildDir(targetFile, workDir);
  if (!fs.existsSync(outDir)) {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
  }

  // If memory buffer: write to a dedicated build file in outDir or workDir so user's file is not overwritten
  let compileSourceFile = targetFile;
  const baseName = targetFile ? path.basename(targetFile, path.extname(targetFile)) : "document";

  if (isMemoryBuffer && content !== undefined && content !== null) {
    // Write in-memory content to build dir file
    const buildTempFile = path.join(outDir, `${baseName}.tex`);
    try {
      fs.writeFileSync(buildTempFile, content, "utf8");
      compileSourceFile = buildTempFile;
    } catch (e) {
      console.warn("Could not write build buffer file, using target:", e);
    }
  }

  if (!compileSourceFile) {
    compileSourceFile = path.join(cacheDir, "document.tex");
    fs.writeFileSync(compileSourceFile, content || "", "utf8");
  }

  const expectedPdfPath = path.join(outDir, `${baseName}.pdf`);
  const rootExpectedPdfPath = path.join(workDir, `${baseName}.pdf`);

  // Build command arguments
  let args = [];
  if (process.env.LACK_ENGINE_CMD) {
    binPath = process.env.LACK_ENGINE_CMD;
    args = [outDir, compileSourceFile];
  } else if (engine === "tectonic") {
    args = ["--synctex", "--outdir", outDir, compileSourceFile];
  } else if (engine === "latexmk") {
    args = ["-pdf", "-interaction=nonstopmode", "-synctex=1", "-file-line-error", `-outdir=${outDir}`, compileSourceFile];
  } else {
    // pdflatex, xelatex, lualatex
    args = ["-interaction=nonstopmode", "-synctex=1", "-file-line-error", `-output-directory=${outDir}`, compileSourceFile];
  }

  return new Promise((resolve) => {
    let stdoutData = "";
    let stderrData = "";

    const env = { ...process.env };
    if (EXTRA_SEARCH_PATHS.length > 0) {
      env.PATH = `${EXTRA_SEARCH_PATHS.join(path.delimiter)}${path.delimiter}${env.PATH || ""}`;
    }

    try {
      activeChildProcess = spawn(binPath, args, { cwd: workDir, env });
    } catch (spawnErr) {
      activeChildProcess = null;
      return resolve({
        success: false,
        pdfPath: null,
        issues: [{ type: "error", file: path.basename(compileSourceFile), line: 1, message: spawnErr.message }],
        log: spawnErr.toString(),
        durationMs: Date.now() - startTime
      });
    }

    const currentProc = activeChildProcess;

    currentProc.stdout.on("data", (chunk) => { stdoutData += chunk.toString(); });
    currentProc.stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

    currentProc.on("error", (err) => {
      activeChildProcess = null;
      resolve({
        success: false,
        pdfPath: null,
        issues: [{ type: "error", file: path.basename(compileSourceFile), line: 1, message: err.message }],
        log: err.toString(),
        durationMs: Date.now() - startTime
      });
    });

    currentProc.on("close", (code) => {
      activeChildProcess = null;
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
      let resultingPdf = null;
      if (fs.existsSync(expectedPdfPath)) {
        resultingPdf = expectedPdfPath;
      } else if (fs.existsSync(rootExpectedPdfPath)) {
        resultingPdf = rootExpectedPdfPath;
      }

      const hasFatalErrors = issues.some(i => i.type === "error");
      const success = code === 0 && !!resultingPdf && !hasFatalErrors;

      resolve({
        success,
        exitCode: code,
        pdfPath: resultingPdf,
        issues,
        log: fullLog,
        durationMs,
        engine
      });
    });
  });
}

function compileWithBuiltin({ filePath, content, projectDir, outputDir, startTime, fallbackNotice = false }) {
  let outDir = outputDir;
  if (!outDir) {
    outDir = getClassicBuildDir(filePath, projectDir);
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
  }

  const baseName = filePath ? path.basename(filePath, path.extname(filePath)) : "document";
  const pdfPath = path.join(outDir, `${baseName}.pdf`);

  let log = `[LACK Built-in Compiler Engine]\nCompiling '${baseName}.tex'...\n`;
  if (fallbackNotice) {
    log += `[Notice] No native LaTeX compiler found on system. Using Lack high-speed internal AST renderer.\n`;
    log += `[Tip] Install TeX Live or use one-click Tectonic installer in Settings.\n`;
  }

  const parsed = convertLatexAstToHtml(content);
  log += `Parsed ${parsed.sectionsCount} sections, ${parsed.mathCount} math formulas, ${parsed.figuresCount} figures across ${parsed.pagesCount} pages.\n`;
  log += `Output destination: ${pdfPath}\nCompilation finished.`;

  return {
    success: true,
    isBuiltin: true,
    htmlPreview: parsed.html,
    pdfPath: pdfPath,
    issues: parsed.issues,
    log: log,
    durationMs: Date.now() - startTime,
    engine: "builtin",
    fallbackNotice
  };
}

function convertLatexToHtml(latexText, options = {}) {
  return convertLatexAstToHtml(latexText, options);
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getInstallCommand() {
  if (process.platform === "linux") {
    return "sudo apt update && sudo apt install texlive-latex-base texlive-latex-extra texlive-fonts-recommended";
  } else if (process.platform === "darwin") {
    return "brew install --cask mactex-no-gui";
  } else {
    return "winget install -e --id ChristianSchenk.MiKTeX";
  }
}

module.exports = {
  SUPPORTED_ENGINES,
  EXTRA_SEARCH_PATHS,
  findBinaryPath,
  detectEngines,
  getBestAvailableEngine,
  parseLatexLog,
  cleanAuxiliaryFiles,
  compileLatex,
  stopCompilation,
  convertLatexToHtml,
  getInstallCommand
};
