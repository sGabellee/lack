/**
 * src/projects/import.js
 * Folder to project conversion, dependency closure analysis, and safe transactional file operations.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { uniqueName } = require('./ui-controller');

/**
 * Computes SHA-256 hash of a file on disk.
 */
function computeFileSha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Data-safety rule: move = copy -> verify (size + SHA-256) -> delete original.
 * Never delete before verification.
 */
function moveFileSafe(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`File sorgente non trovato: ${srcPath}`);
  }

  const srcStat = fs.statSync(srcPath);
  const srcSize = srcStat.size;
  const srcHash = computeFileSha256(srcPath);

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Copy
  fs.copyFileSync(srcPath, destPath);

  // Verify size
  const destStat = fs.statSync(destPath);
  if (destStat.size !== srcSize) {
    try { fs.unlinkSync(destPath); } catch (_) {}
    throw new Error(`Verifica fallita per ${destPath}: dimensione diversa (${destStat.size} != ${srcSize})`);
  }

  // Verify SHA-256
  const destHash = computeFileSha256(destPath);
  if (destHash !== srcHash) {
    try { fs.unlinkSync(destPath); } catch (_) {}
    throw new Error(`Verifica fallita per ${destPath}: hash SHA-256 non corrispondente`);
  }

  // Only delete source after complete verification
  fs.unlinkSync(srcPath);

  return {
    src: srcPath,
    dest: destPath,
    size: srcSize,
    sha256: srcHash
  };
}

/**
 * Scans a folder to find candidate .tex files and detect the main document.
 */
function scanLatexFolder(dirPath) {
  if (!fs.existsSync(dirPath)) return { texFiles: [], candidateMain: null, allTexCandidates: [] };

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const texFiles = [];
  const candidatesWithDocClass = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.tex')) {
      const fullPath = path.join(dirPath, entry.name);
      texFiles.push(entry.name);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (/\\documentclass/i.test(content) || /\\begin\{document\}/i.test(content)) {
          candidatesWithDocClass.push(entry.name);
        }
      } catch (_) {}
    }
  }

  let candidateMain = null;
  if (candidatesWithDocClass.length === 1) {
    candidateMain = candidatesWithDocClass[0];
  } else if (candidatesWithDocClass.length > 1) {
    if (candidatesWithDocClass.includes('main.tex')) candidateMain = 'main.tex';
    else if (candidatesWithDocClass.includes('document.tex')) candidateMain = 'document.tex';
    else candidateMain = candidatesWithDocClass[0];
  } else if (texFiles.length > 0) {
    if (texFiles.includes('main.tex')) candidateMain = 'main.tex';
    else if (texFiles.includes('document.tex')) candidateMain = 'document.tex';
    else candidateMain = texFiles[0];
  }

  return {
    texFiles,
    candidateMain,
    allTexCandidates: candidatesWithDocClass.length > 0 ? candidatesWithDocClass : texFiles
  };
}

/**
 * Parses LaTeX content to find referenced dependency file paths.
 */
