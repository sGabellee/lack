/**
 * src/projects/ui-controller.js
 * Frontend controller helpers for Linked Projects, two-pane sidebar trees, and Projects Manager.
 */

const fs = require('fs');
const path = require('path');

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function calculateDirSize(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      if (ent.isDirectory()) {
        total += calculateDirSize(full);
      } else if (ent.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch (_) {}
      }
    }
  } catch (_) {}
  return total;
}

function isCompilableLatexFile(filePath) {
  if (!filePath) return false;
  return /\.(tex|bib|sty|cls|bst|dtx|ins)$/i.test(filePath);
}

function isTexFilePath(filePath) {
  return Boolean(filePath && String(filePath).toLowerCase().endsWith('.tex'));
}

function isPathInsideDir(targetPath, rootDir) {
  if (!targetPath || !rootDir) return false;
  const rel = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveMainRelativePath(storePath, filePath) {
  if (!storePath || !filePath || !isPathInsideDir(filePath, storePath)) return null;
  return path.relative(path.resolve(storePath), path.resolve(filePath)).replace(/\\/g, '/');
}

function canSetAsMainDocument({
  filePath,
  isDir = false,
  isMain = false,
  isLinkedProject = false,
  storePath = null
} = {}) {
  if (isDir || isMain || !isTexFilePath(filePath)) return false;
  if (isLinkedProject) {
    return isPathInsideDir(filePath, storePath);
  }
  return true;
}

function resolveClassicCompileTarget({
  activeTab = null,
  mainDocumentPath = null,
  currentProjectDir = null,
  mainDocumentExplicit = false,
  fileExists = fs.existsSync
} = {}) {
  if (mainDocumentPath && fileExists(mainDocumentPath)) {
    if (mainDocumentExplicit) {
      return mainDocumentPath;
    }
    if (!activeTab || !activeTab.filePath) {
      return mainDocumentPath;
    }
    const rootDir = currentProjectDir || path.dirname(mainDocumentPath);
    const sameProjectTree = isPathInsideDir(activeTab.filePath, rootDir) && isPathInsideDir(mainDocumentPath, rootDir);
    const hasDocClass = /\\documentclass(?:\[[^\]]*\])?\{/.test(activeTab.content || '');
    if (sameProjectTree && !hasDocClass) {
      return mainDocumentPath;
    }
  }
  if (activeTab && activeTab.filePath) return activeTab.filePath;
  if (mainDocumentPath && fileExists(mainDocumentPath)) return mainDocumentPath;
  return null;
}

function resolveExportPdfDefaultName({
  isLinkedProject = false,
  targetPath = null,
  currentCompiledPdfPath = null
} = {}) {
  if (isLinkedProject && targetPath) {
    return path.basename(targetPath);
  }
  return currentCompiledPdfPath ? path.basename(currentCompiledPdfPath) : 'document.pdf';
}

function listStoreTexFiles(storePath, fsModule = null) {
  const fsys = fsModule || fs;
  if (!storePath || !fsys.existsSync(storePath)) return [];
  const results = [];

  function walk(dir) {
    let entries = [];
    try {
      entries = fsys.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    const filtered = filterProjectEntries(entries);
    for (const entry of filtered) {
      const fullPath = path.join(dir, entry.name);
      let isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : Boolean(entry.isDirectory);
      try {
        if (!isDir && typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink() && fsys.existsSync(fullPath)) {
          isDir = fsys.statSync(fullPath).isDirectory();
        }
      } catch (_) {}

      if (isDir) {
        walk(fullPath);
      } else if (isTexFilePath(entry.name)) {
        const relPath = resolveMainRelativePath(storePath, fullPath) || entry.name;
        results.push({ name: entry.name, relPath, fullPath });
      }
    }
  }

  walk(storePath);
  return results;
}

function filterProjectEntries(entries) {
  return entries
    .filter(entry => {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'project.json') return false;
      return true;
    })
    .sort((a, b) => {
      const aIsDir = typeof a.isDirectory === 'function' ? a.isDirectory() : Boolean(a.isDirectory);
      const bIsDir = typeof b.isDirectory === 'function' ? b.isDirectory() : Boolean(b.isDirectory);
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.name.localeCompare(b.name);
    });
}

const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

function validateItemName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Il nome non può essere vuoto.' };
  }
  if (trimmed === '.' || trimmed === '..') {
    return { valid: false, error: 'Nome non consentito: "." o ".."' };
  }
  if (/[\/\\:*?"<>|]/.test(trimmed)) {
    return { valid: false, error: 'Il nome contiene caratteri non validi: / \\ : * ? " < > |' };
  }
  if (WINDOWS_RESERVED_NAMES.test(trimmed)) {
    return { valid: false, error: 'Nome riservato di sistema non consentito.' };
  }
  if (Buffer.byteLength(trimmed, 'utf8') > 255) {
    return { valid: false, error: 'Il nome supera la lunghezza massima di 255 byte.' };
  }
  return { valid: true, name: trimmed };
}

/**
 * Returns a collision-free filename or foldername by appending -1, -2, etc. if needed.
 * Strips any trailing -<n> from base before checking.
 * Case-insensitive on Windows/macOS.
 */
function uniqueName(dir, base, ext = '', fsModule = null, platformOverride = null) {
  const fsys = fsModule || fs;
  const platform = platformOverride || process.platform;
  const isCaseInsensitive = platform === 'win32' || platform === 'darwin';

  const cleanBase = (base || '').replace(/-\d+$/, '');
  let existingList = [];

  if (dir && fsys.existsSync(dir)) {
    try {
      existingList = fsys.readdirSync(dir);
    } catch (_) {}
  }

  const exists = (name) => {
    if (!dir) return false;
    if (isCaseInsensitive) {
      const lower = name.toLowerCase();
      return existingList.some(item => item.toLowerCase() === lower);
    }
    return existingList.includes(name);
  };

  const initial = `${cleanBase}${ext}`;
  if (!exists(initial)) {
    return initial;
  }

  let n = 1;
  while (true) {
    const candidate = `${cleanBase}-${n}${ext}`;
    if (!exists(candidate)) {
      return candidate;
    }
    n++;
  }
}

module.exports = {
  formatBytes,
  calculateDirSize,
  isCompilableLatexFile,
  isTexFilePath,
  isPathInsideDir,
  resolveMainRelativePath,
  canSetAsMainDocument,
  resolveClassicCompileTarget,
  resolveExportPdfDefaultName,
  listStoreTexFiles,
  filterProjectEntries,
  validateItemName,
  uniqueName
};
