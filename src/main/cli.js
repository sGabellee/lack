/**
 * src/main/cli.js
 * CLI argument parser and open-flow resolver implementing the Lack decision table.
 * Written as pure logic for robust unit testing.
 */

const path = require('path');

function parseCliArgs(rawArgv) {
  const args = [...rawArgv];
  let positional = null;
  let template = null;
  let name = null;
  let debug = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--template' && i + 1 < args.length) {
      template = args[++i];
    } else if (arg.startsWith('--template=')) {
      template = arg.slice('--template='.length);
    } else if (arg === '--name' && i + 1 < args.length) {
      name = args[++i];
    } else if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    } else if (arg === '--debug' || arg === '--verbose') {
      debug = true;
    } else if (!arg.startsWith('-') && !positional) {
      positional = arg;
    }
  }

  if (process.env.LACK_DEBUG) {
    debug = true;
  }

  return { positional, template, name, debug };
}

/**
 * Pure decision-table resolver for launch arguments.
 */
async function resolveLaunchArg(arg, cwd, fsProbe, registry, readLinkFn, options = {}) {
  const fs = fsProbe || require('fs');
  const readLink = readLinkFn || (async () => null);
  const baseCwd = cwd || process.cwd();
  const debug = options.debug || !!process.env.LACK_DEBUG;

  if (debug) {
    console.log(`[LACK_DEBUG] resolveLaunchArg input arg="${arg}", cwd="${baseCwd}"`);
  }

  if (!arg) {
    const res = { action: 'classic', openFilePath: null, openFolderPath: null, ...options, debug };
    if (debug) console.log('[LACK_DEBUG] Resolver decision:', res);
    return res;
  }

  // Resolve absolute path against caller CWD
  const targetPath = path.isAbsolute(arg)
    ? path.normalize(arg)
    : path.normalize(path.resolve(baseCwd, arg));

  if (fs.existsSync(targetPath)) {
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        const res = { action: 'classic', openFilePath: null, openFolderPath: targetPath, ...options, debug };
        if (debug) console.log('[LACK_DEBUG] Resolver decision (existing dir):', res);
        return res;
      }

      // Existing regular file
      if (targetPath.toLowerCase().endsWith('.pdf')) {
        const link = await readLink(targetPath);
        if (link && link.id) {
          const regHit = registry ? registry.getProject(link.id) : null;
          if (regHit && fs.existsSync(regHit.storePath)) {
            const res = {
              action: 'open-linked',
              projectId: link.id,
              name: link.name || regHit.name,
              storePath: regHit.storePath,
              targetPath,
              ...options,
              debug
            };
            if (debug) console.log('[LACK_DEBUG] Resolver decision (linked PDF):', res);
            return res;
          }
          const res = {
            action: 'prompt-relink-or-restore',
            projectId: link.id,
            name: link.name,
            targetPath,
            hasSnapshot: !!link.hasSnapshot,
            ...options,
            debug
          };
          if (debug) console.log('[LACK_DEBUG] Resolver decision (unlinked store hit):', res);
          return res;
        }

        const res = {
          action: 'prompt-claim-pdf',
          targetPath,
          name: options.name || path.basename(targetPath, path.extname(targetPath)),
          template: options.template,
          ...options,
          debug
        };
        if (debug) console.log('[LACK_DEBUG] Resolver decision (foreign PDF):', res);
        return res;
      }

      // Existing regular file without extension or other extension (.tex, .txt, etc.)
      const res = {
        action: 'classic',
        openFilePath: targetPath,
        openFolderPath: path.dirname(targetPath),
        ...options,
        debug
      };
      if (debug) console.log('[LACK_DEBUG] Resolver decision (existing file):', res);
      return res;
    } catch (err) {
      const res = {
        action: 'classic',
        openFilePath: targetPath,
        openFolderPath: path.dirname(targetPath),
        ...options,
        debug
      };
      if (debug) console.log('[LACK_DEBUG] Resolver decision (error fallback):', res);
      return res;
    }
  }

  // Path does NOT exist on disk
  const ext = path.extname(targetPath).toLowerCase();

  if (ext === '.tex') {
    // lack NAME.tex -> Classic, unchanged
    const res = {
      action: 'classic',
      openFilePath: targetPath,
      openFolderPath: path.dirname(targetPath),
      ...options,
      debug
    };
    if (debug) console.log('[LACK_DEBUG] Resolver decision (new .tex classic):', res);
    return res;
  }

  if (ext === '.pdf') {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      const res = {
        action: 'error',
        message: `Impossibile aprire il file: la cartella genitore "${parentDir}" non esiste.`,
        targetPath,
        ...options,
        debug
      };
      if (debug) console.log('[LACK_DEBUG] Resolver decision (parent missing error):', res);
      return res;
    }

    const res = {
      action: 'create-linked',
      targetPath,
      name: options.name || path.basename(targetPath, '.pdf'),
      template: options.template || 'standard',
      ...options,
      debug
    };
    if (debug) console.log('[LACK_DEBUG] Resolver decision (create-linked PDF):', res);
    return res;
  }

  if (ext === '') {
    // Extension-less launch: check if NAME.pdf exists!
    const pdfCandidate = `${targetPath}.pdf`;
    if (fs.existsSync(pdfCandidate)) {
      const link = await readLink(pdfCandidate);
      if (link && link.id) {
        const regHit = registry ? registry.getProject(link.id) : null;
        if (regHit && fs.existsSync(regHit.storePath)) {
          const res = {
            action: 'open-linked',
            projectId: link.id,
            name: link.name || regHit.name,
            storePath: regHit.storePath,
            targetPath: pdfCandidate,
            ...options,
            debug
          };
          if (debug) console.log('[LACK_DEBUG] Resolver decision (extension-less -> linked PDF):', res);
          return res;
        }
        const res = {
          action: 'prompt-relink-or-restore',
          projectId: link.id,
          name: link.name,
          targetPath: pdfCandidate,
          hasSnapshot: !!link.hasSnapshot,
          ...options,
          debug
        };
        if (debug) console.log('[LACK_DEBUG] Resolver decision (extension-less -> prompt relink):', res);
        return res;
      }

      const res = {
        action: 'prompt-claim-pdf',
        targetPath: pdfCandidate,
        name: options.name || path.basename(pdfCandidate, '.pdf'),
        template: options.template,
        ...options,
        debug
      };
      if (debug) console.log('[LACK_DEBUG] Resolver decision (extension-less -> claim PDF):', res);
      return res;
    }

    // NAME.pdf does not exist
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      const res = {
        action: 'error',
        message: `Impossibile aprire il file: la cartella genitore "${parentDir}" non esiste.`,
        targetPath,
        ...options,
        debug
      };
      if (debug) console.log('[LACK_DEBUG] Resolver decision (extension-less parent missing):', res);
      return res;
    }

    // New linked project targeting <cwd>/NAME.pdf
    const res = {
      action: 'create-linked',
      targetPath: pdfCandidate,
      name: options.name || path.basename(targetPath),
      template: options.template || 'standard',
      ...options,
      debug
    };
    if (debug) console.log('[LACK_DEBUG] Resolver decision (extension-less -> create-linked):', res);
    return res;
  }

  // Any other non-existent file with extension (.bib, .sty, etc.)
  const res = {
    action: 'classic',
    openFilePath: targetPath,
    openFolderPath: path.dirname(targetPath),
    ...options,
    debug
  };
  if (debug) console.log('[LACK_DEBUG] Resolver decision (other ext classic):', res);
  return res;
}

async function resolveOpenAction({
  rawArgv,
  cwd,
  registry,
  readLinkFn,
  fsModule
}) {
  const { positional, template, name, debug } = parseCliArgs(rawArgv);
  return resolveLaunchArg(positional, cwd, fsModule, registry, readLinkFn, { template, name, debug });
}

module.exports = {
  parseCliArgs,
  resolveLaunchArg,
  resolveOpenAction
};
