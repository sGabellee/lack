#!/usr/bin/env node
/**
 * scripts/pin-tectonic.js
 * Generates and pins data/engines.json manifest from official Tectonic release on GitHub.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const VERSION = '0.17.0';
const ASSETS_CONFIG = [
  { key: 'linux-x64', platform: 'linux', arch: 'x64', binary: 'tectonic', format: 'tar.gz', file: 'tectonic-0.17.0-x86_64-unknown-linux-gnu.tar.gz' },
  { key: 'linux-arm64', platform: 'linux', arch: 'arm64', binary: 'tectonic', format: 'tar.gz', file: 'tectonic-0.17.0-aarch64-unknown-linux-musl.tar.gz' },
  { key: 'darwin-x64', platform: 'darwin', arch: 'x64', binary: 'tectonic', format: 'tar.gz', file: 'tectonic-0.17.0-x86_64-apple-darwin.tar.gz' },
  { key: 'darwin-arm64', platform: 'darwin', arch: 'arm64', binary: 'tectonic', format: 'tar.gz', file: 'tectonic-0.17.0-aarch64-apple-darwin.tar.gz' },
  { key: 'win32-x64', platform: 'win32', arch: 'x64', binary: 'tectonic.exe', format: 'zip', file: 'tectonic-0.17.0-x86_64-pc-windows-msvc.zip' }
];

function fetchSha256(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (res2) => {
          const hash = crypto.createHash('sha256');
          res2.on('data', chunk => hash.update(chunk));
          res2.on('end', () => resolve(hash.digest('hex')));
          res2.on('error', reject);
        });
      } else if (res.statusCode === 200) {
        const hash = crypto.createHash('sha256');
        res.on('data', chunk => hash.update(chunk));
        res.on('end', () => resolve(hash.digest('hex')));
        res.on('error', reject);
      } else {
        reject(new Error(`Failed with status: ${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

async function main() {
  console.log(`Pinning Tectonic version ${VERSION}...`);
  const manifest = {
    version: VERSION,
    name: 'tectonic',
    assets: {}
  };

  for (const asset of ASSETS_CONFIG) {
    const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/${asset.file}`;
    console.log(`Calculating SHA-256 for ${asset.key}...`);
    try {
      const sha256 = await fetchSha256(url);
      manifest.assets[asset.key] = {
        url,
        sha256,
        format: asset.format,
        binary: asset.binary
      };
      console.log(`  ✓ ${asset.key}: ${sha256}`);
    } catch (e) {
      console.warn(`  ✗ Failed to fetch for ${asset.key}:`, e.message);
    }
  }

  const outPath = path.join(__dirname, '..', 'data', 'engines.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Pinned manifest written to: ${outPath}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, ASSETS_CONFIG };
