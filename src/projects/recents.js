/**
 * src/projects/recents.js
 * MRU Recents manager for projects, folders, and files.
 */

const fs = require('fs');
const path = require('path');

class RecentsStore {
  constructor(filePath, maxItems = 15) {
    this.filePath = filePath;
    this.maxItems = maxItems;
    this.items = [];
    this.load();
  }

  load() {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;
        }
      }
    } catch (_) {
      this.items = [];
    }
  }

  save() {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.items, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.warn('[LACK] Failed to save recents store:', err);
    }
  }

  addRecent({ itemPath, type = 'file', name = null }) {
    if (!itemPath) return;
    const resolved = path.resolve(itemPath);
    const itemName = name || path.basename(resolved);

    // Remove existing if present
    this.items = this.items.filter(i => path.resolve(i.path) !== resolved);

    // Add to top
    this.items.unshift({
      path: resolved,
      name: itemName,
      type, // 'project' | 'file' | 'folder'
      lastOpened: new Date().toISOString()
    });

    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(0, this.maxItems);
    }

    this.save();
  }

  removeRecent(targetPath) {
    if (!targetPath) return;
    const resolved = path.resolve(targetPath);
    this.items = this.items.filter(i => path.resolve(i.path) !== resolved);
    this.save();
  }

  clearRecents() {
    this.items = [];
    this.save();
  }

  getRecents({ probeFs = fs, filterDir = null } = {}) {
    let list = [...this.items];

    if (filterDir) {
      const normalFilter = path.resolve(filterDir);
      list = list.filter(item => {
        const normalItem = path.resolve(item.path);
        return normalItem.startsWith(normalFilter);
      });
    }

    return list.map(item => {
      let exists = false;
      try {
        exists = probeFs.existsSync(item.path);
      } catch (_) {
        exists = false;
      }
      return {
        ...item,
        exists
      };
    });
  }
}

module.exports = { RecentsStore };
