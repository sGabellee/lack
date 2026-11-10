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

function filterProjectEntries(entries) {
  return entries
    .filter(entry => {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') return false;
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

function validateItemName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Il nome non può essere vuoto.' };
  }
  if (trimmed === '.' || trimmed === '..') {
    return { valid: false, error: 'Nome non consentito.' };
  }
  if (/[\/\\:*?"<>|]/.test(trimmed)) {
    return { valid: false, error: 'Il nome contiene caratteri non validi: / \\ : * ? " < > |' };
  }
  return { valid: true, name: trimmed };
}

module.exports = {
  formatBytes,
  calculateDirSize,
  isCompilableLatexFile,
  filterProjectEntries,
  validateItemName
};
