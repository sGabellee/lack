/**
 * src/projects/pdf-link.js
 * Links compiled PDFs with virtual project stores using pdf-lib.
 * Handles reading/writing /LackProjectID, /Keywords, and optional source snapshots.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, PDFName, PDFString } = require('pdf-lib');
const { ZipArchive } = require('archiver');
const AdmZip = require('adm-zip');

const MAX_SNAPSHOT_SIZE = 25 * 1024 * 1024; // 25 MB cap

/**
 * Creates an in-memory zip of the store sources (excluding .lack/ and symlinks).
 */
async function createSourceSnapshotZip(storePath) {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', chunk => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', err => reject(err));

    function addDirRecursive(currentDir, relDir = '') {
      const items = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const item of items) {
        if (item.name === '.lack' || item.name.startsWith('.tmp')) continue;
        const fullPath = path.join(currentDir, item.name);
        const relPath = relDir ? path.join(relDir, item.name) : item.name;

        // Skip symlinks when embedding snapshots to prevent bloat/security issues
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) continue;

        if (item.isDirectory()) {
          addDirRecursive(fullPath, relPath);
        } else if (item.isFile()) {
          archive.file(fullPath, { name: relPath });
        }
      }
    }

    try {
      addDirRecursive(storePath);
      archive.finalize();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Stamps /LackProjectID, /LackProjectName and Keywords into the PDF.
 * Optionally attaches a source snapshot zip.
 */
async function writeLink(pdfBytesOrPath, { id, name = '', embedSnapshot = false, storePath = null, sourceDateEpoch = null }) {
  if (!id) throw new Error('Project ID is required');

  const inputBytes = Buffer.isBuffer(pdfBytesOrPath) || pdfBytesOrPath instanceof Uint8Array
    ? pdfBytesOrPath
    : fs.readFileSync(pdfBytesOrPath);

  const pdfDoc = await PDFDocument.load(inputBytes, { updateMetadata: false, ignoreEncryption: true });

  // 1. Set Info dictionary custom attributes
  const info = pdfDoc.getInfoDict();
  if (info) {
    info.set(PDFName.of('LackProjectID'), PDFString.of(id));
    if (name) {
      info.set(PDFName.of('LackProjectName'), PDFString.of(name));
    }
  }

  // 2. Set Keywords: preserve existing keywords and ensure lack:project=<id> is present
  const existingKeywords = pdfDoc.getKeywords() || '';
  const kwList = existingKeywords.split(/[\s,]+/).filter(k => k && !k.startsWith('lack:project='));
  kwList.push(`lack:project=${id}`);
  pdfDoc.setKeywords(kwList);

  // 3. Optional embedSnapshot
  if (embedSnapshot && storePath && fs.existsSync(storePath)) {
    const zipBuffer = await createSourceSnapshotZip(storePath);
    if (zipBuffer.length <= MAX_SNAPSHOT_SIZE) {
      await pdfDoc.attach(zipBuffer, 'lack-project.zip', {
        mimeType: 'application/zip',
        description: 'Lack Project Snapshot Archive',
        creationDate: sourceDateEpoch ? new Date(sourceDateEpoch * 1000) : new Date(),
        modificationDate: sourceDateEpoch ? new Date(sourceDateEpoch * 1000) : new Date()
      });
    } else {
      console.warn(`[LACK] Snapshot size (${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB) exceeds 25MB cap; skipping embed.`);
    }
  }

  // 4. Reproducible timestamp support
  if (sourceDateEpoch) {
    const fixedDate = new Date(sourceDateEpoch * 1000);
    pdfDoc.setModificationDate(fixedDate);
  }

  const outputBytes = await pdfDoc.save({ updateMetadata: false });
  return Buffer.from(outputBytes);
}

/**
 * Tolerant reader for project link metadata.
 * Tries pdf-lib first, falls back to regex scanning on the raw file buffer.
 */
async function readLink(pdfBytesOrPath) {
  let rawBuf;
  try {
    rawBuf = Buffer.isBuffer(pdfBytesOrPath) || pdfBytesOrPath instanceof Uint8Array
      ? Buffer.from(pdfBytesOrPath)
      : fs.readFileSync(pdfBytesOrPath);
  } catch (e) {
    return null;
  }

  let id = null;
  let name = null;
  let hasSnapshot = false;

  // Attempt 1: pdf-lib structured lookup
  try {
    const pdfDoc = await PDFDocument.load(rawBuf, { updateMetadata: false, ignoreEncryption: true });
    const info = pdfDoc.getInfoDict();
    if (info) {
      const idVal = info.get(PDFName.of('LackProjectID'));
      if (idVal) id = idVal.asString();
      const nameVal = info.get(PDFName.of('LackProjectName'));
      if (nameVal) name = nameVal.asString();
    }

    if (!id) {
      const keywords = pdfDoc.getKeywords() || '';
      const m = keywords.match(/lack:project=([A-Za-z0-9_-]+)/);
      if (m) id = m[1];
    }

    hasSnapshot = hasEmbeddedSnapshotFromDoc(pdfDoc);
  } catch (err) {
    if (process.env.LACK_DEBUG) {
      console.warn('[LACK_DEBUG] pdf-lib read error, falling back to regex:', err.message);
    }
  }

  // Attempt 2: Regex scanning on raw PDF buffer
  if (!id) {
    const text = rawBuf.toString('latin1');
    const idMatch = text.match(/\/LackProjectID\s*\(([^)]+)\)/);
    if (idMatch) id = idMatch[1];

    if (!id) {
      const kwMatch = text.match(/\/Keywords\s*\([^)]*?lack:project=([A-Za-z0-9_-]+)/);
      if (kwMatch) id = kwMatch[1];
    }

    const nameMatch = text.match(/\/LackProjectName\s*\(([^)]+)\)/);
    if (nameMatch) name = nameMatch[1];

    if (text.includes('lack-project.zip')) {
      hasSnapshot = true;
    }
  }

  if (!id) return null;
  return { id, name: name || 'Untitled Project', hasSnapshot };
}

