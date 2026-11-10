/**
 * src/main/engine-installer.js
 * One-click installer for pinned Tectonic binary.
 * Downloads official release from GitHub, verifies SHA-256, extracts to userData/engines/, and chmods +x.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

function getPlatformKey() {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform}-${arch}`;
}

function getPinnedManifest() {
  const manifestPath = path.join(__dirname, '..', '..', 'data', 'engines.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Engine manifest not found at: ${manifestPath}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function downloadFile(url, destPath, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with HTTP status ${res.statusCode}`));
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      const fileStream = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          onProgress({ percent: Math.round((downloadedBytes / totalBytes) * 100), downloadedBytes, totalBytes });
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => resolve(destPath));
      });

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

function verifySha256(filePath, expectedSha256) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  const actualSha256 = hash.digest('hex');
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`SHA-256 verification failed! Expected: ${expectedSha256}, Got: ${actualSha256}`);
  }
  return true;
}

async function installTectonic(userDataPath, onProgress = () => {}) {
  const manifest = getPinnedManifest();
  const key = getPlatformKey();
  const asset = manifest.assets[key];

  if (!asset) {
    throw new Error(`No pinned Tectonic build found for platform key: ${key}`);
  }

  const enginesDir = path.join(userDataPath, 'engines');
  if (!fs.existsSync(enginesDir)) {
    fs.mkdirSync(enginesDir, { recursive: true });
  }

  const archiveName = `tectonic-${manifest.version}.${asset.format}`;
  const archivePath = path.join(enginesDir, archiveName);

  onProgress({ status: 'downloading', percent: 0 });
  await downloadFile(asset.url, archivePath, onProgress);

  onProgress({ status: 'verifying', percent: 100 });
  verifySha256(archivePath, asset.sha256);

  onProgress({ status: 'extracting', percent: 100 });
  if (asset.format === 'zip') {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(enginesDir, true);
  } else {
    // tar.gz
    execSync(`tar -xzf "${archivePath}" -C "${enginesDir}"`);
  }

  // Clean up archive
  try { fs.unlinkSync(archivePath); } catch (_) {}

  const binaryPath = path.join(enginesDir, asset.binary);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Extracted binary not found at: ${binaryPath}`);
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(binaryPath, 0o755);
  }

  onProgress({ status: 'complete', binaryPath });
  return binaryPath;
}

module.exports = {
  getPlatformKey,
  getPinnedManifest,
  verifySha256,
  installTectonic
};
