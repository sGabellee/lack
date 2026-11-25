const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Text } = require('@codemirror/state');
const { SearchQuery } = require('@codemirror/search');

test('In-document search: SearchQuery finds occurrences and correct counts', () => {
  const docText = [
    '\\documentclass{article}',
    '\\begin{document}',
    'First section with quantum computing.',
    'Another quantum mention in the text.',
    'And a third QUANTUM in uppercase.',
    '\\end{document}'
  ].join('\n');

  const doc = Text.of(docText.split('\n'));

  // Case-insensitive search
  const sqCaseInsensitive = new SearchQuery({
    search: 'quantum',
    caseSensitive: false
  });
  const cursor1 = sqCaseInsensitive.getCursor(doc);
  let matchesCaseInsensitive = 0;
  while (!cursor1.next().done) {
    matchesCaseInsensitive++;
  }
  assert.equal(matchesCaseInsensitive, 3, 'Should find 3 matches case-insensitively');

  // Case-sensitive search
  const sqCaseSensitive = new SearchQuery({
    search: 'quantum',
    caseSensitive: true
  });
  const cursor2 = sqCaseSensitive.getCursor(doc);
  let matchesCaseSensitive = 0;
  while (!cursor2.next().done) {
    matchesCaseSensitive++;
  }
  assert.equal(matchesCaseSensitive, 2, 'Should find 2 matches case-sensitively');
});

test('Project-wide search regex: supports case sensitive and whole word options', () => {
  function createSearchRegex(query, { matchCase = false, wholeWord = false } = {}) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
    return new RegExp(pattern, matchCase ? 'g' : 'gi');
  }

  const sampleLine = 'FlashAttention is faster than Flash and FlashAttention-2';

  // Regular search
  const r1 = createSearchRegex('Flash', { matchCase: true, wholeWord: false });
  const matches1 = sampleLine.match(r1);
  assert.equal(matches1.length, 3, 'Substring search finds all 3 occurrences');

  // Whole word search
  const r2 = createSearchRegex('Flash', { matchCase: true, wholeWord: true });
  const matches2 = sampleLine.match(r2);
  assert.equal(matches2.length, 1, 'Whole word search finds only 1 standalone "Flash"');

  // Case insensitive
  const r3 = createSearchRegex('flash', { matchCase: false, wholeWord: true });
  const matches3 = sampleLine.match(r3);
  assert.equal(matches3.length, 1, 'Whole word search case-insensitive finds 1 match');
});

test('Project search logic: scans multiple files and groups matches by file and line', () => {
  const dummyFiles = [
    {
      relPath: 'main.tex',
      content: '\\input{sections/intro.tex}\n\\input{sections/methods.tex}\nHello world in main'
    },
    {
      relPath: 'sections/intro.tex',
      content: 'This is the introduction.\nWe discuss world models.\nAnother world mention.'
    },
    {
      relPath: 'sections/methods.tex',
      content: 'Methods section describes algorithms.\nNo match here.'
    }
  ];

  const query = 'world';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');

  const results = [];
  let totalMatches = 0;

  for (const file of dummyFiles) {
    const lines = file.content.split(/\r?\n/);
    const fileMatches = [];
    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const lineText = lines[lIdx];
      regex.lastIndex = 0;
      let m;
      while ((m = regex.exec(lineText)) !== null) {
        fileMatches.push({
          lineNum: lIdx + 1,
          col: m.index + 1,
          matchLength: m[0].length,
          matchIndex: m.index,
          lineText
        });
        if (m[0].length === 0) break;
      }
    }
    if (fileMatches.length > 0) {
      totalMatches += fileMatches.length;
      results.push({ fileRelPath: file.relPath, matches: fileMatches });
    }
  }

  assert.equal(results.length, 2, 'Matches found in 2 files');
  assert.equal(totalMatches, 3, 'Total 3 matches across project');
  assert.equal(results[0].fileRelPath, 'main.tex');
  assert.equal(results[0].matches.length, 1);
  assert.equal(results[0].matches[0].lineNum, 3);
  assert.equal(results[1].fileRelPath, 'sections/intro.tex');
  assert.equal(results[1].matches.length, 2);
  assert.equal(results[1].matches[0].lineNum, 2);
  assert.equal(results[1].matches[1].lineNum, 3);
});

test('index.html structure contains search containers and project drawer elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // In-document search container inside editor container
  assert.ok(html.includes('id="search-container"'), 'index.html has #search-container');
  assert.ok(html.includes('id="search-input"'), 'index.html has #search-input');
  assert.ok(html.includes('id="search-prev"'), 'index.html has #search-prev');
  assert.ok(html.includes('id="search-next"'), 'index.html has #search-next');
  assert.ok(html.includes('id="search-close"'), 'index.html has #search-close');
  assert.ok(html.includes('id="search-results"'), 'index.html has #search-results');

  // Logs drawer project search tab & pane
  assert.ok(html.includes('id="tab-log-search"'), 'index.html has #tab-log-search tab');
  assert.ok(html.includes('id="logs-search-pane"'), 'index.html has #logs-search-pane');
  assert.ok(html.includes('id="project-search-input"'), 'index.html has #project-search-input');
  assert.ok(html.includes('id="project-search-results"'), 'index.html has #project-search-results');
  assert.ok(html.includes('id="project-search-summary"'), 'index.html has #project-search-summary');
  assert.ok(html.includes('id="footer-btn-project-search"'), 'index.html has #footer-btn-project-search');

  // Titlebar menu items
  assert.ok(html.includes('data-action="find"'), 'titlebar has Find item');
  assert.ok(html.includes('data-action="find-in-project"'), 'titlebar has Find in Project item');
});

test('main.js registers accelerators for document search and project search', () => {
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(mainJs.includes('open-search'), 'main.js sends open-search');
  assert.ok(mainJs.includes('CmdOrCtrl+F'), 'main.js binds CmdOrCtrl+F');
  assert.ok(mainJs.includes('open-project-search'), 'main.js sends open-project-search');
  assert.ok(mainJs.includes('CmdOrCtrl+Shift+F'), 'main.js binds CmdOrCtrl+Shift+F');
});