function hasEmbeddedSnapshotFromDoc(pdfDoc) {
  try {
    const rawNames = pdfDoc.catalog.lookup(PDFName.of('Names'));
    if (!rawNames) return false;
    const embeddedFiles = pdfDoc.context.lookup(rawNames.get(PDFName.of('EmbeddedFiles')));
    if (!embeddedFiles) return false;
    const names = pdfDoc.context.lookup(embeddedFiles.get(PDFName.of('Names')));
    if (!names) return false;
    const array = names.asArray();
    for (let idx = 0; idx < array.length; idx += 2) {
      const fileName = typeof array[idx].decodeText === 'function'
        ? array[idx].decodeText()
        : array[idx].asString();
      if (fileName.includes('lack-project.zip') || array[idx].asString().includes('6C00610063006B')) {
        return true;
      }
    }
  } catch (_) {}
  return false;
}

/**
 * Extracts embedded lack-project.zip snapshot into destination folder.
 */
async function extractSnapshot(pdfBytesOrPath, targetDir) {
  const rawBuf = Buffer.isBuffer(pdfBytesOrPath) || pdfBytesOrPath instanceof Uint8Array
    ? Buffer.from(pdfBytesOrPath)
    : fs.readFileSync(pdfBytesOrPath);

  const pdfDoc = await PDFDocument.load(rawBuf, { updateMetadata: false, ignoreEncryption: true });
  const rawNames = pdfDoc.catalog.lookup(PDFName.of('Names'));
  if (!rawNames) return false;
  const embeddedFiles = pdfDoc.context.lookup(rawNames.get(PDFName.of('EmbeddedFiles')));
  if (!embeddedFiles) return false;
  const names = pdfDoc.context.lookup(embeddedFiles.get(PDFName.of('Names')));
  if (!names) return false;

  const array = names.asArray();
  let zipBytes = null;
  for (let idx = 0; idx < array.length; idx += 2) {
    const fileName = typeof array[idx].decodeText === 'function'
      ? array[idx].decodeText()
      : array[idx].asString();
    if (fileName.includes('lack-project.zip') || array[idx].asString().includes('6C00610063006B')) {
      const fileSpec = pdfDoc.context.lookup(array[idx + 1]);
      const efDict = pdfDoc.context.lookup(fileSpec.get(PDFName.of('EF')));
      if (efDict) {
        const stream = pdfDoc.context.lookup(efDict.get(PDFName.of('F')));
        if (stream) {
          const raw = stream.getContents();
          try {
            zipBytes = zlib.inflateSync(Buffer.from(raw));
          } catch (_) {
            zipBytes = Buffer.from(raw);
          }
          break;
        }
      }
    }
  }

  if (!zipBytes) return false;

  fs.mkdirSync(targetDir, { recursive: true });
  const zip = new AdmZip(zipBytes);
  zip.extractAllTo(targetDir, true);
  return true;
}

/**
 * Removes lack project metadata from a PDF.
 */
async function unlinkPdf(pdfPath) {
  const inputBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(inputBytes, { updateMetadata: false, ignoreEncryption: true });
  const info = pdfDoc.getInfoDict();
  if (info) {
    info.delete(PDFName.of('LackProjectID'));
    info.delete(PDFName.of('LackProjectName'));
  }
  const existingKeywords = pdfDoc.getKeywords() || '';
  const kwList = existingKeywords.split(/[\s,]+/).filter(k => k && !k.startsWith('lack:project='));
  pdfDoc.setKeywords(kwList);

  const outBytes = await pdfDoc.save({ updateMetadata: false });
  const tmpPath = `${pdfPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, Buffer.from(outBytes));
  fs.renameSync(tmpPath, pdfPath);
  return true;
}

module.exports = {
  writeLink,
  readLink,
  extractSnapshot,
  unlinkPdf,
  createSourceSnapshotZip,
  MAX_SNAPSHOT_SIZE
};
