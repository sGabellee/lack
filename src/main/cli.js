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

  return { positional, template, name, debug };
}

async function resolveOpenAction({
  rawArgv,
  cwd,
  registry,
  readLinkFn,
  fsModule
}) {
  const fs = fsModule || require('fs');
  const readLink = readLinkFn || (async () => null);
  const baseCwd = cwd || process.cwd();

  const { positional, template, name, debug } = parseCliArgs(rawArgv);

  if (!positional) {
    return { action: 'classic', openFilePath: null, openFolderPath: null, debug };
  }

  // Resolve absolute path against caller CWD
  const targetPath = path.isAbsolute(positional)
    ? path.normalize(positional)
    : path.normalize(path.resolve(baseCwd, positional));

  const isPdf = targetPath.toLowerCase().endsWith('.pdf');

  // If not a PDF, standard classic file/folder handling
  if (!isPdf) {
    if (fs.existsSync(targetPath)) {
      try {
        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
          return { action: 'classic', openFilePath: null, openFolderPath: targetPath, debug };
        }
        return {
          action: 'classic',
          openFilePath: targetPath,
          openFolderPath: path.dirname(targetPath),
          debug
        };
      } catch (_) {
        return { action: 'classic', openFilePath: targetPath, openFolderPath: path.dirname(targetPath), debug };
      }
    }
    return { action: 'classic', openFilePath: targetPath, openFolderPath: path.dirname(targetPath), debug };
  }

  // --- PDF Decision Flow ---
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) {
    return {
      action: 'error',
      message: `Impossibile aprire il file: la cartella genitore "${parentDir}" non esiste.`,
      targetPath,
      debug
    };
  }

  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return {
        action: 'error',
        message: `Il percorso specificato "${targetPath}" è una cartella e non un file PDF.`,
        targetPath,
        debug
      };
    }

    // PDF exists on disk: check for project link metadata
    const link = await readLink(targetPath);

    if (link && link.id) {
      // Check if project is in registry
      const regHit = registry ? registry.getProject(link.id) : null;
      if (regHit && fs.existsSync(regHit.storePath)) {
        return {
          action: 'open-linked',
          projectId: link.id,
          name: link.name || regHit.name,
          storePath: regHit.storePath,
          targetPath,
          debug
        };
      }
      // Link present but store/registry miss
      return {
        action: 'prompt-relink-or-restore',
        projectId: link.id,
        name: link.name,
        targetPath,
        hasSnapshot: !!link.hasSnapshot,
        debug
      };
    }

    // PDF exists but has no Lack project link (foreign PDF)
    return {
      action: 'prompt-claim-pdf',
      targetPath,
      name: name || path.basename(targetPath, path.extname(targetPath)),
      template,
      debug
    };
  }

  // PDF does not exist: create a new linked project
  return {
    action: 'create-linked',
    targetPath,
    name: name || path.basename(targetPath, path.extname(targetPath)),
    template: template || 'standard',
    debug
  };
}

module.exports = {
  parseCliArgs,
  resolveOpenAction
};
