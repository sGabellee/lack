const { ViewPlugin, Decoration } = require('@codemirror/view');
const { RangeSetBuilder } = require('@codemirror/state');
const { tokenizeLatexProse } = require('./spell-tokenizer');
const path = require('path');
const fs = require('fs');

const spellErrorMark = Decoration.mark({
  class: 'cm-spell-error',
  attributes: { 'data-spell-error': 'true' }
});

let workerInstance = null;
let reqId = 0;
const pendingRequests = new Map();
let currentLang = 'it';
let userDictionary = new Set();
let userDictPath = null;
let onDecorationsUpdate = null;

function getUserDictionaryPath() {
  if (userDictPath) return userDictPath;
  try {
    const { app } = require('@electron/remote') || require('electron');
    const userData = app ? app.getPath('userData') : process.cwd();
    userDictPath = path.join(userData, 'user-dictionary.txt');
  } catch (e) {
    userDictPath = path.join(process.cwd(), 'user-dictionary.txt');
  }
  return userDictPath;
}

function loadUserDictionary() {
  try {
    const p = getUserDictionaryPath();
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      lines.forEach((w) => {
        const trimmed = w.trim();
        if (trimmed) userDictionary.add(trimmed.toLowerCase());
      });
    }
  } catch (e) {
    console.error('Failed to load user dictionary:', e);
  }
}

function addToUserDictionary(word) {
  if (!word) return;
  const clean = word.trim().toLowerCase();
  userDictionary.add(clean);
  if (workerInstance) {
    workerInstance.postMessage({ type: 'addWord', word: clean });
  }
  try {
    const p = getUserDictionaryPath();
    fs.appendFileSync(p, clean + '\n', 'utf8');
  } catch (e) {
    console.error('Failed to save to user dictionary:', e);
  }
}

function initSpellWorker(baseDir) {
  if (workerInstance) return workerInstance;

  try {
    const workerScriptPath = path.join(__dirname, 'spell.worker.bundle.js');
    if (typeof Worker !== 'undefined') {
      workerInstance = new Worker(workerScriptPath);
      workerInstance.onmessage = function (e) {
        const data = e.data;
        if (data && data.id && pendingRequests.has(data.id)) {
          const resolve = pendingRequests.get(data.id);
          pendingRequests.delete(data.id);
          resolve(data);
        }
      };
    }
  } catch (err) {
    console.error('Worker initialization failed, fallback to in-thread handler:', err);
    const { handleMessage } = require('./spell.worker');
    workerInstance = {
      postMessage(msg) {
        // Run asynchronously
        setTimeout(() => {
          handleMessage(msg);
        }, 0);
      }
    };
  }

  loadUserDictionary();
  return workerInstance;
}

function setLanguage(lang, baseDir = process.cwd()) {
  currentLang = lang;
  if (lang === 'none' || !lang) {
    return Promise.resolve();
  }

  const worker = initSpellWorker(baseDir);

  return new Promise((resolve) => {
    let affPath, dicPath;
    let stripPfx = false;

    if (lang === 'it') {
      affPath = path.join(baseDir, 'node_modules/dictionary-it/index.aff');
      dicPath = path.join(baseDir, 'node_modules/dictionary-it/index.dic');
      stripPfx = true;
    } else if (lang === 'en-gb') {
      affPath = path.join(baseDir, 'node_modules/dictionary-en-gb/index.aff');
      dicPath = path.join(baseDir, 'node_modules/dictionary-en-gb/index.dic');
    } else {
      affPath = path.join(baseDir, 'node_modules/dictionary-en/index.aff');
      dicPath = path.join(baseDir, 'node_modules/dictionary-en/index.dic');
    }

    try {
      let aff = fs.readFileSync(affPath, 'utf8');
      const dic = fs.readFileSync(dicPath, 'utf8');

      if (stripPfx) {
        aff = aff
          .split('\n')
          .filter((line) => !line.startsWith('PFX '))
          .join('\n') + '\nREP h ch\nREP è é\n';
      }

      const id = ++reqId;
      pendingRequests.set(id, () => resolve(true));

      worker.postMessage({
        type: 'init',
        id,
        lang,
        aff,
        dic,
        customWords: Array.from(userDictionary)
      });
    } catch (e) {
      console.error('Failed to load dictionary files:', e);
      resolve(false);
    }
  });
}

function checkWordsAsync(words) {
  if (!workerInstance || currentLang === 'none' || words.length === 0) {
    return Promise.resolve([]);
  }

  // Filter out any word already in user dictionary
  const filtered = words.filter((w) => !userDictionary.has(w.word.toLowerCase()));
  if (filtered.length === 0) {
    return Promise.resolve([]);
  }

  const id = ++reqId;
  return new Promise((resolve) => {
    pendingRequests.set(id, (res) => {
      resolve(res.misspelled || []);
    });
    workerInstance.postMessage({
      type: 'check',
      id,
      words: filtered
    });
  });
}

function getSpellSuggestions(word) {
  if (!workerInstance || currentLang === 'none' || !word) {
    return Promise.resolve([]);
  }

  const id = ++reqId;
  return new Promise((resolve) => {
    pendingRequests.set(id, (res) => {
      resolve(res.suggestions || []);
    });
    workerInstance.postMessage({
      type: 'suggest',
      id,
      word
    });
  });
}

function createSpellCheckPlugin() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = Decoration.none;
        this.view = view;
        this.debounceTimer = null;
        this.scheduleCheck(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.scheduleCheck(update.view);
        }
      }

      destroy() {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
      }

      scheduleCheck(view) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.runCheck(view);
        }, 300);
      }

      async runCheck(view) {
        if (currentLang === 'none') {
          this.decorations = Decoration.none;
          view.requestMeasure();
          return;
        }

        const docText = view.state.doc.toString();
        const tokens = tokenizeLatexProse(docText);

        const misspelled = await checkWordsAsync(tokens);

        const builder = new RangeSetBuilder();
        misspelled.sort((a, b) => a.from - b.from);

        for (const item of misspelled) {
          if (item.from < item.to && item.to <= docText.length) {
            builder.add(item.from, item.to, spellErrorMark);
          }
        }

        this.decorations = builder.finish();
        view.requestMeasure();
      }
    },
    {
      decorations: (v) => v.decorations
    }
  );
}

module.exports = {
  createSpellCheckPlugin,
  setLanguage,
  addToUserDictionary,
  getSpellSuggestions,
  initSpellWorker
};
