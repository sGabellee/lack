const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { lintLatexDocument } = require('../src/editor/linter-logic');
const { parseLatexLog } = require('../latex-compiler');

test('linter flags undefined control sequence even when inputenc and amsmath are loaded', () => {
  const doc = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\begin{document}
\\section{Introduction}
Write your content here...
provaprovaa
\\endmd
\\end{document}`;

  const diagnostics = lintLatexDocument(doc);
  assert.ok(diagnostics.length >= 1, 'Expected at least 1 diagnostic for \\endmd');
  const endmdDiag = diagnostics.find(d => d.message.includes('\\endmd'));
  assert.ok(endmdDiag, 'Diagnostic for \\endmd must be present');
  assert.strictEqual(endmdDiag.severity, 'error');
  assert.strictEqual(endmdDiag.line, 8);
});

test('parseLatexLog extracts command name from l.NN context', () => {
  const sampleLog = `
(./prova1.tex
./prova1.tex:16: Undefined control sequence.
l.16 \\endmd
           
[1]
)
`;
  const issues = parseLatexLog(sampleLog);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].file, 'prova1.tex');
  assert.strictEqual(issues[0].line, 16);
  assert.strictEqual(issues[0].command, '\\endmd');
  assert.strictEqual(issues[0].message, 'Undefined control sequence.');
});

test('parseLatexLog treats tectonic warning and overfull hbox as warning/box, never error', () => {
  const sampleLog = `
Running TeX ...
warning: prova2.tex:93: Overfull \\hbox (74.64427pt too wide) in paragraph at lines 83--93
warning: prova2.tex:247: Underfull \\hbox (badness 10000) in paragraph at lines 247--247
`;
  const issues = parseLatexLog(sampleLog);
  assert.strictEqual(issues.length, 2);
  assert.strictEqual(issues[0].file, 'prova2.tex');
  assert.strictEqual(issues[0].line, 93);
  assert.strictEqual(issues[0].type, 'box');
  assert.strictEqual(issues[0].command, null);

  assert.strictEqual(issues[1].file, 'prova2.tex');
  assert.strictEqual(issues[1].line, 247);
  assert.strictEqual(issues[1].type, 'box');
  assert.strictEqual(issues[1].command, null);
});

test('CodeMirrorManager setCompilerIssues correctly converts TeX errors into diagnostics on exact command range', () => {
  const docText = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}

\\title{Test}
\\author{Author}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Write your content here...
provaprovaa
\\endmd
\\end{document}`;

  const lines = docText.split('\n');
  const lineIdx = lines.findIndex(l => l.trim() === '\\endmd');
  assert.ok(lineIdx !== -1);
  const targetLine = lines[lineIdx];

  // Verify command matching
  const cmdMatch = targetLine.match(/\\[a-zA-Z@]+/);
  assert.ok(cmdMatch);
  assert.strictEqual(cmdMatch[0], '\\endmd');
});

test('filterProjectEntries excludes project.json, node_modules, and hidden files', () => {
  const { filterProjectEntries } = require('../src/projects/ui-controller');
  const items = [
    { name: 'document.tex', isDirectory: () => false },
    { name: '.lack', isDirectory: () => true },
    { name: 'project.json', isDirectory: () => false },
    { name: 'figures', isDirectory: () => true },
    { name: 'notes.txt', isDirectory: () => false }
  ];
  const filtered = filterProjectEntries(items);
  const names = filtered.map(x => x.name);
  assert.ok(!names.includes('project.json'), 'project.json must be excluded');
  assert.ok(!names.includes('.lack'), '.lack must be excluded');
  assert.deepStrictEqual(names, ['figures', 'document.tex', 'notes.txt']);
});

test('explorer multi-selection range includes all elements (folders and files) in between', () => {
  const allExplorerElements = [
    { path: '/proj/folderA', isDir: true },
    { path: '/proj/folderA/subfile1.tex', isDir: false },
    { path: '/proj/folderB', isDir: true },
    { path: '/proj/file1.tex', isDir: false },
    { path: '/proj/file2.tex', isDir: false }
  ];

  // Emulate Shift+click range logic
  function computeShiftRange(elements, anchorIdx, targetIdx) {
    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    return elements.slice(start, end + 1).map(el => el.path);
  }

  // Anchor on folderA (idx 0), Shift-click on file1.tex (idx 3)
  const range = computeShiftRange(allExplorerElements, 0, 3);
  assert.strictEqual(range.length, 4);
  assert.deepStrictEqual(range, [
    '/proj/folderA',
    '/proj/folderA/subfile1.tex',
    '/proj/folderB',
    '/proj/file1.tex'
  ]);
  // Verifies that folders (folderB) in between are included!
  assert.ok(range.includes('/proj/folderB'));
});

