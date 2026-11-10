/**
 * src/projects/manager.js
 * Core engine for linked project lifecycle, storage, confinement, and atomic compilation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeLink, readLink, extractSnapshot, unlinkPdf } = require('./pdf-link');
const { ZipArchive } = require('archiver');

class ProjectManager {
  constructor(registry, storeRoot) {
    this.registry = registry;
    this.storeRoot = storeRoot;
    if (!fs.existsSync(this.storeRoot)) {
      try { fs.mkdirSync(this.storeRoot, { recursive: true }); } catch (_) {}
    }
  }

  getStoreRoot() {
    return this.storeRoot;
  }

  setStoreRoot(newRoot) {
    this.storeRoot = newRoot;
    if (!fs.existsSync(this.storeRoot)) {
      try { fs.mkdirSync(this.storeRoot, { recursive: true }); } catch (_) {}
    }
    this.registry.rebuild(this.storeRoot);
  }

  slugify(text) {
    return (text || 'untitled')
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[\s\W-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
  }

  createProject({ name = 'Untitled Document', targetPath, template = 'standard', templateContent = null }) {
    const id = crypto.randomUUID();
    const id8 = id.slice(0, 8);
    const projectName = (name && typeof name === 'string' && name !== 'null')
      ? name
      : (targetPath ? path.basename(targetPath, path.extname(targetPath)) : 'Untitled Document');
    const baseName = targetPath ? path.basename(targetPath, path.extname(targetPath)) : projectName;
    const slug = this.slugify(baseName);
    const folderName = `${slug}-${id8}`;
    const storePath = path.join(this.storeRoot, folderName);

    fs.mkdirSync(storePath, { recursive: true });
    fs.mkdirSync(path.join(storePath, '.lack', 'build'), { recursive: true });
    fs.mkdirSync(path.join(storePath, '.lack', 'history'), { recursive: true });

    const mainFileName = `${baseName}.tex`;
    const defaultContent = templateContent ||
      `\\documentclass[11pt,a4paper]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath,amssymb}\n\n\\title{${projectName}}\n\\author{Author}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nWrite your content here...\n\n\\end{document}\n`;

    fs.writeFileSync(path.join(storePath, mainFileName), defaultContent, 'utf8');

    const manifest = {
      schema: 1,
      id,
      name: projectName,
      main: mainFileName,
      engine: 'pdflatex',
      target: targetPath ? path.resolve(targetPath) : '',
      embedSnapshot: false,
      template,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      linkedAssets: []
    };

    this.saveManifest(storePath, manifest);

    this.registry.saveProjectEntry(id, {
      storePath,
      name,
      lastPdfPath: manifest.target,
      lastOpened: manifest.createdAt
    });

    return { id, storePath, manifest };
  }

  loadManifest(storePath) {
    const manifestPath = path.join(storePath, 'project.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  saveManifest(storePath, manifest) {
    manifest.updatedAt = new Date().toISOString();
    const manifestPath = path.join(storePath, 'project.json');
    const tmpPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(tmpPath, manifestPath);
  }

  // Security: confine paths within store unless matching an explicit linked asset
  resolveSafeStorePath(storePath, relPath, linkedAssets = []) {
    const resolved = path.resolve(storePath, relPath);
    const realStore = fs.existsSync(storePath) ? fs.realpathSync(storePath) : path.resolve(storePath);

    // Check if it matches an approved linked asset
    for (const asset of linkedAssets) {
      if (asset.path && relPath.replace(/\\/g, '/') === asset.path.replace(/\\/g, '/')) {
        return resolved;
      }
    }

    // Normal store file check
    if (fs.existsSync(resolved)) {
      const realResolved = fs.realpathSync(resolved);
      if (!realResolved.startsWith(realStore)) {
        throw new Error(`Security Violation: Path "${relPath}" escapes project store boundary.`);
      }
    } else {
      if (!resolved.startsWith(realStore) && !resolved.startsWith(path.resolve(storePath))) {
        throw new Error(`Security Violation: Path "${relPath}" escapes project store boundary.`);
      }
    }
    return resolved;
  }

  // Single-window lock management
  acquireLock(storePath, windowId) {
    const lockPath = path.join(storePath, '.lack', 'lock');
    if (fs.existsSync(lockPath)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        // Check if process is still alive
        let isAlive = false;
        try {
          process.kill(lockData.pid, 0);
          isAlive = true;
        } catch (_) {
          isAlive = false;
        }

        if (isAlive && lockData.pid !== process.pid) {
          return { acquired: false, existingLock: lockData };
        }
      } catch (_) {
        // Corrupted lock file, clear it
      }
    }

    const newLock = {
      pid: process.pid,
      windowId: windowId || 1,
      timestamp: Date.now()
    };
    try {
      fs.writeFileSync(lockPath, JSON.stringify(newLock), 'utf8');
    } catch (_) {}
    return { acquired: true };
  }

  releaseLock(storePath) {
    const lockPath = path.join(storePath, '.lack', 'lock');
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch (_) {}
    }
  }

  // Atomic compile post-processor
  async postProcessCompile({ storePath, compiledPdfPath, targetPdfPath, embedSnapshot = false }) {
    if (!fs.existsSync(compiledPdfPath)) {
      throw new Error(`Compiled PDF not found: ${compiledPdfPath}`);
    }

    const manifest = this.loadManifest(storePath);
    if (!manifest) throw new Error(`Manifest not found in store: ${storePath}`);

    const id = manifest.id;
    const name = manifest.name;

    // Read and stamp link metadata
    const stampedBytes = await writeLink(compiledPdfPath, {
      id,
      name,
      embedSnapshot: embedSnapshot || manifest.embedSnapshot || false,
      storePath
    });

    const targetDir = path.dirname(targetPdfPath);
    if (!fs.existsSync(targetDir)) {
      throw new Error(`Target directory does not exist: ${targetDir}`);
    }

    // Atomic write to tmp in target dir and rename
    const tmpTarget = path.join(targetDir, `.lack-target.tmp-${process.pid}-${Date.now()}`);
    try {
      fs.writeFileSync(tmpTarget, stampedBytes);
      try {
        fs.renameSync(tmpTarget, targetPdfPath);
      } catch (renameErr) {
        // Fallback for cross-device EXDEV
        fs.copyFileSync(tmpTarget, targetPdfPath);
        fs.unlinkSync(tmpTarget);
      }
    } catch (err) {
      if (fs.existsSync(tmpTarget)) {
        try { fs.unlinkSync(tmpTarget); } catch (_) {}
      }
      throw err;
    }

    // Update target in manifest and registry
    manifest.target = path.resolve(targetPdfPath);
    this.saveManifest(storePath, manifest);
    this.registry.saveProjectEntry(id, {
      storePath,
      name,
      lastPdfPath: manifest.target
    });

    return { success: true, targetPdfPath };
  }

  // Linked Assets
  addLinkedAsset(storePath, sourcePath, relDestination) {
    const manifest = this.loadManifest(storePath);
    if (!manifest) throw new Error('Manifest not found');

    const absSource = path.resolve(sourcePath);
    if (!fs.existsSync(absSource)) {
      throw new Error(`Source asset not found: ${absSource}`);
    }

    const destPath = path.join(storePath, relDestination);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }

    const stat = fs.statSync(absSource);
    const symlinkType = stat.isDirectory()
      ? (process.platform === 'win32' ? 'junction' : 'dir')
      : 'file';

    try {
      fs.symlinkSync(absSource, destPath, symlinkType);
    } catch (err) {
      // Fallback on Windows if symlink permissions denied
      if (stat.isDirectory()) {
        throw err;
      }
      fs.copyFileSync(absSource, destPath);
    }

    manifest.linkedAssets = manifest.linkedAssets || [];
    manifest.linkedAssets = manifest.linkedAssets.filter(a => a.path !== relDestination);
    manifest.linkedAssets.push({
      path: relDestination.replace(/\\/g, '/'),
      source: absSource
    });

    this.saveManifest(storePath, manifest);
    return destPath;
  }

  // Export / Eject project
  async exportProject(storePath, exportDestPath, asZip = false) {
    const manifest = this.loadManifest(storePath);
    if (!manifest) throw new Error('Manifest not found');

    if (asZip) {
      return new Promise((resolve, reject) => {
        const outStream = fs.createWriteStream(exportDestPath);
        const archive = new ZipArchive({ zlib: { level: 9 } });
        archive.pipe(outStream);
        archive.on('error', err => reject(err));
        outStream.on('close', () => resolve(exportDestPath));

        function addItems(dir, rel = '') {
          const items = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of items) {
            if (item.name === '.lack' || item.name === 'project.json' || item.name.startsWith('.tmp')) continue;
            const full = path.join(dir, item.name);
            const targetRel = rel ? path.join(rel, item.name) : item.name;
            const stat = fs.statSync(full); // follows symlink to materialize asset!
            if (stat.isDirectory()) {
              addItems(full, targetRel);
            } else {
              archive.file(full, { name: targetRel });
            }
          }
        }

        try {
          addItems(storePath);
          archive.finalize();
        } catch (e) {
          reject(e);
        }
      });
    }

    // Export as folder
    fs.mkdirSync(exportDestPath, { recursive: true });
    function copyItems(dir, dest) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name === '.lack' || item.name === 'project.json' || item.name.startsWith('.tmp')) continue;
        const full = path.join(dir, item.name);
        const target = path.join(dest, item.name);
        const stat = fs.statSync(full); // follows symlink to materialize!
        if (stat.isDirectory()) {
          fs.mkdirSync(target, { recursive: true });
          copyItems(full, target);
        } else {
          fs.copyFileSync(full, target);
        }
      }
    }
    copyItems(storePath, exportDestPath);
    return exportDestPath;
  }
}

module.exports = {
  ProjectManager
};
