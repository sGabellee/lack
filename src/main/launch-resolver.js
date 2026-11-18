/**
 * src/main/launch-resolver.js
 * Pure launch context and argument resolver for Lack.
 * Implements the Phase 1 specification and decision table.
 */

const path = require('path');

/**
 * Filter out Electron runtime arguments and command flags.
 */
function extractPositional(argv = []) {
  const flags = {
    debug: false,
    template: null,
    name: null
  };
  const positionals = [];

  let startIndex = 0;
  if (argv.length > 0) {
    const first = path.basename(argv[0]).toLowerCase();
    if (first === 'electron' || first === 'electron.exe' || first === 'node' || first === 'node.exe') {
      startIndex = 1;
      if (argv.length > 1) {
        const second = argv[1];
        if (second === '.' || second.endsWith('main.js') || second.endsWith('index.js')) {
          startIndex = 2;
        }
      }
    } else if (first === 'lack' || first === 'lack.exe') {
      startIndex = 1;
    }
  }

  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === '--debug' || arg === '--verbose') {
      flags.debug = true;
    } else if (arg.startsWith('--template=')) {
      flags.template = arg.slice('--template='.length);
    } else if (arg === '--template' && i + 1 < argv.length) {
      flags.template = argv[++i];
    } else if (arg.startsWith('--name=')) {
      flags.name = arg.slice('--name='.length);
    } else if (arg === '--name' && i + 1 < argv.length) {
      flags.name = argv[++i];
    } else if (arg.startsWith('-')) {
      continue;
    } else {
      positionals.push(arg);
    }
  }

  return { positional: positionals[0] || null, flags };
}

/**
 * Pure resolver: resolveLaunch({ argv, env, platform, probe })
 *
 * @param {Object} params
 * @param {Array<string>} params.argv - process.argv or simulated command line
 * @param {Object} params.env - process.env (checks LACK_LAUNCHED_FROM, LACK_CWD, LACK_DEBUG)
 * @param {string} [params.platform] - process.platform ('linux', 'darwin', 'win32')
 * @param {Object} params.probe - filesystem / registry probe interface:
 *        { existsSync(p), statSync(p), readDirSync(p), readLink(p), getProject(id), hasTexFiles(dir) }
 */