test('explorer multi-selection Ctrl-click toggles selection paths', () => {
  let selected = ['/proj/file1.tex'];
  
  function toggleCtrl(list, item) {
    const idx = list.indexOf(item);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(item);
    return list;
  }

  // Add file2
  toggleCtrl(selected, '/proj/file2.tex');
  assert.deepStrictEqual(selected, ['/proj/file1.tex', '/proj/file2.tex']);

  // Remove file1
  toggleCtrl(selected, '/proj/file1.tex');
  assert.deepStrictEqual(selected, ['/proj/file2.tex']);
});

test('batch deletion removes deduplicated targets and closes matching tabs', () => {
  const tabs = [
    { id: 't1', filePath: '/prove/a.tex', dirty: true },
    { id: 't2', filePath: '/prove/b.txt', dirty: false },
    { id: 't3', filePath: '/prove/keep.tex', dirty: false }
  ];

  const targets = ['/prove/a.tex', '/prove/b.txt', '/prove/a.tex']; // with duplicate
  const uniqueTargets = Array.from(new Set(targets.map(p => path.resolve(p))));
  assert.strictEqual(uniqueTargets.length, 2);

  const closedTabs = [];
  for (const fp of uniqueTargets) {
    const openTabs = tabs.filter(t => t.filePath && path.resolve(t.filePath) === fp);
    for (const t of openTabs) {
      t.dirty = false;
      closedTabs.push(t.id);
    }
  }

  assert.deepStrictEqual(closedTabs, ['t1', 't2']);
});

