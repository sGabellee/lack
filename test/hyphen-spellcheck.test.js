const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const nspell = require('nspell');
const { checkItemWithDictionaries } = require('../src/editor/spell-checker-core');

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

test('Spellcheck: hyphens and apostrophes handling', () => {
  const dictIt = loadDict('it');
  const dictEn = loadDict('en');
  const dicts = [dictIt, dictEn];

  // 1. Valid compound and elided words: NOT flagged
  const validCompounds = [
    'Sub-titles',
    'camera-ready',
    'two-column',
    'state-of-the-art',
    "l'acqua",
    "dell'università",
    "don't"
  ];

  for (const word of validCompounds) {
    const res = checkItemWithDictionaries({ word, from: 10, to: 10 + word.length }, dicts);
    assert.deepEqual(res, [], `Expected "${word}" not to be flagged, got ${JSON.stringify(res)}`);
  }

  // 2. Word with misspelled part: 'camra-ready' -> ONLY 'camra' flagged
  const camraRes = checkItemWithDictionaries({ word: 'camra-ready', from: 100, to: 111 }, dicts);
  assert.equal(camraRes.length, 1);
  assert.equal(camraRes[0].word, 'camra');
  assert.equal(camraRes[0].from, 100);
  assert.equal(camraRes[0].to, 105);

  // 3. 'perhè-x' -> 'perhè' flagged, 'x' skipped (length < 3)
  const perheRes = checkItemWithDictionaries({ word: 'perhè-x', from: 200, to: 207 }, dicts);
  assert.equal(perheRes.length, 1);
  assert.equal(perheRes[0].word, 'perhè');
  assert.equal(perheRes[0].from, 200);
  assert.equal(perheRes[0].to, 205);
});