function resolveLaunch({ argv = [], env = {}, platform = process.platform, probe = {} }) {
  const isCli = env.LACK_LAUNCHED_FROM === 'cli';
  const debug = !!(env.LACK_DEBUG || false);
  const { positional, flags } = extractPositional(argv);
  const effectiveDebug = debug || flags.debug;

  const existsSync = probe.existsSync || (() => false);
  const statSync = probe.statSync || (() => ({ isDirectory: () => false, isFile: () => true }));
  const readDirSync = probe.readDirSync || (() => []);
  const readLink = probe.readLink || (async () => null);
  const getProject = probe.getProject || (() => null);

  function checkDirHasTex(dirPath) {
    if (typeof probe.hasTexFiles === 'function') {
      return probe.hasTexFiles(dirPath);
    }
    try {
      const files = readDirSync(dirPath);
      return Array.isArray(files) && files.some(f => f.toLowerCase().endsWith('.tex'));
    } catch (_) {
      return false;
    }
  }

  // 1. GUI Launch (Desktop, Dock, Finder, AppImage, or `npm start` without LACK_LAUNCHED_FROM=cli)
  if (!isCli) {
    // If no positional argument was provided, ALWAYS open start screen.
    // CWD is strictly ignored!
    if (!positional) {
      return {
        action: 'start-screen',
        openFolder: null,
        openFile: null,
        offerConversion: false,
        isCli: false,
        debug: effectiveDebug
      };
    }

    // If positional arg is provided in GUI mode, GUI args must be absolute or resolved strictly if absolute
    const targetPath = path.normalize(positional);
    if (existsSync(targetPath)) {
      const stat = statSync(targetPath);
      if (stat.isDirectory()) {
        const hasTex = checkDirHasTex(targetPath);
        return {
          action: 'open-folder',
          openFolder: targetPath,
          openFile: null,
          offerConversion: hasTex,
          isCli: false,
          debug: effectiveDebug
        };
      }
      return {
        action: 'open-file',
        openFile: targetPath,
        openFolder: path.dirname(targetPath),
        offerConversion: false,
        isCli: false,
        debug: effectiveDebug
      };
    }

    // Non-existent target passed to GUI launcher -> fallback to start screen
    return {
      action: 'start-screen',
      openFolder: null,
      openFile: null,
      offerConversion: false,
      isCli: false,
      debug: effectiveDebug
    };
  }

  // 2. CLI Launch (LACK_LAUNCHED_FROM === 'cli')
  const callerCwd = env.LACK_CWD || process.cwd();

  if (!positional) {
    // CLI `lack` (no args) -> Start screen: no folder, no file, no untitled
    return {
      action: 'start-screen',
      openFolder: null,
      openFile: null,
      offerConversion: false,
      isCli: true,
      debug: effectiveDebug
    };
  }

  // Resolve positional path against caller CWD
  const resolvedPath = path.isAbsolute(positional)
    ? path.normalize(positional)
    : path.normalize(path.resolve(callerCwd, positional));

  // A. Check if directory exists
  if (existsSync(resolvedPath)) {
    const stat = statSync(resolvedPath);
    if (stat.isDirectory()) {
      const hasTex = checkDirHasTex(resolvedPath);
      return {
        action: 'open-folder',
        openFolder: resolvedPath,
        openFile: null,
        offerConversion: hasTex,
        isCli: true,
        debug: effectiveDebug
      };
    }

    // B. Existing regular file
    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext === '.pdf') {
      return {
        action: 'resolve-pdf',
        targetPath: resolvedPath,
        name: flags.name || path.basename(resolvedPath, '.pdf'),
        template: flags.template,
        isCli: true,
        debug: effectiveDebug
      };
    }

    return {
      action: 'open-file',
      openFile: resolvedPath,
      openFolder: path.dirname(resolvedPath),
      offerConversion: false,
      isCli: true,
      debug: effectiveDebug
    };
  }

  // C. Path does NOT exist on disk
  const ext = path.extname(resolvedPath).toLowerCase();

  // If path has no extension, check if NAME.pdf exists or if it's a linked project name
  if (ext === '') {
    const pdfCandidate = `${resolvedPath}.pdf`;
    if (existsSync(pdfCandidate)) {
      return {
        action: 'resolve-pdf',
        targetPath: pdfCandidate,
        name: flags.name || path.basename(pdfCandidate, '.pdf'),
        template: flags.template,
        isCli: true,
        debug: effectiveDebug
      };
    }

    // Does parent exist?
    const parentDir = path.dirname(resolvedPath);
    if (!existsSync(parentDir)) {
      return {
        action: 'error',
        message: `Impossibile aprire il file: la cartella genitore "${parentDir}" non esiste.`,
        targetPath: resolvedPath,
        isCli: true,
        debug: effectiveDebug
      };
    }

    // Create linked project for NAME
    return {
      action: 'create-linked',
      targetPath: pdfCandidate,
      name: flags.name || path.basename(resolvedPath),
      template: flags.template || 'standard',
      isCli: true,
      debug: effectiveDebug
    };
  }

  if (ext === '.pdf') {
    const parentDir = path.dirname(resolvedPath);
    if (!existsSync(parentDir)) {
      return {
        action: 'error',
        message: `Impossibile aprire il file: la cartella genitore "${parentDir}" non esiste.`,
        targetPath: resolvedPath,
        isCli: true,
        debug: effectiveDebug
      };
    }

    return {
      action: 'create-linked',
      targetPath: resolvedPath,
      name: flags.name || path.basename(resolvedPath, '.pdf'),
      template: flags.template || 'standard',
      isCli: true,
      debug: effectiveDebug
    };
  }

  if (ext === '.tex') {
    const parentDir = path.dirname(resolvedPath);
    if (existsSync(parentDir)) {
      return {
        action: 'bind-buffer',
        openFile: resolvedPath,
        openFolder: parentDir,
        createOnSave: true,
        isCli: true,
        debug: effectiveDebug
      };
    } else {
      return {
        action: 'error',
        message: `Impossibile creare il file: la cartella genitore "${parentDir}" non esiste.`,
        targetPath: resolvedPath,
        isCli: true,
        debug: effectiveDebug
      };
    }
  }

  // Any other non-existent file
  const parentDir = path.dirname(resolvedPath);
  if (existsSync(parentDir)) {
    return {
      action: 'bind-buffer',
      openFile: resolvedPath,
      openFolder: parentDir,
      createOnSave: true,
      isCli: true,
      debug: effectiveDebug
    };
  }

  return {
    action: 'error',
    message: `Impossibile trovare o creare il percorso "${resolvedPath}".`,
    targetPath: resolvedPath,
    isCli: true,
    debug: effectiveDebug
  };
}

module.exports = {
  extractPositional,
  resolveLaunch
};
