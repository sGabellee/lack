const { linter } = require('@codemirror/lint');
const { lintLatexDocument } = require('./linter-logic');

function latexLinterExtension() {
  return linter((view) => {
    const text = view.state.doc.toString();
    const diagnostics = lintLatexDocument(text);
    return diagnostics.map((d) => {
      const item = {
        from: Math.max(0, Math.min(d.from, text.length)),
        to: Math.max(0, Math.min(d.to, text.length)),
        severity: d.severity || 'warning',
        message: d.message
      };

      if (d.actions && d.actions.length > 0) {
        item.actions = d.actions.map((act) => ({
          name: act.name,
          apply(v, from, to) {
            v.dispatch({
              changes: {
                from: act.from !== undefined ? act.from : from,
                to: act.to !== undefined ? act.to : to,
                insert: act.insert
              }
            });
          }
        }));
      }

      return item;
    });
  }, { delay: 350 });
}

module.exports = { latexLinterExtension };