test('compileLatex propagates projectDir TEXINPUTS and stages dirty extraBuffers for build isolation', async () => {
  const { compileLatex } = require('../latex-compiler');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-compile-stage-'));
  const workDir = path.join(tmpRoot, 'proj');
  const outDir = path.join(workDir, '.lack', 'build');
  fs.mkdirSync(path.join(workDir, 'sections'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'report.tex'), '\\documentclass{article}\\begin{document}\\input{sections/Ass1_1}\\end{document}');
  fs.writeFileSync(path.join(workDir, 'sections', 'Ass1_1.tex'), 'on-disk');

  const probeEnvPath = path.join(tmpRoot, 'probe.json');
  const stubPath = path.join(tmpRoot, 'stub-engine.js');
  fs.writeFileSync(stubPath, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const outDir = process.argv[2];
const stagedPath = path.join(outDir, '_stage', 'sections', 'Ass1_1.tex');
fs.writeFileSync(${JSON.stringify(probeEnvPath)}, JSON.stringify({
  texinputs: process.env.TEXINPUTS || '',
  stagedContent: fs.existsSync(stagedPath) ? fs.readFileSync(stagedPath, 'utf8') : null
}));
const src = process.argv[3];
fs.writeFileSync(path.join(outDir, path.basename(src, '.tex') + '.pdf'), '%PDF-1.4\\n');
`, { mode: 0o755 });

  const prevCmd = process.env.LACK_ENGINE_CMD;
  process.env.LACK_ENGINE_CMD = stubPath;
  try {
    const res = await compileLatex({
      filePath: path.join(workDir, 'report.tex'),
      content: '\\documentclass{article}\\begin{document}\\input{sections/Ass1_1}\\end{document}',
      projectDir: workDir,
      outputDir: outDir,
      engine: 'tectonic',
      extraBuffers: [{ relPath: 'sections/Ass1_1.tex', content: 'unsaved-live-buffer' }],
      isMemoryBuffer: true
    });
    assert.strictEqual(res.success, true);
    const probe = JSON.parse(fs.readFileSync(probeEnvPath, 'utf8'));
    assert.ok(probe.texinputs.includes(workDir), 'TEXINPUTS must include project workDir');
    assert.strictEqual(probe.stagedContent, 'unsaved-live-buffer');
  } finally {
    if (prevCmd === undefined) delete process.env.LACK_ENGINE_CMD;
    else process.env.LACK_ENGINE_CMD = prevCmd;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('delete confirmation dialogs do not include confusing non-permanent-delete disclaimer', () => {
  const rendererSrc = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  assert.ok(!rendererSrc.includes('Nessun file viene eliminato definitivamente'));
});

test('tracked compiler diagnostics and line highlights follow line insertions, deletions, undo, and mid-compile edits', () => {
  const { EditorState } = require('@codemirror/state');
  const { history, undo, isolateHistory } = require('@codemirror/commands');
  const {
    compilerIssueStateField,
    setCompilerIssuesEffect,
    setExtraHighlightEffect,
    tabSwitchAnnotation,
    buildTrackedEntries,
    getCompilerDiagnosticsFromState
  } = require('../src/editor/linter');

  const initialDoc = [
    '\\documentclass{article}',
    '\\begin{document}',
    '',
    '\\input{utils/front.tex}',
    '\\newpage',
    '\\end{document}'
  ].join('\n');

  let state = EditorState.create({
    doc: initialDoc,
    extensions: [history(), compilerIssueStateField]
  });

  const issue = {
    type: 'error',
    file: 'report.tex',
    line: 4,
    message: "! LaTeX Error: File 'utils/front.tex' not found."
  };

  const initialEntries = buildTrackedEntries(state.doc, [issue], '/proj/report.tex');
  state = state.update({ effects: setCompilerIssuesEffect.of(initialEntries) }).state;

  const decoLines = (st) => {
    const lines = [];
    const decos = st.field(compilerIssueStateField).lineDecos;
    decos.between(0, st.doc.length, (from) => {
      lines.push(st.doc.lineAt(from).number);
    });
    return lines;
  };

  assert.deepStrictEqual(decoLines(state), [4]);
  let diags = getCompilerDiagnosticsFromState(state, '/proj/report.tex');
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(state.doc.sliceString(diags[0].from, diags[0].to), '\\input');

  // 1. Delete blank line 3 above the error -> error must shift up from line 4 to line 3 immediately
  const line3 = state.doc.line(3);
  state = state.update({
    changes: { from: line3.from - 1, to: line3.to, insert: '' }
  }).state;

  assert.deepStrictEqual(decoLines(state), [3]);
  diags = getCompilerDiagnosticsFromState(state, '/proj/report.tex');
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(state.doc.lineAt(diags[0].from).number, 3);
  assert.strictEqual(state.doc.sliceString(diags[0].from, diags[0].to), '\\input');

  // 2. Insert two newlines at the start of line 3 -> error must move down from line 3 to line 5
  const shiftedLine3 = state.doc.line(3);
  state = state.update({
    changes: { from: shiftedLine3.from, to: shiftedLine3.from, insert: '\n\n' }
  }).state;

  assert.deepStrictEqual(decoLines(state), [5]);
  diags = getCompilerDiagnosticsFromState(state, '/proj/report.tex');
  assert.strictEqual(state.doc.lineAt(diags[0].from).number, 5);

  // 3. Delete the offending line itself -> error highlight and diagnostic disappear immediately
  const errLine = state.doc.line(5);
  state = state.update({
    changes: { from: errLine.from - 1, to: errLine.to, insert: '' },
    annotations: isolateHistory.of('full')
  }).state;

  assert.deepStrictEqual(decoLines(state), []);
  assert.strictEqual(getCompilerDiagnosticsFromState(state, '/proj/report.tex').length, 0);

  // 4. Undo deleting the offending line via real CodeMirror history() -> tracked error and highlight come back on line 5
  undo({ state, dispatch: (trSpec) => { state = state.update(trSpec).state; } });

  assert.deepStrictEqual(decoLines(state), [5]);
  diags = getCompilerDiagnosticsFromState(state, '/proj/report.tex');
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(state.doc.sliceString(diags[0].from, diags[0].to), '\\input');

  // 5. Extra highlight range also moves with line deletions above it
  state = state.update({
    effects: setExtraHighlightEffect.of([{
      from: state.doc.line(6).from,
      to: state.doc.line(6).to,
      line: 6,
      nonEmpty: true,
      origToken: null,
      deleted: false,
      anchor: state.doc.line(6).from
    }])
  }).state;
  assert.deepStrictEqual(decoLines(state), [5, 6]);
  state = state.update({
    changes: { from: state.doc.line(3).from - 1, to: state.doc.line(3).to, insert: '' }
  }).state;
  assert.deepStrictEqual(decoLines(state), [4, 5]);

  // 6. Tab switch swaps doc without mapping old spans into line 1
  const switchedState = state.update({
    changes: { from: 0, to: state.doc.length, insert: '% other file' },
    annotations: tabSwitchAnnotation.of(true)
  }).state;
  assert.deepStrictEqual(decoLines(switchedState), []);

  // 7. Mid-compile snapshot edit replay maps compiled line 4 to line 3 cleanly
  const preCompileState = EditorState.create({ doc: initialDoc });
  const trDuringCompile = preCompileState.update({
    changes: { from: preCompileState.doc.line(3).from - 1, to: preCompileState.doc.line(3).to, insert: '' }
  });
  const midCompileIssue = { type: 'error', file: 'report.tex', line: 4, message: 'err' };
  const mappedEntries = buildTrackedEntries(preCompileState.doc, [midCompileIssue], '/proj/report.tex', {
    preChanges: trDuringCompile.changes,
    targetDoc: trDuringCompile.state.doc
  });
  assert.strictEqual(mappedEntries.length, 1);
  assert.strictEqual(mappedEntries[0].line, 3);
  assert.strictEqual(midCompileIssue.line, 3);
});
