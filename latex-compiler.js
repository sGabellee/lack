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

function isTexLogFileToken(token) {
  if (!token || /\s/.test(token)) return false;
  return /\.(?:tex|sty|cls|aux|bib|fd|def|ldf|cfg|trsl|clo)$/i.test(token) || /[\\/]/.test(token);
}

function updateLogParenStack(line, parenStack) {
  for (let idx = 0; idx < line.length; idx++) {
    const ch = line[idx];
    if (ch === '(') {
      let end = idx + 1;
      while (end < line.length && line[end] !== '(' && line[end] !== ')' && !/\s/.test(line[end])) {
        end++;
      }
      const candidate = line.slice(idx + 1, end);
      if (isTexLogFileToken(candidate)) {
        parenStack.push({ isFile: true, file: candidate });
      } else {
        parenStack.push({ isFile: false });
      }
    } else if (ch === ')' && parenStack.length > 0) {
      parenStack.pop();
    }
  }
  for (let i = parenStack.length - 1; i >= 0; i--) {
    if (parenStack[i].isFile) return parenStack[i].file;
  }
  return "";
}

function normalizeIssueKey(issue) {
  const cleanMsg = String(issue.message || "")
    .replace(/^!+\s*/, "")
    .replace(/[`'"]/g, "'")
    .replace(/\.+$/, "")
    .trim()
    .toLowerCase();
  return `${issue.type}|${issue.line || 0}|${cleanMsg}`;
}

function parseLatexLog(logContent) {
  const issues = [];
  const seenKeys = new Map();
  const lines = logContent.split(/\r?\n/);

  let currentFile = "";
  const parenStack = [];

  function pushIssue(iss) {
    const key = normalizeIssueKey(iss);
    const existingIdx = seenKeys.get(key);
    if (existingIdx !== undefined) {
      const existing = issues[existingIdx];
      // Prefer entry with more specific file path or command context
      if (!existing.file && iss.file) {
        issues[existingIdx] = iss;
      } else if (!existing.command && iss.command) {
        issues[existingIdx] = { ...existing, command: iss.command };
      }
      return;
    }
    seenKeys.set(key, issues.length);
    issues.push(iss);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track balanced parens accurately across multi-open/close lines
    currentFile = updateLogParenStack(line, parenStack);

    // 1. File-line message format: e.g. "filename.tex:14: Error message" or Tectonic "warning: sections/Ass1_1:57: ..."
    const fileLineMatch =
      line.match(/^(?:(warning|error|info):\s*)?(.+?\.(?:tex|sty|cls|aux|bib)):(\d+):\s*(.*)$/i) ||
      line.match(/^(warning|error|info):\s*([^\s:()]+):(\d+):\s*(.*)$/i);
    if (fileLineMatch) {
      const prefixSev = (fileLineMatch[1] || "").toLowerCase();
      let rawFilePath = fileLineMatch[2].trim();
      rawFilePath = rawFilePath.replace(/^(?:warning|error|info):\s*/i, "");
      const lineNum = parseInt(fileLineMatch[3], 10);
      const msg = fileLineMatch[4].trim().replace(/^!+\s*/, "");

      const isWarning = prefixSev === "warning" ||
        /^warning:\s*/i.test(msg) ||
        /\b(?:overfull|underfull)\s+\\[hv]box\b/i.test(msg) ||
        /\b(?:latex\s+)?warning\b/i.test(msg);

      const isBox = /\b(?:overfull|underfull)\s+\\[hv]box\b/i.test(msg);

      if (isWarning || isBox) {
        pushIssue({
          type: isBox ? "box" : "warning",
          file: path.basename(rawFilePath),
          rawFile: rawFilePath,
          line: lineNum,
          message: msg.replace(/^warning:\s*/i, ""),
          command: null,
          raw: line
        });
        continue;
      }

      // Actual compilation error
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

      if (!errorCmd) {
        const undefMatch = msg.match(/Undefined control sequence\s*(\\?[a-zA-Z@]+)?/i);
        if (undefMatch && undefMatch[1]) {
          errorCmd = undefMatch[1].startsWith('\\') ? undefMatch[1] : `\\${undefMatch[1]}`;
        }
      }

      pushIssue({
        type: "error",
        file: path.basename(rawFilePath),
        rawFile: rawFilePath,
        line: lineNum,
        message: msg.replace(/^error:\s*/i, ""),
        command: errorCmd,
        raw: line
      });
      continue;
    }

    // 2. Traditional TeX error starting with '!'
    if (line.startsWith("!")) {
      const errorMsg = line.replace(/^!+\s*/, "").replace(/\.{2,}$/, ".").trim();
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

      pushIssue({
        type: "error",
        file: currentFile ? path.basename(currentFile) : "",
        rawFile: currentFile || "",
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

      pushIssue({
        type: "warning",
        file: currentFile ? path.basename(currentFile) : "",
        rawFile: currentFile || "",
        line: warnLine || 1,
        message: warnMatch[1].trim(),
        raw: line
      });
      continue;
    }

    // 4. Overfull / Underfull hbox warnings
    const boxMatch = line.match(/(Overfull|Underfull) \\[hv]box \([^)]+\) in paragraph at lines (\d+)--(\d+)/);
    if (boxMatch) {
      pushIssue({
        type: "box",
        file: currentFile ? path.basename(currentFile) : "",
        rawFile: currentFile || "",
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
        if (file === "_stage") {
          try {
            fs.rmSync(path.join(dir, file), { recursive: true, force: true });
          } catch (_) {}
          continue;
        }
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

function prepareSearchDirsAndStage({ workDir, targetFile, outDir, extraBuffers = [] }) {
  const stageDir = path.join(outDir, "_stage");
  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
  } catch (_) {}

  let hasStaged = false;
  if (Array.isArray(extraBuffers) && extraBuffers.length > 0) {
    fs.mkdirSync(stageDir, { recursive: true });
    for (const buf of extraBuffers) {
      if (!buf || !buf.relPath || typeof buf.content !== "string") continue;
      const cleanRel = buf.relPath.replace(/^[\\/]+/, "");
      const dest = path.resolve(stageDir, cleanRel);
      const relCheck = path.relative(path.resolve(stageDir), dest);
      if (!relCheck || relCheck.startsWith("..") || path.isAbsolute(relCheck)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf.content, "utf8");
      hasStaged = true;
    }
  }

  const dirs = [];
  const seen = new Set();
  const addDir = (d) => {
    if (!d) return;
    const resolved = path.resolve(d);
    if (!seen.has(resolved) && fs.existsSync(resolved)) {
      seen.add(resolved);
      dirs.push(resolved);
    }
  };

  if (hasStaged) addDir(stageDir);
  if (targetFile) addDir(path.dirname(targetFile));
  addDir(workDir);
  return dirs;
}

function appendTexSearchEnv(existingValue, searchDirs) {
  if (!searchDirs || searchDirs.length === 0) return existingValue;
  const prefix = searchDirs.join(path.delimiter);
  if (!existingValue) {
    return prefix + path.delimiter;
  }
  return `${prefix}${path.delimiter}${existingValue}`;
}

async function compileLatex(options = {}) {
  const {
    filePath,
    content,
    projectDir = null,
    engine = "pdflatex",
    outputDir = null,
    cleanAux = false,
    extraBuffers = [],
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

  // Ensure relative \input, \include, \includegraphics, .bib, and unsaved subfiles resolve from workDir
  const searchDirs = prepareSearchDirsAndStage({ workDir, targetFile, outDir, extraBuffers });

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
    const searchArgs = searchDirs.flatMap(d => ["-Z", `search-path=${d}`]);
    args = ["--synctex", ...searchArgs, "--outdir", outDir, compileSourceFile];
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
    if (searchDirs.length > 0) {
      env.TEXINPUTS = appendTexSearchEnv(env.TEXINPUTS, searchDirs);
      env.BIBINPUTS = appendTexSearchEnv(env.BIBINPUTS, searchDirs);
      env.BSTINPUTS = appendTexSearchEnv(env.BSTINPUTS, searchDirs);
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

      const defaultFileBase = path.basename(compileSourceFile);
      const issues = parseLatexLog(fullLog).map(iss => (
        iss.file ? iss : { ...iss, file: defaultFileBase, rawFile: iss.rawFile || defaultFileBase }
      ));
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
