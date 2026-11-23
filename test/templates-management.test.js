const test = require('node:test');
const assert = require('node:assert/strict');

// Setup mock localStorage before requiring templates module
const storage = new Map();
global.localStorage = {
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};

const LackTemplates = require('../templates');

test('LackTemplates: default categories and templates are properly loaded', () => {
  storage.clear();
  const cats = LackTemplates.getAllCategories();
  assert.ok(cats.length >= 7, 'Should have at least 7 default categories');
  assert.ok(cats.some(c => c.id === 'academic'));
  assert.ok(cats.some(c => c.id === 'beamer'));

  const templates = LackTemplates.getAllTemplates();
  assert.ok(templates.length >= 6, 'Should have at least 6 default templates');
  const ieee = LackTemplates.getTemplateById('ieee-conference');
  assert.ok(ieee, 'IEEE template should exist');
  assert.equal(ieee.category, 'academic');
  assert.ok(ieee.suggestedFilename.endsWith('.tex'));
});

test('LackTemplates: addCategory handles normalization, persistence and deduplication', () => {
  storage.clear();
  const cat1 = LackTemplates.addCategory('Laboratorio Fisica');
  assert.ok(cat1);
  assert.equal(cat1.id, 'cat-laboratorio-fisica');
  assert.equal(cat1.label, 'Laboratorio Fisica');
  assert.equal(cat1.isCustom, true);

  // Deduplication check
  const cat2 = LackTemplates.addCategory('Laboratorio Fisica');
  assert.equal(cat2.id, cat1.id);

  // Case-insensitive deduplication
  const cat3 = LackTemplates.addCategory('laboratorio fisica');
  assert.equal(cat3.id, cat1.id);

  const allCats = LackTemplates.getAllCategories();
  const found = allCats.filter(c => c.id === 'cat-laboratorio-fisica');
  assert.equal(found.length, 1, 'Should only exist once in category list');
});

test('LackTemplates: sanitizeLatexFilename ensures valid names and .tex extension', () => {
  assert.equal(LackTemplates.sanitizeLatexFilename('my_document'), 'my_document.tex');
  assert.equal(LackTemplates.sanitizeLatexFilename('my_document.tex'), 'my_document.tex');
  assert.equal(LackTemplates.sanitizeLatexFilename('my_document.markdown'), 'my_document.tex');
  assert.equal(LackTemplates.sanitizeLatexFilename('', 'My Research Paper'), 'my_research_paper.tex');
  assert.equal(LackTemplates.sanitizeLatexFilename('   ', 'Appunti Lezione 1'), 'appunti_lezione_1.tex');
});

test('LackTemplates: saveCustomTemplate persists custom templates with scope, filename and metadata', () => {
  storage.clear();
  const saved = LackTemplates.saveCustomTemplate({
    title: 'Analisi Matematica Formulario',
    category: 'assignments',
    suggestedFilename: 'formulario_analisi',
    scope: 'project',
    description: 'Formule per integrali e serie',
    content: '\\documentclass{article}\n\\begin{document}\nFormula\n\\end{document}'
  });

  assert.ok(saved);
  assert.ok(saved.id.startsWith('custom-'));
  assert.equal(saved.title, 'Analisi Matematica Formulario');
  assert.equal(saved.suggestedFilename, 'formulario_analisi.tex');
  assert.equal(saved.scope, 'project');
  assert.equal(saved.category, 'assignments');
  assert.equal(saved.isCustom, true);
  assert.ok(saved.createdAt);
  assert.ok(saved.updatedAt);

  const retrieved = LackTemplates.getTemplateById(saved.id);
  assert.ok(retrieved);
  assert.equal(retrieved.title, 'Analisi Matematica Formulario');
  assert.equal(retrieved.suggestedFilename, 'formulario_analisi.tex');
});

test('LackTemplates: updateCustomTemplate updates fields and refreshes updatedAt', () => {
  storage.clear();
  const created = LackTemplates.saveCustomTemplate({
    title: 'Template Originale',
    category: 'academic',
    suggestedFilename: 'original.tex',
    description: 'Descrizione originale',
    content: 'Contenuto originale'
  });

  const updated = LackTemplates.updateCustomTemplate(created.id, {
    title: 'Template Aggiornato',
    description: 'Nuova descrizione',
    suggestedFilename: 'aggiornato.tex',
    scope: 'global'
  });

  assert.ok(updated);
  assert.equal(updated.title, 'Template Aggiornato');
  assert.equal(updated.description, 'Nuova descrizione');
  assert.equal(updated.suggestedFilename, 'aggiornato.tex');
  assert.equal(updated.content, 'Contenuto originale', 'Content should be preserved if not passed');

  const retrieved = LackTemplates.getTemplateById(created.id);
  assert.equal(retrieved.title, 'Template Aggiornato');
});

test('LackTemplates: deleteCustomTemplate removes template from storage', () => {
  storage.clear();
  const t1 = LackTemplates.saveCustomTemplate({ title: 'Da Eliminare', content: 'test' });
  const t2 = LackTemplates.saveCustomTemplate({ title: 'Da Tenere', content: 'test' });

  assert.equal(LackTemplates.getCustomTemplates().length, 2);

  const deleted = LackTemplates.deleteCustomTemplate(t1.id);
  assert.equal(deleted, true);

  const customRemaining = LackTemplates.getCustomTemplates();
  assert.equal(customRemaining.length, 1);
  assert.equal(customRemaining[0].id, t2.id);
  assert.equal(LackTemplates.getTemplateById(t1.id), null);
});
