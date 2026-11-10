const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_TEMPLATES } = require('../templates');
const { convertLatexAstToHtml } = require('../src/compiler/ast-renderer');

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ');
}

test('assertNoRawLatex: for EVERY template in templates.js, visible text has 0 raw macros, 0 envs, 0 stray braces', () => {
  for (const tmpl of DEFAULT_TEMPLATES) {
    const res = convertLatexAstToHtml(tmpl.content);
    assert.ok(res.html && res.html.length > 0, `HTML preview empty for template ${tmpl.id}`);

    const text = stripHtml(res.html);
    const macroMatches = text.match(/\\[a-zA-Z]+/g);
    const envMatches = text.match(/\\(begin|end)\b/g);

    assert.equal(
      macroMatches,
      null,
      `Raw LaTeX macro found in visible text of template ${tmpl.id}: ${JSON.stringify(macroMatches)}`
    );
    assert.equal(
      envMatches,
      null,
      `Raw LaTeX environment found in visible text of template ${tmpl.id}: ${JSON.stringify(envMatches)}`
    );

    // Stray braces check: only permitted if original LaTeX has \{ or \}
    const hasEscapedBraces = /\\\{|\\\}/.test(tmpl.content);
    if (!hasEscapedBraces) {
      const braceMatches = text.match(/[{}]/g);
      assert.equal(
        braceMatches,
        null,
        `Stray brace found in visible text of template ${tmpl.id}: ${JSON.stringify(braceMatches)}`
      );
    }
  }
});

test('IEEEtran template specific rendering requirements', () => {
  const ieee = DEFAULT_TEMPLATES.find((t) => t.id === 'ieee-conference');
  assert.ok(ieee, 'ieee-conference template must exist');

  const res = convertLatexAstToHtml(ieee.content);

  // 1. Title line plus footnote-size second line
  assert.ok(res.html.includes('Conference Paper Title*'), 'Expected title line');
  assert.ok(res.html.includes('latex-doc-subtitle'), 'Expected footnote subtitle');
  assert.ok(res.html.includes('Sub-titles are not recommended'), 'Expected subtitle text');

  // 2. Author blocks separated by \and with name and affiliation
  const authorBlocks = res.html.match(/class="latex-author-block"/g) || [];
  assert.equal(authorBlocks.length, 2, 'Expected exactly 2 author blocks');
  assert.ok(res.html.includes('Given Name Surname'), 'Expected author names');
  assert.ok(res.html.includes('dept. name of organization'), 'Expected affiliation');
  assert.ok(res.html.includes('email@example.com'), 'Expected author email');

  // 3. Abstract and keywords with run-in headings
  assert.ok(res.html.includes('Abstract—'), 'Expected run-in Abstract— heading');
  assert.ok(res.html.includes('Index Terms—'), 'Expected run-in Index Terms— heading');

  // 4. Two-column layout
  assert.strictEqual(res.isTwoColumn, true, 'IEEEtran must activate two-column mode');
  assert.ok(res.html.includes('page-twocolumn'), 'Expected page-twocolumn CSS class');

  // 5. Section count equals source
  assert.strictEqual(res.sectionsCount, 6, 'Expected exactly 6 sections');
});

test('Fuzz test: random brace nesting never throws, hangs, or outputs raw backslashes', () => {
  function generateRandomNesting(depth) {
    let s = 'Preamble text. ';
    for (let i = 0; i < depth; i++) {
      s += '\\textbf{';
    }
    s += 'deeply nested inner content';
    for (let i = 0; i < depth; i++) {
      s += i % 3 === 0 ? '}\\textit{branch}' : '}';
    }
    return s;
  }

  for (let i = 0; i < 25; i++) {
    const depth = Math.floor(Math.random() * 20) + 1;
    const code = generateRandomNesting(depth);
    const res = convertLatexAstToHtml(code);
    assert.ok(res.html, 'Renderer must produce HTML output');
    const text = stripHtml(res.html);
    assert.equal(/\\[a-zA-Z]+/.test(text), false, 'Fuzz output must not contain raw macro name');
  }
});