function findLatexDependencies(mainTexPath, baseDir) {
  const dependencies = new Set();
  if (!fs.existsSync(mainTexPath)) return dependencies;

  const visitedTex = new Set();

  function scanFile(filePath) {
    const normal = path.resolve(filePath);
    if (visitedTex.has(normal) || !fs.existsSync(normal)) return;
    visitedTex.add(normal);

    let content = '';
    try {
      content = fs.readFileSync(normal, 'utf8');
    } catch (_) {
      return;
    }

    // Match \input{...}, \include{...}, \subfile{...}
    const inputRegex = /\\(?:input|include|subfile)\s*\{([^}]+)\}/g;
    let match;
    while ((match = inputRegex.exec(content)) !== null) {
      let rawName = match[1].trim();
      if (!path.extname(rawName)) rawName += '.tex';
      const resolved = path.resolve(baseDir, rawName);
      if (fs.existsSync(resolved)) {
        dependencies.add(resolved);
        scanFile(resolved);
      }
    }

    // Match \includegraphics[...]{...}
    const imgRegex = /\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    while ((match = imgRegex.exec(content)) !== null) {
      const rawName = match[1].trim();
      // Try exact or common image extensions
      const exts = path.extname(rawName) ? [''] : ['.png', '.jpg', '.jpeg', '.pdf', '.eps'];
      for (const ext of exts) {
        const candidate = path.resolve(baseDir, rawName + ext);
        if (fs.existsSync(candidate)) {
          dependencies.add(candidate);
          break;
        }
      }
    }

    // Match \bibliography{...} and \addbibresource{...}
    const bibRegex = /\\(?:bibliography|addbibresource)\s*\{([^}]+)\}/g;
    while ((match = bibRegex.exec(content)) !== null) {
      let rawName = match[1].trim();
      if (!path.extname(rawName)) rawName += '.bib';
      const candidate = path.resolve(baseDir, rawName);
      if (fs.existsSync(candidate)) {
        dependencies.add(candidate);
      }
    }

    // Match \usepackage{...} for local .sty
    const pkgRegex = /\\usepackage(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    while ((match = pkgRegex.exec(content)) !== null) {
      const pkgs = match[1].split(',').map(p => p.trim());
      for (const p of pkgs) {
        const candidate = path.resolve(baseDir, `${p}.sty`);
        if (fs.existsSync(candidate)) {
          dependencies.add(candidate);
        }
      }
    }

    // Match \documentclass{...} for local .cls
    const clsRegex = /\\documentclass(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    while ((match = clsRegex.exec(content)) !== null) {
      const clsName = match[1].trim();
      const candidate = path.resolve(baseDir, `${clsName}.cls`);
      if (fs.existsSync(candidate)) {
        dependencies.add(candidate);
      }
    }
  }

  scanFile(mainTexPath);
  return dependencies;
}

/**
 * Writes a move journal to disk.
 */
function recordMoveJournal(journalDir, journalData) {
  if (!fs.existsSync(journalDir)) {
    fs.mkdirSync(journalDir, { recursive: true });
  }
  const timestamp = Date.now();
  const journalPath = path.join(journalDir, `${timestamp}.json`);
  fs.writeFileSync(journalPath, JSON.stringify({ timestamp, ...journalData }, null, 2), 'utf8');
  return journalPath;
}

/**
 * Reverts a move journal (Undo).
 */
function undoMoveJournal(journalPath) {
  if (!fs.existsSync(journalPath)) {
    throw new Error(`File di journal non trovato: ${journalPath}`);
  }
  const raw = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(raw);
  const reverted = [];

  if (Array.isArray(journal.operations)) {
    for (const op of journal.operations) {
      // op.src is original location, op.dest is location in store
      if (fs.existsSync(op.dest)) {
        moveFileSafe(op.dest, op.src);
        reverted.push(op.src);
      }
    }
  }

  // Remove journal after successful undo
  try { fs.unlinkSync(journalPath); } catch (_) {}

  return reverted;
}

/**
 * Resolves a safe target PDF path respecting the cross-cutting target-collision rule:
 * whenever a PDF target already exists and is NOT linked to this project, never overwrite:
 * use uniqueName and notify user. If linked to this project, overwrite normally.
 */
function resolveCollisionSafePdfTarget(folderPath, baseName, expectedProjectId = null, readLinkFn = null) {
  const desiredPdf = path.join(folderPath, `${baseName}.pdf`);
  if (!fs.existsSync(desiredPdf)) {
    return { targetPath: desiredPdf, collided: false };
  }

  // Check if existing PDF is linked to this project
  if (expectedProjectId && typeof readLinkFn === 'function') {
    try {
      const link = readLinkFn(desiredPdf);
      if (link && link.id === expectedProjectId) {
        return { targetPath: desiredPdf, collided: false };
      }
    } catch (_) {}
  }

  // Collision detected! Use uniqueName
  const freeName = uniqueName(folderPath, baseName, '.pdf');
  const uniqueTarget = path.join(folderPath, freeName);
  return { targetPath: uniqueTarget, collided: true, originalPath: desiredPdf };
}

module.exports = {
  computeFileSha256,
  moveFileSafe,
  scanLatexFolder,
  findLatexDependencies,
  recordMoveJournal,
  undoMoveJournal,
  resolveCollisionSafePdfTarget
};
