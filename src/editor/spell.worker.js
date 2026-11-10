const nspell = require('nspell');

let spInstance = null;
let currentLang = null;

function handleMessage(data) {
  if (!data) return;

  switch (data.type) {
    case 'init': {
      try {
        const { lang, aff, dic, customWords } = data;
        spInstance = nspell(aff, dic);
        currentLang = lang;
        if (Array.isArray(customWords)) {
          customWords.forEach((w) => {
            if (w && w.trim()) spInstance.add(w.trim());
          });
        }
        respond({ type: 'ready', lang });
      } catch (err) {
        respond({ type: 'error', error: err.message });
      }
      break;
    }

    case 'check': {
      const { id, words } = data;
      if (!spInstance) {
        respond({ type: 'checkResult', id, misspelled: [] });
        return;
      }
      const misspelled = [];
      for (let i = 0; i < words.length; i++) {
        const item = words[i];
        if (!spInstance.correct(item.word)) {
          misspelled.push(item);
        }
      }
      respond({ type: 'checkResult', id, misspelled });
      break;
    }

    case 'suggest': {
      const { id, word } = data;
      if (!spInstance) {
        respond({ type: 'suggestResult', id, word, suggestions: [] });
        return;
      }
      const suggestions = spInstance.suggest(word) || [];
      respond({ type: 'suggestResult', id, word, suggestions });
      break;
    }

    case 'addWord': {
      const { word } = data;
      if (spInstance && word) {
        spInstance.add(word);
      }
      respond({ type: 'wordAdded', word });
      break;
    }
  }
}

function respond(msg) {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.postMessage(msg);
  } else if (typeof process !== 'undefined' && process.send) {
    process.send(msg);
  }
}

if (typeof self !== 'undefined') {
  self.onmessage = function (e) {
    handleMessage(e.data);
  };
}

module.exports = { handleMessage };
