const nspell = require('nspell');

let spInstances = [];
let currentLang = 'it+en';

function handleMessage(data) {
  if (!data) return;

  switch (data.type) {
    case 'init': {
      try {
        const { lang, dictionaries, customWords } = data;
        currentLang = lang;
        spInstances = [];

        if (Array.isArray(dictionaries) && dictionaries.length > 0) {
          for (const d of dictionaries) {
            if (d && d.aff && d.dic) {
              const sp = nspell(d.aff, d.dic);
              spInstances.push(sp);
            }
          }
        } else if (data.aff && data.dic) {
          // Backward compatibility for single dictionary
          const sp = nspell(data.aff, data.dic);
          spInstances.push(sp);
        }

        if (Array.isArray(customWords)) {
          customWords.forEach((w) => {
            if (w && w.trim()) {
              const clean = w.trim();
              spInstances.forEach((sp) => sp.add(clean));
            }
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
      if (!spInstances || spInstances.length === 0) {
        respond({ type: 'checkResult', id, misspelled: [] });
        return;
      }
      const misspelled = [];
      for (let i = 0; i < words.length; i++) {
        const item = words[i];
        // Bilingual check: correct if accepted by ANY loaded dictionary
        const isCorrect = spInstances.some((sp) => sp.correct(item.word));
        if (!isCorrect) {
          misspelled.push(item);
        }
      }
      respond({ type: 'checkResult', id, misspelled });
      break;
    }

    case 'suggest': {
      const { id, word } = data;
      if (!spInstances || spInstances.length === 0) {
        respond({ type: 'suggestResult', id, word, suggestions: [] });
        return;
      }
      const seen = new Set();
      const suggestions = [];
      for (const sp of spInstances) {
        const list = sp.suggest(word) || [];
        for (const s of list) {
          if (!seen.has(s)) {
            seen.add(s);
            suggestions.push(s);
          }
        }
      }
      respond({ type: 'suggestResult', id, word, suggestions: suggestions.slice(0, 8) });
      break;
    }

    case 'addWord': {
      const { word } = data;
      if (word) {
        spInstances.forEach((sp) => sp.add(word));
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
