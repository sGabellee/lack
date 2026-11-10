const esbuild = require('esbuild');
const path = require('path');

async function build() {
  try {
    // 1. Build Editor Bundle
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src/editor/index.js')],
      bundle: true,
      outfile: path.join(__dirname, 'renderer.bundle.js'),
      format: 'cjs',
      platform: 'node',
      target: 'es2022',
      sourcemap: true,
      minify: false,
      logLevel: 'info',
      external: ['electron', '@electron/remote', 'yjs']
    });
    console.log('Successfully built renderer.bundle.js');

    // 2. Build Spell Worker Bundle
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src/editor/spell.worker.js')],
      bundle: true,
      outfile: path.join(__dirname, 'spell.worker.bundle.js'),
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      sourcemap: true,
      minify: false,
      logLevel: 'info'
    });
    console.log('Successfully built spell.worker.bundle.js');
  } catch (err) {
    console.error('esbuild failed:', err);
    process.exit(1);
  }
}

build();
