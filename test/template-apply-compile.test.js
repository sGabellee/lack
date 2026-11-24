const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const i18n = require('../i18n');
const { resolveClassicCompileTarget, isPathInsideDir } = require('../src/projects/ui-controller');

test('i18n: template replace and load strings are present in both English and Italian', () => {
  const enKeys = Object.keys(i18n.translations.en);
  const itKeys = Object.keys(i18n.translations.it);

  const requiredKeys = [
    'template_replace_confirm',
    'template_btn_replace',
    'template_btn_new_tab',
    'template_loaded'
  ];

  for (const k of requiredKeys) {
    assert.ok(enKeys.includes(k), `English should include '${k}'`);
    assert.ok(itKeys.includes(k), `Italian should include '${k}'`);
    assert.ok(i18n.translations.en[k].length > 0);
    assert.ok(i18n.translations.it[k].length > 0);
  }
});

test('compile target logic: linked project compiles mainDocumentPath only for project tabs', () => {
  const storePath = '/home/user/Documents/Lack Projects/proj-1234';
  const mainDocumentPath = path.join(storePath, 'main.tex');
  const subfilePath = path.join(storePath, 'chapters', 'intro.tex');
  const externalFilePath = '/home/user/other/standalone.tex';

  const isLinkedProject = true;
  const currentProject = {
    projectId: 'proj-1234',
    name: 'proj',
    storePath: storePath,
    targetPath: '/home/user/proj.pdf'
  };

  function computeCompileTarget(tab) {
    const isProjectTab = Boolean(
      isLinkedProject &&
      currentProject &&
      tab &&
      tab.filePath &&
      (
        (mainDocumentPath && path.resolve(tab.filePath) === path.resolve(mainDocumentPath)) ||
        (currentProject.storePath && isPathInsideDir(tab.filePath, currentProject.storePath))
      )
    );
    const isProjectCompile = Boolean(isLinkedProject && currentProject && (isProjectTab || !tab));

    const targetPath = (isProjectCompile && mainDocumentPath)
      ? mainDocumentPath
      : resolveClassicCompileTarget({
          activeTab: tab,
          mainDocumentPath: isLinkedProject ? null : mainDocumentPath,
          currentProjectDir: isLinkedProject ? null : '/home/user',
          mainDocumentExplicit: false,
          fileExists: () => true
        });

    return { isProjectCompile, targetPath };
  }

  // Case 1: Editing main document -> compiles project main
  const resMain = computeCompileTarget({ filePath: mainDocumentPath, content: '\\documentclass{article}' });
  assert.equal(resMain.isProjectCompile, true);
  assert.equal(resMain.targetPath, mainDocumentPath);

  // Case 2: Editing subfile inside project store -> compiles project main
  const resSub = computeCompileTarget({ filePath: subfilePath, content: '\\section{Intro}' });
  assert.equal(resSub.isProjectCompile, true);
  assert.equal(resSub.targetPath, mainDocumentPath);

  // Case 3: Editing untitled tab -> does NOT compile project main, targets null (in-memory buffer)
  const resUntitled = computeCompileTarget({ filePath: null, title: 'untitled-2.tex', content: '\\documentclass{beamer}' });
  assert.equal(resUntitled.isProjectCompile, false);
  assert.equal(resUntitled.targetPath, null);

  // Case 4: Editing external standalone file -> does NOT compile project main, targets external file
  const resExternal = computeCompileTarget({ filePath: externalFilePath, content: '\\documentclass{article}' });
  assert.equal(resExternal.isProjectCompile, false);
  assert.equal(resExternal.targetPath, externalFilePath);

  // Case 5: No tab open -> defaults to project compile
  const resNoTab = computeCompileTarget(null);
  assert.equal(resNoTab.isProjectCompile, true);
  assert.equal(resNoTab.targetPath, mainDocumentPath);
});
