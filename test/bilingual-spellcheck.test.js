const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const nspell = require('nspell');

function loadDict(lang) {
  let affPath, dicPath;
  let stripPfx = false;
  if (lang === 'it') {
    affPath = path.join(__dirname, '../node_modules/dictionary-it/index.aff');
    dicPath = path.join(__dirname, '../node_modules/dictionary-it/index.dic');
    stripPfx = true;
  } else {
    affPath = path.join(__dirname, '../node_modules/dictionary-en/index.aff');
    dicPath = path.join(__dirname, '../node_modules/dictionary-en/index.dic');
  }
  let aff = fs.readFileSync(affPath, 'utf8');
  const dic = fs.readFileSync(dicPath, 'utf8');
  if (stripPfx) {
    aff = aff
      .split('\n')
      .filter((line) => !line.startsWith('PFX '))
      .join('\n') + '\nREP h ch\nREP è é\n';
  }
  return nspell(aff, dic);
}

test('Bilingual spellcheck: simultaneously accepts valid Italian and English words', () => {
  const dictIt = loadDict('it');
  const dictEn = loadDict('en');
  const dicts = [dictIt, dictEn];

  function isCorrect(word) {
    return dicts.some(d => d.correct(word));
  }

  // English words (commonly used in LaTeX standard templates)
  assert.ok(isCorrect('Document'), 'Document is valid in English');
  assert.ok(isCorrect('Title'), 'Title is valid in English');
  assert.ok(isCorrect('Introduction'), 'Introduction is valid in English');
  assert.ok(isCorrect('Author'), 'Author is valid in English');
  assert.ok(isCorrect('Name'), 'Name is valid in English');

  // Italian words
  assert.ok(isCorrect('Buongiorno'), 'Buongiorno is valid in Italian');
  assert.ok(isCorrect('Relazione'), 'Relazione is valid in Italian');
  assert.ok(isCorrect('Capitolo'), 'Capitolo is valid in Italian');

  // Misspelled words (invalid in both)
  assert.ok(!isCorrect('errorrre'), 'errorrre is invalid');
  assert.ok(!isCorrect('writtingg'), 'writtingg is invalid');
});
