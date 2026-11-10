/**
 * src/projects/registry.js
 * Manages the global project registry (userData/projects.json).
 * Guarantees atomic writes (tmp + rename) and self-healing scans.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class ProjectRegistry {
  constructor(registryFilePath, defaultStoreRoot) {
    this.registryFilePath = registryFilePath;
    this.defaultStoreRoot = defaultStoreRoot;
    this.entries = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.registryFilePath)) {
        const raw = fs.readFileSync(this.registryFilePath, 'utf8');
        this.entries = JSON.parse(raw);
        if (!this.entries || typeof this.entries !== 'object' || Array.isArray(this.entries)) {
          this.entries = {};
          this.rebuild(this.defaultStoreRoot);
        }
      } else {
        this.entries = {};
        this.rebuild(this.defaultStoreRoot);
      }
    } catch (err) {
      if (process.env.LACK_DEBUG) {
        console.warn('[LACK_DEBUG] Corrupted projects.json registry, rebuilding...', err.message);
      }
      this.entries = {};
      this.rebuild(this.defaultStoreRoot);
    }
  }

  save() {
    const dir = path.dirname(this.registryFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${this.registryFilePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = JSON.stringify(this.entries, null, 2);

    try {
      fs.writeFileSync(tmpPath, payload, 'utf8');
      fs.renameSync(tmpPath, this.registryFilePath);
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
      throw err;
    }
  }

  getProject(id) {
    if (!id || !this.entries[id]) return null;
    return { id, ...this.entries[id] };
  }

  findProjectByTarget(pdfPath) {
    if (!pdfPath) return null;
    const normTarget = path.normalize(path.resolve(pdfPath));
    for (const [id, entry] of Object.entries(this.entries)) {
      if (entry.lastPdfPath && path.normalize(path.resolve(entry.lastPdfPath)) === normTarget) {
        return { id, ...entry };
      }
    }
    return null;
  }

  saveProjectEntry(id, { storePath, name, lastPdfPath, lastOpened }) {
    if (!id) throw new Error('Project ID is required');
    const existing = this.entries[id] || {};
    this.entries[id] = {
      storePath: storePath || existing.storePath || '',
      name: name || existing.name || 'Untitled Project',
      lastPdfPath: lastPdfPath || existing.lastPdfPath || '',
      lastOpened: lastOpened || new Date().toISOString()
    };
    this.save();
    return { id, ...this.entries[id] };
  }

  removeProjectEntry(id) {
    if (this.entries[id]) {
      delete this.entries[id];
      this.save();
      return true;
    }
    return false;
  }

  listProjects() {
    return Object.entries(this.entries).map(([id, data]) => ({
      id,
      ...data
    })).sort((a, b) => new Date(b.lastOpened || 0) - new Date(a.lastOpened || 0));
  }

  rebuild(storeRoot) {
    const root = storeRoot || this.defaultStoreRoot;
    if (!root || !fs.existsSync(root)) return;

    try {
      const items = fs.readdirSync(root, { withFileTypes: true });
      for (const item of items) {
        if (!item.isDirectory()) continue;
        const manifestPath = path.join(root, item.name, 'project.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest && manifest.id) {
              this.entries[manifest.id] = {
                storePath: path.join(root, item.name),
                name: manifest.name || item.name,
                lastPdfPath: manifest.target || '',
                lastOpened: manifest.updatedAt || manifest.createdAt || new Date().toISOString()
              };
            }
          } catch (_) {}
        }
      }
      this.save();
    } catch (e) {
      if (process.env.LACK_DEBUG) {
        console.warn('[LACK_DEBUG] Rebuilding registry error:', e);
      }
    }
  }
}

module.exports = {
  ProjectRegistry
};
